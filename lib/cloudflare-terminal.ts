import { WorkspaceFileSystem, type Workspace, type WorkspaceFsLike } from '@cloudflare/shell';
import { createTools, type FileStat, type SandboxFactory, type SessionEnv, type ShellResult } from '@flue/runtime';
import { Bash, defineCommand, getCommandNames, type CommandContext, type CommandName, type CpOptions, type FileContent, type FsStat, type IFileSystem, type MkdirOptions, type RmOptions } from 'just-bash/browser';

/** Options for exposing a Workspace as a Flue sandbox factory. */
type CloudflareTerminalOptions = {
  workspace: Workspace;
  /** Worker Loader is used by Flue's built-in shell/code sandbox; retained for config parity. */
  loader: unknown;
  /** Working directory seen by the agent's terminal commands. */
  cwd?: string;
};

type WorkspaceFileSystemStat = Awaited<ReturnType<WorkspaceFileSystem['stat']>>;

type WorkspaceWithPathListing = Pick<Workspace,
  | 'appendFile'
  | 'cp'
  | 'exists'
  | 'lstat'
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
  glob?: (pattern: string) => Promise<Array<{ path: string }>>;
};

/** Use the broad non-network just-bash command registry, including grep/rg/awk/jq/tar/etc. */
const allowedCommands = getCommandNames() as CommandName[];

/** Normalizes POSIX-style paths for the virtual Workspace filesystem. */
function normalize(path: string) {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

/** Returns the normalized parent directory for a path. */
function parentOf(path: string) {
  const normalized = normalize(path);
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}

/** Converts a binary string into byte values matching Node's latin1 behavior. */
function bytesFromLatin1(value: string) {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i++) bytes[i] = value.charCodeAt(i) & 0xff;
  return bytes;
}

/** Encodes just-bash file content into the representation expected by Workspace. */
function encodeContent(content: FileContent, options?: unknown) {
  if (content instanceof Uint8Array) return content;
  if (options === 'binary' || options === 'latin1' || (typeof options === 'object' && options && ['binary', 'latin1'].includes(String((options as { encoding?: unknown }).encoding)))) {
    return bytesFromLatin1(content);
  }
  return content;
}

function enoent(path: string) {
  return new Error(`ENOENT: no such file or directory, ${path}`);
}

/** Parses the subset of grep/rg options that the demo terminal needs. */
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

/** Implements fixed-string and simple regex matching for grep-like commands. */
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

/** Expands grep targets into readable files, recursing when -r/-R is present. */
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

