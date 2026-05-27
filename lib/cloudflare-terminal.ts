import type { Workspace } from '@cloudflare/shell';
import { createTools, type FileStat, type SandboxFactory, type SessionEnv, type ShellResult } from '@flue/runtime';
import { Bash, defineCommand, type CommandContext, type CommandName, type CpOptions, type FileContent, type FsStat, type IFileSystem, type MkdirOptions, type RmOptions } from 'just-bash/browser';

type WorkspaceEntry = {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  updatedAt?: number;
  mtime?: Date;
};

type WorkspaceLike = Pick<Workspace,
  | 'appendFile'
  | 'cp'
  | 'exists'
  | 'mkdir'
  | 'mv'
  | 'readDir'
  | 'readFile'
  | 'readFileBytes'
  | 'readlink'
  | 'rm'
  | 'stat'
  | 'symlink'
  | 'writeFile'
  | 'writeFileBytes'
> & {
  _getAllPaths?: () => Promise<string[]>;
  lstat?: (path: string) => Promise<WorkspaceEntry | null>;
};

type CloudflareTerminalOptions = {
  workspace: Workspace;
  loader: unknown;
  cwd?: string;
};

const allowedCommands: CommandName[] = [
  'base64', 'basename', 'cat', 'chmod', 'clear', 'cp', 'cut', 'date', 'diff',
  'dirname', 'du', 'echo', 'env', 'egrep', 'false', 'fgrep', 'file', 'find',
  'grep', 'head', 'help', 'hostname', 'jq', 'ln', 'ls', 'md5sum', 'mkdir',
  'mv', 'nl', 'printenv', 'printf', 'pwd', 'readlink', 'rev', 'rg', 'rm',
  'rmdir', 'sed', 'sha1sum', 'sha256sum', 'sh', 'sort', 'stat', 'tail', 'tee',
  'touch', 'tree', 'true', 'uniq', 'wc', 'which', 'whoami',
];

function normalize(path: string) {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function parentOf(path: string) {
  const normalized = normalize(path);
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}

function nameOf(path: string) {
  return normalize(path).split('/').pop() || '/';
}

function bytesFromLatin1(value: string) {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 0xff;
  return bytes;
}

function textFromBytes(value: Uint8Array) {
  return new TextDecoder().decode(value);
}

function encodeContent(content: FileContent, options?: unknown) {
  if (content instanceof Uint8Array) return content;
  if (options === 'binary' || (typeof options === 'object' && options && (options as { encoding?: unknown }).encoding === 'binary')) {
    return bytesFromLatin1(content);
  }
  return content;
}

function enoent(path: string) {
  return new Error(`ENOENT: no such file or directory, ${path}`);
}

function enotdir(path: string) {
  return new Error(`ENOTDIR: not a directory, ${path}`);
}

function eexist(path: string) {
  return new Error(`EEXIST: file already exists, ${path}`);
}

function statFrom(entry: WorkspaceEntry): FsStat {
  return {
    isFile: entry.type === 'file',
    isDirectory: entry.type === 'directory',
    isSymbolicLink: entry.type === 'symlink',
    mode: entry.type === 'directory' ? 0o755 : entry.type === 'symlink' ? 0o777 : 0o644,
    size: entry.size,
    mtime: entry.mtime ?? new Date(entry.updatedAt ?? 0),
  };
}

function parseGrepArgs(commandName: string, args: string[]) {
  const flags = new Set(commandName === 'rg' ? ['R', 'n'] : []);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      for (const flag of arg.slice(1)) flags.add(flag);
      continue;
    }
    positional.push(arg);
  }
  return {
    flags,
    pattern: positional[0] ?? '',
    targets: positional.slice(1),
  };
}

function grepMatches(line: string, pattern: string, flags: Set<string>, fixed: boolean) {
  if (fixed) {
    const haystack = flags.has('i') ? line.toLowerCase() : line;
    const needle = flags.has('i') ? pattern.toLowerCase() : pattern;
    return haystack.includes(needle);
  }
  if (flags.has('E') || pattern.includes('|') || pattern.includes('\\|')) {
    const regexPattern = pattern.replaceAll('\\|', '|');
    return new RegExp(regexPattern, flags.has('i') ? 'i' : '').test(line);
  }
  const haystack = flags.has('i') ? line.toLowerCase() : line;
  const needle = flags.has('i') ? pattern.toLowerCase() : pattern;
  return haystack.includes(needle);
}

async function grepFiles(ctx: CommandContext, path: string, recursive: boolean): Promise<string[]> {
  const resolved = ctx.fs.resolvePath(ctx.cwd, path);
  const stat = await ctx.fs.stat(resolved);
  if (stat.isFile) return [resolved];
  if (!stat.isDirectory) return [];
  if (!recursive) throw new Error(`grep: ${path}: Is a directory`);
  const files: string[] = [];
  for (const entry of await ctx.fs.readdir(resolved)) {
    files.push(...await grepFiles(ctx, `${resolved}/${entry}`, recursive));
  }
  return files;
}

