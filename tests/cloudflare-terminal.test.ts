import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/cloudflare-terminal.ts', import.meta.url), 'utf8');
const terminalRuntime = source.match(/terminalRuntime = String\.raw`([\s\S]*?)`;\n\nfunction normalize/)?.[1];

if (!terminalRuntime) throw new Error('Could not extract terminalRuntime from lib/cloudflare-terminal.ts');

type Entry =
  | { type: 'file'; content: string }
  | { type: 'directory' }
  | { type: 'symlink'; target: string };

function normalize(path: string) {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function nameOf(path: string) {
  return normalize(path).split('/').pop() || '/';
}

function parentOf(path: string) {
  const normalized = normalize(path);
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}

function globToRegExp(pattern: string) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}$`);
}

class MockState {
  entries = new Map<string, Entry>();

  constructor(files: Record<string, string>) {
    this.entries.set('/', { type: 'directory' });
    for (const [path, content] of Object.entries(files)) this.writeFileSync(path, content);
  }

  private mkdirp(path: string) {
    let current = '';
    for (const part of normalize(path).split('/').filter(Boolean)) {
      current += `/${part}`;
      if (!this.entries.has(current)) this.entries.set(current, { type: 'directory' });
    }
  }

  private writeFileSync(path: string, content: string) {
    const normalized = normalize(path);
    this.mkdirp(parentOf(normalized));
    this.entries.set(normalized, { type: 'file', content });
  }

  async readFile(path: string) {
    const entry = this.entries.get(normalize(path));
    if (!entry || entry.type !== 'file') throw new Error(`ENOENT: ${path}`);
    return entry.content;
  }

  async writeFile(path: string, content: string) {
    this.writeFileSync(path, content);
  }

  async appendFile(path: string, content: string) {
    const normalized = normalize(path);
    const existing = this.entries.get(normalized);
    this.writeFileSync(normalized, (existing?.type === 'file' ? existing.content : '') + content);
  }

  async exists(path: string) {
    return this.entries.has(normalize(path));
  }

  async mkdir(path: string) {
    this.mkdirp(path);
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }) {
    const normalized = normalize(path);
    if (!this.entries.has(normalized)) {
      if (options?.force) return;
      throw new Error(`ENOENT: ${path}`);
    }
    for (const key of [...this.entries.keys()]) {
      if (key === normalized || (options?.recursive && key.startsWith(`${normalized}/`))) {
        this.entries.delete(key);
      }
    }
  }

  async readdir(path: string) {
    const normalized = normalize(path);
    const prefix = normalized === '/' ? '/' : `${normalized}/`;
    return [...this.entries.keys()]
      .filter((key) => key.startsWith(prefix) && key !== normalized)
      .map((key) => key.slice(prefix.length).split('/')[0])
      .filter((value, index, array) => value && array.indexOf(value) === index)
      .sort();
  }

  async stat(path: string) {
    const normalized = normalize(path);
    const entry = this.entries.get(normalized);
    if (!entry) return null;
    return { type: entry.type, size: entry.type === 'file' ? entry.content.length : 0, mtime: new Date(0) };
  }

  async cp(src: string, dest: string, options?: { recursive?: boolean }) {
    const from = normalize(src);
    const to = normalize(dest);
    const entry = this.entries.get(from);
    if (!entry) throw new Error(`ENOENT: ${src}`);
    if (entry.type === 'file') this.writeFileSync(to, entry.content);
    if (entry.type === 'directory' && options?.recursive) {
      this.mkdirp(to);
      for (const [key, child] of this.entries) {
        if (key.startsWith(`${from}/`) && child.type === 'file') this.writeFileSync(`${to}${key.slice(from.length)}`, child.content);
      }
    }
  }

  async mv(src: string, dest: string) {
    await this.cp(src, dest, { recursive: true });
    await this.rm(src, { recursive: true });
  }

  async symlink(target: string, linkPath: string) {
    this.entries.set(normalize(linkPath), { type: 'symlink', target: normalize(target) });
  }

  async readlink(path: string) {
    const entry = this.entries.get(normalize(path));
    if (!entry || entry.type !== 'symlink') throw new Error(`EINVAL: ${path}`);
    return entry.target;
  }

  async searchText(path: string, query: string) {
    return (await this.readFile(path))
      .split('\n')
      .map((lineText, index) => ({ line: index + 1, match: query, lineText }))
      .filter((match) => match.lineText.includes(query));
  }

  async searchFiles(pattern: string, query: string) {
    const regex = globToRegExp(normalize(pattern));
    const results = [];
    for (const [path, entry] of this.entries) {
      if (entry.type === 'file' && regex.test(path) && entry.content.includes(query)) {
        results.push({ path, matches: await this.searchText(path, query) });
      }
    }
    return results;
  }

  async find(root: string, options?: { name?: string; type?: string }) {
    const normalized = normalize(root);
    const nameRegex = globToRegExp(options?.name ?? '*');
    return [...this.entries.entries()]
      .filter(([path]) => path !== normalized && path.startsWith(`${normalized}/`))
      .filter(([, entry]) => !options?.type || entry.type === options.type)
      .filter(([path]) => nameRegex.test(nameOf(path)))
      .map(([path, entry]) => ({ path, name: nameOf(path), type: entry.type, depth: path.split('/').length - normalized.split('/').length, size: entry.type === 'file' ? entry.content.length : 0, mtime: new Date(0) }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async glob(pattern: string) {
    const regex = globToRegExp(normalize(pattern));
    return [...this.entries.keys()].filter((path) => regex.test(path)).sort();
  }

  async summarizeTree(path: string) {
    return { root: normalize(path), entries: await this.find(path) };
  }

  async diff(left: string, right: string) {
    return `${await this.readFile(left)}---\n${await this.readFile(right)}`;
  }

  async readJson(path: string) {
    return JSON.parse(await this.readFile(path));
  }

  async detectFile(path: string) {
    const stat = await this.stat(path);
    return { type: stat?.type ?? 'missing' };
  }

  async hashFile(path: string, options: { algorithm: string }) {
    return `${options.algorithm}:${(await this.readFile(path)).length}`;
  }
}

function createRunner(files: Record<string, string>) {
  const state = new MockState(files);
  const run = new Function('state', `${terminalRuntime}; return run;`)(state) as (command: string, cwd: string) => Promise<string>;
  return { state, run: (command: string, cwd = '/workspace') => run(command, cwd) };
}

describe('cloudflare terminal runtime', () => {
  it('lists, reads, searches, and writes workspace files', async () => {
    const { state, run } = createRunner({
      '/workspace/foo.txt': 'foo\n',
      '/workspace/bar.txt': 'bar\n',
    });

    expect(await run('pwd')).toBe('/workspace\n');
    expect(await run('ls')).toContain('foo.txt');
    expect(await run('cat foo.txt')).toBe('foo\n');
    expect(await run('grep -R "foo" .')).toContain('/workspace/foo.txt');

    await run('cat > /tmp/out.md <<EOF\nhello\nEOF');
    expect(await state.readFile('/tmp/out.md')).toBe('hello');
  });

  it('supports pipes and redirection', async () => {
    const { state, run } = createRunner({
      '/workspace/lines.txt': 'b\na\na\n',
    });

    expect(await run('cat lines.txt | sort | uniq')).toBe('a\nb\n');

    await run('cat lines.txt | grep a > result.txt');
    expect(await state.readFile('/workspace/result.txt')).toBe('a\na\n');

    await run('echo done >> result.txt');
    expect(await state.readFile('/workspace/result.txt')).toBe('a\na\ndone\n');
  });

  it('supports common shell sequencing and conditionals', async () => {
    const { run } = createRunner({
      '/workspace/foo.txt': 'foo\n',
      '/workspace/bar.txt': 'bar\n',
    });

    expect(await run('pwd && ls && cat foo.txt')).toBe('/workspace\nbar.txt\nfoo.txt\nfoo\n');
    expect(await run('false || echo recovered')).toBe('recovered\n');
    expect(await run('set -x\npwd\ncat bar.txt')).toBe('/workspace\nbar\n');
  });

  it('runs multiline redirection followed by another command', async () => {
    const { state, run } = createRunner({});

    const output = await run("printf 'hello\\n' > /tmp/demo-output.md\ncat /tmp/demo-output.md");

    expect(await state.readFile('/tmp/demo-output.md')).toBe('hello\n');
    expect(output).toBe('hello\n');
  });

  it('prints grep results like a terminal', async () => {
    const { run } = createRunner({
      '/workspace/brief.md': '# Serverless Agent Harness\nCloudflare demo\n',
      '/workspace/data.json': '{"done":false}\n',
    });

    expect(await run('grep -RIn Serverless .')).toBe('/workspace/brief.md:1:# Serverless Agent Harness\n');
    expect(await run("grep -RInE 'Serverless|Cloudflare' .")).toBe('/workspace/brief.md:1:# Serverless Agent Harness\n/workspace/brief.md:2:Cloudflare demo\n');
  });

  it('supports simple for loops over workspace files', async () => {
    const { run } = createRunner({
      '/workspace/foo.txt': 'foo\n',
      '/workspace/bar.txt': 'bar\n',
    });

    expect(await run('for f in *; do echo "--- $f ---"; cat "$f"; done')).toBe('--- bar.txt ---\nbar\n--- foo.txt ---\nfoo\n');
  });

  it('supports common text utilities', async () => {
    const { run } = createRunner({
      '/workspace/lines.txt': 'one\ntwo\nthree\n',
      '/workspace/table.txt': 'a,1\nb,2\n',
    });

    expect(await run('head -n 2 lines.txt')).toBe('one\ntwo\n');
    expect(await run('tail -n 1 lines.txt')).toBe('three\n');
    expect(await run('wc -l lines.txt')).toBe('3\n');
    expect(await run('cut -d , -f 2 table.txt')).toBe('1\n2\n');
    expect(await run('sed s/two/2/ lines.txt')).toBe('one\n2\nthree\n');
  });

  it('supports json, find filters, and file operations', async () => {
    const { state, run } = createRunner({
      '/workspace/data.json': JSON.stringify({ foo: 'bar', nested: { value: 1 } }),
      '/workspace/dir/a.txt': 'a',
      '/workspace/dir/b.md': 'b',
    });

    expect(await run('jq -r .foo data.json')).toBe('bar\n');
    expect(await run('find . -type f -name "*.txt"')).toBe('/workspace/dir/a.txt\n');

    await run('cp dir/a.txt copied.txt');
    expect(await state.readFile('/workspace/copied.txt')).toBe('a');
    await run('mv copied.txt moved.txt');
    expect(await state.readFile('/workspace/moved.txt')).toBe('a');
    await run('rm moved.txt');
    expect(await state.exists('/workspace/moved.txt')).toBe(false);
  });

  it('reports supported commands through help', async () => {
    const { run } = createRunner({});
    const output = await run('help');
    expect(output).toContain('grep');
    expect(output).toContain('jq');
    expect(output).toContain('tar');
  });
});
