import { DynamicWorkerExecutor, resolveProvider } from '@cloudflare/codemode';
import { WorkspaceFileSystem, type Workspace } from '@cloudflare/shell';
import { stateTools } from '@cloudflare/shell/workers';
import type { FileStat, SandboxFactory, SessionEnv, ShellResult } from '@flue/runtime';

type CloudflareTerminalOptions = {
  workspace: Workspace;
  loader: any;
  cwd?: string;
};

export const terminalRuntime = String.raw`
const SUPPORTED = [
  'base64', 'basename', 'cat', 'chmod', 'clear', 'cp', 'cut', 'date', 'diff',
  'dirname', 'du', 'echo', 'env', 'egrep', 'false', 'fgrep', 'file', 'find',
  'grep', 'gunzip', 'gzip', 'head', 'help', 'hostname', 'jq', 'ln', 'ls',
  'md5sum', 'mkdir', 'mv', 'nl', 'printenv', 'printf', 'pwd', 'readlink',
  'realpath', 'rev', 'rg', 'rm', 'rmdir', 'sed', 'sha1sum', 'sha256sum',
  'sort', 'stat', 'tail', 'tar', 'tee', 'touch', 'tree', 'true', 'uniq',
  'wc', 'which', 'whoami', 'zcat'
];

function words(command) {
  return command.match(/"(?:\\.|[^"])*"|'[^']*'|\S+/g)?.map((word) => {
    const quote = word[0];
    if ((quote === '"' || quote === "'") && word.endsWith(quote)) return word.slice(1, -1);
    return word;
  }) ?? [];
}

function unquote(value) {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) return value.slice(1, -1);
  return value;
}

function clean(path) {
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return '/' + parts.join('/');
}

function pathFor(path, cwd) {
  if (!path || path === '.') return cwd;
  if (path.startsWith('/')) return clean(path);
  return clean(cwd.replace(/\/$/, '') + '/' + path);
}

function text(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function splitPipes(command) {
  const parts = [];
  let current = '';
  let quote = '';
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote && command[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '|') {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}

function findRedirection(command) {
  let quote = '';
  for (let i = command.length - 1; i >= 0; i--) {
    const ch = command[i];
    if (quote) {
      if (ch === quote && command[i - 1] !== '\\') quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') {
      const append = command[i - 1] === '>';
      const left = command.slice(0, append ? i - 1 : i).trim();
      const right = command.slice(i + 1).trim();
      if (!left || !right || right.includes(' ')) return null;
      return { left, append, path: unquote(right) };
    }
  }
  return null;
}

function optionless(args) {
  return args.filter((arg) => !arg.startsWith('-'));
}

function lines(input) {
  if (!input) return [];
  const out = input.split('\n');
  if (out.at(-1) === '') out.pop();
  return out;
}

function withNewline(value) {
  return value.endsWith('\n') ? value : value + '\n';
}

async function readInputs(args, cwd, stdin) {
  const files = optionless(args);
  if (files.length === 0) return stdin ?? '';
  let out = '';
  for (const file of files) out += await state.readFile(pathFor(file, cwd));
  return out;
}

function parseNumberFlag(args, flag, fallback) {
  const index = args.indexOf(flag);
  if (index >= 0 && args[index + 1]) return Number(args[index + 1]);
  const compact = args.find((arg) => arg.startsWith(flag) && arg.length > flag.length);
  if (compact) return Number(compact.slice(flag.length));
  return fallback;
}

function removeFlagValue(args, flag) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      i++;
      continue;
    }
    if (arg.startsWith(flag) && arg.length > flag.length) continue;
    out.push(arg);
  }
  return out;
}

function basename(path) {
  const cleaned = clean(path).replace(/\/$/, '');
  return cleaned.split('/').pop() || '/';
}

function dirname(path) {
  const cleaned = clean(path).replace(/\/$/, '');
  const index = cleaned.lastIndexOf('/');
  return index <= 0 ? '/' : cleaned.slice(0, index);
}

function simpleHashPlaceholder(algorithm, value) {
  return algorithm + ':' + value.length.toString(16);
}

async function runPipeline(command, cwd) {
  const parts = splitPipes(command);
  let input;
  for (const part of parts) input = await runArgv(words(part), cwd, input);
  return input ?? '';
}

async function run(command, cwd) {
  const trimmed = command.trim();
  const heredocAfterPath = trimmed.match(/^cat\s+>\s+(\S+)\s+<<['"]?(\w+)['"]?\n([\s\S]*)\n\2\s*$/);
  if (heredocAfterPath) {
    const [, rawPath, , content] = heredocAfterPath;
    const path = pathFor(rawPath, cwd);
    await state.writeFile(path, content ?? '');
    return 'wrote ' + path + '\n';
  }

  const heredocBeforePath = trimmed.match(/^cat\s+<<['"]?(\w+)['"]?\s+>\s+(\S+)\n([\s\S]*)\n\1\s*$/);
  if (heredocBeforePath) {
    const [, , rawPath, content] = heredocBeforePath;
    const path = pathFor(rawPath, cwd);
    await state.writeFile(path, content ?? '');
    return 'wrote ' + path + '\n';
  }

  const redirection = findRedirection(trimmed);
  if (redirection) {
    const path = pathFor(redirection.path, cwd);
    const output = await runPipeline(redirection.left, cwd);
    if (redirection.append) await state.appendFile(path, output);
    else await state.writeFile(path, output);
    return '';
  }

  return await runPipeline(trimmed, cwd);
}

async function runArgv(argv, cwd, stdin) {
  const [program, ...args] = argv;
  if (!program) return '';
  if (program === 'pwd') return cwd + '\n';

  if (program === 'help') return 'Supported commands: ' + SUPPORTED.join(', ') + '\n';
  if (program === 'which') return args.map((arg) => SUPPORTED.includes(arg) ? '/bin/' + arg : '').filter(Boolean).join('\n') + '\n';
  if (program === 'true') return '';
  if (program === 'false') throw new Error('false');
  if (program === 'clear') return '';
  if (program === 'date') return new Date().toISOString() + '\n';
  if (program === 'hostname') return 'dynamic-worker\n';
  if (program === 'whoami') return 'agent\n';
  if (program === 'env' || program === 'printenv') return 'PWD=' + cwd + '\nHOME=/workspace\n';

  if (program === 'echo') return args.filter((arg) => arg !== '-n').join(' ') + (args.includes('-n') ? '' : '\n');
  if (program === 'printf') return args.join(' ').replace(/\\n/g, '\n').replace(/\\t/g, '\t');

  if (program === 'basename') return basename(args[0] ?? cwd) + '\n';
  if (program === 'dirname') return dirname(args[0] ?? cwd) + '\n';
  if (program === 'realpath') return pathFor(args[0], cwd) + '\n';

  if (program === 'ls') {
    const target = args.filter((arg) => !arg.startsWith('-')).at(-1);
    return (await state.readdir(pathFor(target, cwd))).join('\n') + '\n';
  }

  if (program === 'tree') return text(await state.summarizeTree(pathFor(args.at(-1), cwd), { maxDepth: 4 })) + '\n';
  if (program === 'cat') return await readInputs(args, cwd, stdin);

  if (program === 'head') {
    const count = parseNumberFlag(args, '-n', 10);
    return lines(await readInputs(removeFlagValue(args, '-n'), cwd, stdin)).slice(0, count).join('\n') + '\n';
  }

  if (program === 'tail') {
    const count = parseNumberFlag(args, '-n', 10);
    return lines(await readInputs(removeFlagValue(args, '-n'), cwd, stdin)).slice(-count).join('\n') + '\n';
  }

  if (program === 'wc') {
    const input = await readInputs(args, cwd, stdin);
    const lineCount = lines(input).length;
    const wordCount = input.trim() ? input.trim().split(/\s+/).length : 0;
    const byteCount = new TextEncoder().encode(input).length;
    if (args.includes('-l')) return lineCount + '\n';
    if (args.includes('-w')) return wordCount + '\n';
    if (args.includes('-c')) return byteCount + '\n';
    return lineCount + ' ' + wordCount + ' ' + byteCount + '\n';
  }

  if (program === 'sort') return lines(await readInputs(args, cwd, stdin)).sort().join('\n') + '\n';
  if (program === 'uniq') return lines(await readInputs(args, cwd, stdin)).filter((line, i, arr) => i === 0 || line !== arr[i - 1]).join('\n') + '\n';
  if (program === 'nl') return lines(await readInputs(args, cwd, stdin)).map((line, i) => String(i + 1).padStart(6) + '\t' + line).join('\n') + '\n';
  if (program === 'rev') return lines(await readInputs(args, cwd, stdin)).map((line) => [...line].reverse().join('')).join('\n') + '\n';

  if (program === 'base64') {
    const input = await readInputs(args.filter((arg) => arg !== '-d' && arg !== '--decode'), cwd, stdin);
    if (args.includes('-d') || args.includes('--decode')) return atob(input.trim()) + '\n';
    return btoa(input) + '\n';
  }

  if (program === 'cut') {
    const delimiterIndex = args.indexOf('-d');
    const fieldIndex = args.indexOf('-f');
    const delimiter = delimiterIndex >= 0 ? args[delimiterIndex + 1] : '\t';
    const field = fieldIndex >= 0 ? Number(args[fieldIndex + 1]) - 1 : 0;
    const inputArgs = args.filter((arg, i) => !['-d', '-f'].includes(arg) && i !== delimiterIndex + 1 && i !== fieldIndex + 1);
    return lines(await readInputs(inputArgs, cwd, stdin)).map((line) => line.split(delimiter)[field] ?? '').join('\n') + '\n';
  }

  if (program === 'sed') {
    const script = args.find((arg) => arg.startsWith('s')) ?? '';
    const match = script.match(/^s(.)([\s\S]*)\1([\s\S]*)\1(g?)$/);
    if (!match) throw new Error('Only sed s/search/replace/[g] is supported');
    const [, , search, replacement, global] = match;
    const inputArgs = args.filter((arg) => arg !== script);
    const input = await readInputs(inputArgs, cwd, stdin);
    return input.replace(new RegExp(search, global ? 'g' : ''), replacement);
  }

  if (program === 'jq') {
    const raw = args.includes('-r');
    const query = args.find((arg) => !arg.startsWith('-')) ?? '.';
    const file = args.filter((arg) => !arg.startsWith('-')).find((arg) => arg !== query);
    let value = file ? await state.readJson(pathFor(file, cwd)) : JSON.parse(stdin ?? 'null');
    if (query !== '.') {
      for (const part of query.replace(/^\./, '').split('.').filter(Boolean)) value = value?.[part];
    }
    return (raw && typeof value === 'string' ? value : JSON.stringify(value, null, 2)) + '\n';
  }

  if (program === 'mkdir') {
    const target = args.filter((arg) => !arg.startsWith('-')).at(-1);
    const path = pathFor(target, cwd);
    await state.mkdir(path, { recursive: args.includes('-p') });
    return 'created ' + path + '\n';
  }

  if (program === 'cp') {
    const positional = optionless(args);
    const [src, dest] = positional.map((arg) => pathFor(arg, cwd));
    await state.cp(src, dest, { recursive: args.some((arg) => arg.includes('r') || arg.includes('R')) });
    return '';
  }

  if (program === 'mv') {
    const positional = optionless(args);
    const [src, dest] = positional.map((arg) => pathFor(arg, cwd));
    await state.mv(src, dest);
    return '';
  }

  if (program === 'ln') {
    if (!args.includes('-s')) throw new Error('Only ln -s is supported');
    const positional = optionless(args);
    await state.symlink(pathFor(positional[0], cwd), pathFor(positional[1], cwd));
    return '';
  }

  if (program === 'readlink') return await state.readlink(pathFor(args.at(-1), cwd)) + '\n';

  if (program === 'touch') {
    const path = pathFor(args[0], cwd);
    await state.writeFile(path, (await state.exists(path)) ? await state.readFile(path) : '');
    return 'touched ' + path + '\n';
  }

  if (program === 'rm') {
    const target = args.filter((arg) => !arg.startsWith('-')).at(-1);
    const path = pathFor(target, cwd);
    await state.rm(path, {
      force: args.some((arg) => arg.includes('f')),
      recursive: args.some((arg) => arg.includes('r')),
    });
    return 'removed ' + path + '\n';
  }

  if (program === 'rmdir') {
    await state.rm(pathFor(args[0], cwd), { recursive: false });
    return '';
  }

  if (program === 'chmod') return '';

  if (program === 'stat') return text(await state.stat(pathFor(args.at(-1), cwd))) + '\n';
  if (program === 'file') return text(await state.detectFile(pathFor(args.at(-1), cwd))) + '\n';
  if (program === 'du') return text(await state.summarizeTree(pathFor(args.at(-1), cwd), { maxDepth: 8 })) + '\n';

  if (program === 'grep' || program === 'egrep' || program === 'fgrep' || program === 'rg') {
    const positional = args.filter((arg) => !arg.startsWith('-'));
    const query = positional[0] ?? '';
    if (!positional[1] && stdin !== undefined) {
      return lines(stdin).filter((line) => line.includes(query)).join('\n') + '\n';
    }
    const target = pathFor(positional[1], cwd);
    const stat = await state.stat(target);
    if (stat?.type === 'file') return text(await state.searchText(target, query)) + '\n';
    return text(await state.searchFiles(target.replace(/\/$/, '') + '/**/*', query)) + '\n';
  }

  if (program === 'find') {
    const root = pathFor(args.find((arg) => !arg.startsWith('-') && arg !== 'f') ?? '.', cwd);
    const nameIndex = args.indexOf('-name');
    const namePattern = nameIndex >= 0 ? args[nameIndex + 1] : '*';
    const typeIndex = args.indexOf('-type');
    const type = typeIndex >= 0 && args[typeIndex + 1] === 'f' ? 'file' : typeIndex >= 0 && args[typeIndex + 1] === 'd' ? 'directory' : undefined;
    return (await state.find(root, { name: namePattern ?? '*', type })).map((entry) => entry.path).join('\n') + '\n';
  }

  if (program === 'diff') {
    const [left, right] = args.map((arg) => pathFor(arg, cwd));
    return await state.diff(left, right);
  }

  if (program === 'tee') {
    const input = stdin ?? '';
    for (const target of optionless(args)) {
      if (args.includes('-a')) await state.appendFile(pathFor(target, cwd), input);
      else await state.writeFile(pathFor(target, cwd), input);
    }
    return input;
  }

  if (program === 'sha256sum' || program === 'sha1sum' || program === 'md5sum') {
    const algorithm = program.replace('sum', '').toUpperCase().replace('SHA', 'SHA-');
    const target = args[0];
    if (!target && stdin !== undefined) return simpleHashPlaceholder(algorithm, stdin) + '  -\n';
    return await state.hashFile(pathFor(target, cwd), { algorithm }) + '  ' + target + '\n';
  }

  if (program === 'tar') {
    if (args.includes('-tf')) return text(await state.listArchive(pathFor(args.at(-1), cwd))) + '\n';
    if (args.includes('-xf')) return text(await state.extractArchive(pathFor(args.at(-1), cwd), cwd)) + '\n';
    const fileIndex = args.indexOf('-cf');
    if (fileIndex >= 0) {
      const archive = pathFor(args[fileIndex + 1], cwd);
      const sources = args.slice(fileIndex + 2).map((arg) => pathFor(arg, cwd));
      return text(await state.createArchive(archive, sources)) + '\n';
    }
  }

  if (program === 'gzip') return text(await state.compressFile(pathFor(args.at(-1), cwd))) + '\n';
  if (program === 'gunzip') return text(await state.decompressFile(pathFor(args.at(-1), cwd))) + '\n';
  if (program === 'zcat') return await state.readFile(pathFor(args.at(-1), cwd));

  throw new Error('Unsupported command: ' + program + '. Run help for supported commands.');
}
`;