function createGrepCommand(name: 'grep' | 'egrep' | 'fgrep' | 'rg') {
  return defineCommand(name, async (args, ctx) => {
    const { flags, pattern, targets } = parseGrepArgs(name, args);
    const recursive = flags.has('R') || flags.has('r');
    const fixed = name === 'fgrep' || flags.has('F');
    const lineNumbers = flags.has('n');
    const out: string[] = [];

    if (targets.length === 0) {
      for (const [index, line] of ctx.stdin.split('\n').entries()) {
        if (grepMatches(line, pattern, flags, fixed)) out.push(lineNumbers ? `${index + 1}:${line}` : line);
      }
      return { stdout: out.length > 0 ? `${out.join('\n')}\n` : '', stderr: '', exitCode: out.length > 0 ? 0 : 1 };
    }

    const files = (await Promise.all(targets.map((target) => grepFiles(ctx, target, recursive)))).flat().sort();
    const prefixFile = recursive || files.length > 1;
    for (const file of files) {
      const content = await ctx.fs.readFile(file);
      for (const [index, line] of content.split('\n').entries()) {
        if (!grepMatches(line, pattern, flags, fixed)) continue;
        const parts = [];
        if (prefixFile) parts.push(file);
        if (lineNumbers) parts.push(String(index + 1));
        parts.push(line);
        out.push(parts.join(':'));
      }
    }
    return { stdout: out.length > 0 ? `${out.join('\n')}\n` : '', stderr: '', exitCode: out.length > 0 ? 0 : 1 };
  });
}

function adaptFlueStat(stat: Awaited<ReturnType<SessionEnv['stat']>>): FileStat {
  return stat;
}

export class WorkspaceBackedFileSystem implements IFileSystem {
  private knownPaths = new Set<string>(['/']);

  constructor(private workspace: WorkspaceLike) {}

  async refresh(): Promise<void> {
    this.knownPaths = new Set<string>(['/']);
    if (this.workspace._getAllPaths) {
      for (const path of await this.workspace._getAllPaths()) this.knownPaths.add(normalize(path));
      for (const path of [...this.knownPaths]) this.addParents(path);
      return;
    }
    await this.refreshDir('/');
  }

  async readFile(path: string): Promise<string> {
    const resolved = normalize(path);
    const content = await this.workspace.readFile(resolved);
    if (content === null) throw enoent(resolved);
    return content;
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    const resolved = normalize(path);
    const content = await this.workspace.readFileBytes(resolved);
    if (content === null) throw enoent(resolved);
    return content;
  }

  async writeFile(path: string, content: FileContent, options?: unknown): Promise<void> {
    const resolved = normalize(path);
    await this.workspace.mkdir(parentOf(resolved), { recursive: true });
    const encoded = encodeContent(content, options);
    if (encoded instanceof Uint8Array) await this.workspace.writeFileBytes(resolved, encoded);
    else await this.workspace.writeFile(resolved, encoded);
    this.track(resolved);
  }

  async appendFile(path: string, content: FileContent, options?: unknown): Promise<void> {
    const resolved = normalize(path);
    await this.workspace.mkdir(parentOf(resolved), { recursive: true });
    const encoded = encodeContent(content, options);
    if (encoded instanceof Uint8Array) {
      const existing = await this.workspace.readFileBytes(resolved).catch(() => null);
      const combined = new Uint8Array((existing?.length ?? 0) + encoded.length);
      if (existing) combined.set(existing);
      combined.set(encoded, existing?.length ?? 0);
      await this.workspace.writeFileBytes(resolved, combined);
    } else {
      await this.workspace.appendFile(resolved, encoded);
    }
    this.track(resolved);
  }

  async exists(path: string): Promise<boolean> {
    return await this.workspace.exists(normalize(path));
  }

  async stat(path: string): Promise<FsStat> {
    const resolved = normalize(path);
    const stat = await this.workspace.stat(resolved);
    if (!stat) throw enoent(resolved);
    return statFrom(stat as WorkspaceEntry);
  }

  async lstat(path: string): Promise<FsStat> {
    const resolved = normalize(path);
    const stat = this.workspace.lstat ? await this.workspace.lstat(resolved) : await this.workspace.stat(resolved);
    if (!stat) throw enoent(resolved);
    return statFrom(stat as WorkspaceEntry);
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const resolved = normalize(path);
    if (!options?.recursive && await this.workspace.exists(resolved)) throw eexist(resolved);
    await this.workspace.mkdir(resolved, options);
    this.track(resolved);
  }

  async readdir(path: string): Promise<string[]> {
    const entries = await this.readEntries(path);
    return entries.map((entry) => entry.name).sort();
  }