/** Keeps grep/rg output stable across just-bash releases for demo prompts/tests. */
function createGrepCommand(name: 'grep' | 'egrep' | 'fgrep' | 'rg') {
  return defineCommand(name, async (args, ctx) => {
    const { flags, pattern, targets } = parseGrepArgs(name, args);
    const recursive = flags.has('R') || flags.has('r');
    const fixed = name === 'fgrep' || flags.has('F');
    const lineNumbers = flags.has('n');
    const out: string[] = [];

    if (targets.length === 0) {
      for (const [index, line] of String(ctx.stdin).split('\n').entries()) {
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

/** Converts @cloudflare/shell stat metadata into the FsStat shape expected by just-bash. */
function statFrom(entry: WorkspaceFileSystemStat): FsStat {
  return {
    isFile: entry.type === 'file',
    isDirectory: entry.type === 'directory',
    isSymbolicLink: entry.type === 'symlink',
    mode: entry.type === 'directory' ? 0o755 : entry.type === 'symlink' ? 0o777 : 0o644,
    size: entry.size,
    mtime: entry.mtime,
  };
}

/** Adapts Flue stat values from the shared @cloudflare/shell filesystem adapter. */
function adaptFlueStat(stat: WorkspaceFileSystemStat): FileStat {
  return {
    isFile: stat.type === 'file',
    isDirectory: stat.type === 'directory',
    isSymbolicLink: stat.type === 'symlink',
    size: stat.size,
    mtime: stat.mtime,
  };
}

/**
 * just-bash filesystem implementation backed by @cloudflare/shell's upstream adapter.
 *
 * Flue 0.8 now ships the Workspace filesystem bridge. This class only supplies the
 * extra synchronous path index and stat shape that just-bash expects for shell
 * globbing, while file operations go through WorkspaceFileSystem.
 */
class JustBashWorkspaceFileSystem implements IFileSystem {
  private readonly fs: WorkspaceFileSystem;
  private knownPaths = new Set<string>(['/']);

  constructor(private readonly workspace: WorkspaceWithPathListing) {
    this.fs = new WorkspaceFileSystem(workspace as WorkspaceFsLike);
  }

  /** Rebuilds the known path index used by shell commands that enumerate files. */
  async refresh(): Promise<void> {
    this.knownPaths = new Set<string>(['/']);
    if (this.workspace._getAllPaths) {
      for (const path of await this.workspace._getAllPaths()) this.track(path);
      return;
    }
    if (this.workspace.glob) {
      for (const entry of await this.workspace.glob('/**/*')) this.track(entry.path);
      return;
    }
    await this.refreshDir('/');
  }

  async readFile(path: string): Promise<string> {
    return this.fs.readFile(normalize(path));
  }

  async readFileBuffer(path: string): Promise<Uint8Array> {
    return this.fs.readFileBytes(normalize(path));
  }

  async writeFile(path: string, content: FileContent, options?: unknown): Promise<void> {
    const resolved = normalize(path);
    await this.fs.mkdir(parentOf(resolved), { recursive: true });
    const encoded = encodeContent(content, options);
    if (encoded instanceof Uint8Array) await this.fs.writeFileBytes(resolved, encoded);
    else await this.fs.writeFile(resolved, encoded);
    this.track(resolved);
  }

  async appendFile(path: string, content: FileContent, options?: unknown): Promise<void> {
    const resolved = normalize(path);
    await this.fs.mkdir(parentOf(resolved), { recursive: true });
    const encoded = encodeContent(content, options);
    await this.fs.appendFile(resolved, encoded);
    this.track(resolved);
  }

  async exists(path: string): Promise<boolean> {
    return this.fs.exists(normalize(path));
  }

  async stat(path: string): Promise<FsStat> {
    return statFrom(await this.fs.stat(normalize(path)));
  }

  async flueStat(path: string): Promise<FileStat> {
    return adaptFlueStat(await this.fs.stat(normalize(path)));
  }

  async lstat(path: string): Promise<FsStat> {
    return statFrom(await this.fs.lstat(normalize(path)));
  }

  async mkdir(path: string, options?: MkdirOptions): Promise<void> {
    const resolved = normalize(path);
    await this.fs.mkdir(resolved, options);
    this.track(resolved);
  }

  async readdir(path: string): Promise<string[]> {
    const resolved = normalize(path);
    const entries = await this.fs.readdir(resolved);
    for (const entry of entries) this.track(`${resolved}/${entry}`);
    return entries.sort();
  }

  async readdirWithFileTypes(path: string) {
    const resolved = normalize(path);
    const entries = await this.fs.readdirWithFileTypes(resolved);
    for (const entry of entries) this.track(`${resolved}/${entry.name}`);
    return entries.map((entry) => ({
      name: entry.name,
      isFile: entry.type === 'file',
      isDirectory: entry.type === 'directory',
      isSymbolicLink: entry.type === 'symlink',
    }));
  }

  async rm(path: string, options?: RmOptions): Promise<void> {
    const resolved = normalize(path);
    await this.fs.rm(resolved, options);
    for (const known of [...this.knownPaths]) {
      if (known === resolved || known.startsWith(`${resolved}/`)) this.knownPaths.delete(known);
    }
  }

  async cp(src: string, dest: string, options?: CpOptions): Promise<void> {
    await this.fs.cp(normalize(src), normalize(dest), options);
    await this.refresh();
  }

  async mv(src: string, dest: string): Promise<void> {
    await this.fs.mv(normalize(src), normalize(dest));
    await this.refresh();
  }

  resolvePath(base: string, path: string): string {
    return normalize(path.startsWith('/') ? path : `${base.replace(/\/$/, '')}/${path}`);
  }

  /** Returns all paths currently known to the shell filesystem adapter. */
  getAllPaths(): string[] {
    return [...this.knownPaths].sort();
  }

  async chmod(path: string): Promise<void> {
    if (!await this.exists(path)) throw enoent(path);
  }

  async symlink(target: string, linkPath: string): Promise<void> {
    const resolved = normalize(linkPath);
    await this.fs.symlink(normalize(target), resolved);
    this.track(resolved);
  }

  async link(existingPath: string, newPath: string): Promise<void> {
    await this.cp(existingPath, newPath);
  }

  async readlink(path: string): Promise<string> {
    return this.fs.readlink(normalize(path));
  }

  async realpath(path: string): Promise<string> {
    return this.fs.realpath(normalize(path));
  }

  async utimes(path: string): Promise<void> {
    if (!await this.exists(path)) throw enoent(path);
  }

  /** Recursively discovers Workspace paths when a bulk path listing is unavailable. */
  private async refreshDir(path: string): Promise<void> {
    if (!await this.fs.exists(path)) return;
    this.track(path);
    const stat = await this.fs.stat(path);
    if (stat.type !== 'directory') return;
    for (const entry of await this.fs.readdir(path)) await this.refreshDir(`${path}/${entry}`);
  }

  /** Records a path and its parents so just-bash can enumerate virtual files. */
  private track(path: string): void {
    let current = normalize(path);
    this.knownPaths.add(current);
    while (current !== '/') {
      current = parentOf(current);
      this.knownPaths.add(current);
    }
  }
}

/** Creates a just-bash interpreter wired to the provided Workspace. */
export async function createWorkspaceBash(workspace: WorkspaceWithPathListing, cwd = '/') {
  const fs = new JustBashWorkspaceFileSystem(workspace);
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

/**
 * Presents the durable Workspace terminal as a Flue SandboxFactory.
 *
 * Flue 0.8's built-in shell sandbox provides the same Workspace foundation and a
 * code tool. This factory keeps this demo's agent-facing `bash` tool so users get
 * the wider just-bash command surface on top of the same durable Workspace.
 */
export function cloudflareTerminalSandbox({ workspace, cwd = '/' }: CloudflareTerminalOptions): SandboxFactory {
  const normalizedCwd = normalize(cwd);

  const createSessionEnv = async (): Promise<SessionEnv> => {
    const bash = await createWorkspaceBash(workspace, normalizedCwd);
    const fs = bash.fs as JustBashWorkspaceFileSystem;
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
      stat: (path) => fs.flueStat(resolvePath(path)),
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