function normalize(path: string) {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function adaptStat(stat: Awaited<ReturnType<WorkspaceFileSystem['stat']>>): FileStat {
  return {
    isFile: stat.type === 'file',
    isDirectory: stat.type === 'directory',
    isSymbolicLink: stat.type === 'symlink',
    size: stat.size,
    mtime: stat.mtime,
  };
}

function formatResult(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

export function cloudflareTerminalSandbox({ workspace, loader, cwd = '/' }: CloudflareTerminalOptions): SandboxFactory {
  const fs = new WorkspaceFileSystem(workspace);
  const executor = new DynamicWorkerExecutor({ loader });
  const stateProvider = resolveProvider(stateTools(workspace));
  const normalizedCwd = normalize(cwd);

  const resolvePath = (path: string) => {
    if (path.startsWith('/')) return normalize(path);
    return normalize(`${normalizedCwd}/${path}`);
  };

  const exec = async (command: string, options?: { cwd?: string }): Promise<ShellResult> => {
    const commandCwd = options?.cwd ? resolvePath(options.cwd) : normalizedCwd;
    const code = `async () => {\n${terminalRuntime}\nreturn await run(${JSON.stringify(command)}, ${JSON.stringify(commandCwd)});\n}`;
    const { result, error, logs } = await executor.execute(code, [stateProvider]);
    if (error) {
      return {
        stdout: '',
        stderr: error + (logs?.length ? `\n${logs.join('\n')}` : ''),
        exitCode: 1,
      };
    }
    return { stdout: formatResult(result), stderr: '', exitCode: 0 };
  };

  const createSessionEnv = async (): Promise<SessionEnv> => ({
    exec,
    readFile: (path) => fs.readFile(resolvePath(path)),
    readFileBuffer: (path) => fs.readFileBytes(resolvePath(path)),
    writeFile: async (path, content) => {
      const resolved = resolvePath(path);
      const parent = resolved.replace(/\/[^/]*$/, '') || '/';
      await fs.mkdir(parent, { recursive: true }).catch(() => undefined);
      if (typeof content === 'string') await workspace.writeFile(resolved, content);
      else await workspace.writeFileBytes(resolved, content);
    },
    stat: async (path) => adaptStat(await fs.stat(resolvePath(path))),
    readdir: (path) => fs.readdir(resolvePath(path)),
    exists: (path) => fs.exists(resolvePath(path)),
    mkdir: (path, options) => fs.mkdir(resolvePath(path), options),
    rm: (path, options) => fs.rm(resolvePath(path), options),
    cwd: normalizedCwd,
    resolvePath,
  });

  return { createSessionEnv };
}