  async readdirWithFileTypes(path: string) {
    return (await this.readEntries(path)).map((entry) => ({
      name: entry.name,
      isFile: entry.type === 'file',
      isDirectory: entry.type === 'directory',
      isSymbolicLink: entry.type === 'symlink',
    }));
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    const resolved = normalize(path);
    await this.workspace.rm(resolved, options);
    for (const known of [...this.knownPaths]) {
      if (known === resolved || known.startsWith(`${resolved}/`)) this.knownPaths.delete(known);
    }
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    await this.workspace.cp(normalize(src), normalize(dest), options);
    await this.refresh();
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.workspace.mv(normalize(src), normalize(dest));
    await this.refresh();
  }

  resolvePath(base: string, path: string): string {
    if (path.startsWith('/')) return normalize(path);
    return normalize(`${base.replace(/\/$/, '')}/${path}`);
  }

  getAllPaths(): string[] {
    return [...this.knownPaths].sort();
  }

  async chmod(path: string): Promise<void> {
    if (!await this.exists(path)) throw enoent(path);
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    const resolved = normalize(linkPath);
    await this.workspace.symlink(normalize(target), resolved);
    this.track(resolved);
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    await this.cp(existingPath, newPath);
  }

  async readlink(path: string): Promise<string> {
    return await this.workspace.readlink(normalize(path));
  }

  async realpath(path: string): Promise<string> {
    const resolved = normalize(path);
    if (!await this.exists(resolved)) throw enoent(resolved);
    return resolved;
  }

  async utimes(path: string): Promise<void> {
    if (!await this.exists(path)) throw enoent(path);
  }

  private async readEntries(path: string): Promise<WorkspaceEntry[]> {
    const resolved = normalize(path);
    const stat = await this.workspace.stat(resolved);
    if (!stat) throw enoent(resolved);
    if (stat.type !== 'directory') throw enotdir(resolved);
    const entries = await this.workspace.readDir(resolved);
    for (const entry of entries) this.track(entry.path);
    return entries as WorkspaceEntry[];
  }

  private async refreshDir(path: string): Promise<void> {
    if (!await this.workspace.exists(path)) return;
    this.track(path);
    const stat = await this.workspace.stat(path);
    if (stat?.type !== 'directory') return;
    for (const entry of await this.workspace.readDir(path)) {
      this.track(entry.path);
      if (entry.type === 'directory') await this.refreshDir(entry.path);
    }
  }

  private track(path: string): void {
    const resolved = normalize(path);
    this.knownPaths.add(resolved);
    this.addParents(resolved);
  }

  private addParents(path: string): void {
    let current = parentOf(path);
    while (current && !this.knownPaths.has(current)) {
      this.knownPaths.add(current);
      if (current === '/') break;
      current = parentOf(current);
    }
  }
}

export async function createWorkspaceBash(workspace: WorkspaceLike, cwd = '/') {
  const fs = new WorkspaceBackedFileSystem(workspace);
  await fs.refresh();
  return new Bash({
    fs,
    cwd: normalize(cwd),
    commands: allowedCommands,
    customCommands: [createGrepCommand('grep'), createGrepCommand('egrep'), createGrepCommand('fgrep'), createGrepCommand('rg')],
    executionLimits: {
      maxCommandCount: 300,
      maxLoopIterations: 1000,
      maxStringLength: 1_000_000,
      maxGlobOperations: 10_000,
      maxHeredocSize: 1_000_000,
    },
    defenseInDepth: true,
  });
}

export function cloudflareTerminalSandbox({ workspace, cwd = '/' }: CloudflareTerminalOptions): SandboxFactory {
  const normalizedCwd = normalize(cwd);

  const createSessionEnv = async (): Promise<SessionEnv> => {
    const bash = await createWorkspaceBash(workspace, normalizedCwd);
    const fs = bash.fs;

    const exec = async (command: string, options?: { cwd?: string; signal?: AbortSignal; timeout?: number }): Promise<ShellResult> => {
      const timeoutSignal = typeof options?.timeout === 'number' ? AbortSignal.timeout(options.timeout * 1000) : undefined;
      const signal = options?.signal && timeoutSignal ? AbortSignal.any([options.signal, timeoutSignal]) : (options?.signal ?? timeoutSignal);
      const result = await bash.exec(command, { cwd: options?.cwd ? fs.resolvePath(normalizedCwd, options.cwd) : normalizedCwd, signal });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    };

    const resolvePath = (path: string) => fs.resolvePath(normalizedCwd, path);

    return {
      exec,
      readFile: (path) => fs.readFile(resolvePath(path)),
      readFileBuffer: (path) => fs.readFileBuffer(resolvePath(path)),
      writeFile: (path, content) => fs.writeFile(resolvePath(path), content),
      stat: async (path) => adaptFlueStat(await fs.stat(resolvePath(path)) as unknown as FileStat),
      readdir: (path) => fs.readdir(resolvePath(path)),
      exists: (path) => fs.exists(resolvePath(path)),
      mkdir: (path, options) => fs.mkdir(resolvePath(path), options),
      rm: (path, options) => fs.rm(resolvePath(path), options),
      cwd: normalizedCwd,
      resolvePath,
    };
  };

  return {
    createSessionEnv,
    tools: (env) => createTools(env).filter((tool) => tool.name === 'bash'),
  };
}
