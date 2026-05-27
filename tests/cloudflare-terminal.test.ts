import { describe, expect, it } from 'vitest';
import { createWorkspaceBash } from '../lib/cloudflare-terminal';

/** In-memory equivalent of the Workspace entries needed by the terminal tests. */
type Entry =
  | { type: 'file'; content: string | Uint8Array; mtime: Date }
  | { type: 'directory'; mtime: Date }
  | { type: 'symlink'; target: string; mtime: Date };

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

/**
 * Minimal @cloudflare/shell Workspace test double.
 *
 * The adapter is intentionally tested without Cloudflare storage so command
 * semantics can be verified quickly and deterministically in Vitest.
 */
class MockWorkspace {
  entries = new Map<string, Entry>();

  constructor(files: Record<string, string>) {
    this.entries.set('/', { type: 'directory', mtime: new Date(0) });
    for (const [path, content] of Object.entries(files)) this.writeFileSync(path, content);
  }

  private mkdirp(path: string) {
    let current = '';
    for (const part of normalize(path).split('/').filter(Boolean)) {
      current += `/${part}`;
      if (!this.entries.has(current)) this.entries.set(current, { type: 'directory', mtime: new Date(0) });
    }
  }

  private writeFileSync(path: string, content: string | Uint8Array) {
    const normalized = normalize(path);
    this.mkdirp(parentOf(normalized));
    this.entries.set(normalized, { type: 'file', content, mtime: new Date(0) });
  }

  async readFile(path: string) {
    const entry = this.entries.get(normalize(path));
    if (!entry || entry.type !== 'file') return null;
    return typeof entry.content === 'string' ? entry.content : new TextDecoder().decode(entry.content);
  }

  async readFileBytes(path: string) {
    const entry = this.entries.get(normalize(path));
    if (!entry || entry.type !== 'file') return null;
    return typeof entry.content === 'string' ? new TextEncoder().encode(entry.content) : entry.content;
  }

  async writeFile(path: string, content: string) {
    this.writeFileSync(path, content);
  }

  async writeFileBytes(path: string, content: Uint8Array) {
    this.writeFileSync(path, content);
  }

  async appendFile(path: string, content: string) {
    this.writeFileSync(path, ((await this.readFile(path)) ?? '') + content);
  }

  async exists(path: string) {
    return this.entries.has(normalize(path));
  }

  async stat(path: string) {
    const normalized = normalize(path);
    const entry = this.entries.get(normalized);
    if (!entry) return null;
    return {
      path: normalized,
      name: nameOf(normalized),
      type: entry.type,
      mimeType: entry.type === 'directory' ? 'inode/directory' : 'text/plain',
      size: entry.type === 'file' ? (typeof entry.content === 'string' ? entry.content.length : entry.content.byteLength) : 0,
      createdAt: entry.mtime.getTime(),
      updatedAt: entry.mtime.getTime(),
    };
  }

  async lstat(path: string) {
    return this.stat(path);
  }

  async mkdir(path: string) {
    this.mkdirp(path);
  }

  async readDir(path = '/') {
    const normalized = normalize(path);
    const prefix = normalized === '/' ? '/' : `${normalized}/`;
    const children = new Set<string>();
    for (const key of this.entries.keys()) {
      if (key === normalized || !key.startsWith(prefix)) continue;
      const child = key.slice(prefix.length).split('/')[0];
      if (child) children.add(`${prefix}${child}`);
    }
    return (await Promise.all([...children].sort().map((child) => this.stat(child)))).filter((entry) => entry !== null);
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }) {
    const normalized = normalize(path);
    if (!this.entries.has(normalized)) {
      if (options?.force) return;
      throw new Error(`ENOENT: ${path}`);
    }
    const entry = this.entries.get(normalized);
    if (entry?.type === 'directory' && !options?.recursive) {
      const hasChildren = [...this.entries.keys()].some((key) => key.startsWith(`${normalized}/`));
      if (hasChildren) throw new Error(`ENOTEMPTY: ${path}`);
    }
    for (const key of [...this.entries.keys()]) {
      if (key === normalized || key.startsWith(`${normalized}/`)) this.entries.delete(key);
    }
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
    this.entries.set(normalize(linkPath), { type: 'symlink', target: normalize(target), mtime: new Date(0) });
  }

  async readlink(path: string) {
    const entry = this.entries.get(normalize(path));
    if (!entry || entry.type !== 'symlink') throw new Error(`EINVAL: ${path}`);
    return entry.target;
  }

  async _getAllPaths() {
    return [...this.entries.keys()].sort();
  }
}

/** Creates a bash runner rooted at /workspace for concise command assertions. */
async function createRunner(files: Record<string, string>) {
  const workspace = new MockWorkspace(files);
  const bash = await createWorkspaceBash(workspace, '/workspace');
  return {
    workspace,
    run: (command: string, cwd = '/workspace') => bash.exec(command, { cwd }),
  };
}

describe('cloudflare terminal runtime', () => {
  it('lists, reads, searches, and writes workspace files', async () => {
    const { workspace, run } = await createRunner({
      '/workspace/foo.txt': 'foo\n',
      '/workspace/bar.txt': 'bar\n',
    });

    expect((await run('pwd')).stdout).toBe('/workspace\n');
    expect((await run('ls')).stdout).toContain('foo.txt');
    expect((await run('cat foo.txt')).stdout).toBe('foo\n');
    expect((await run('grep -R "foo" .')).stdout).toContain('foo');

    await run('cat > /tmp/out.md <<EOF\nhello\nEOF');
    expect(await workspace.readFile('/tmp/out.md')).toBe('hello\n');
  });

  it('supports pipes and redirection', async () => {
    const { workspace, run } = await createRunner({
      '/workspace/lines.txt': 'b\na\na\n',
    });

    expect((await run('cat lines.txt | sort | uniq')).stdout).toBe('a\nb\n');

    await run('cat lines.txt | grep a > result.txt');
    expect(await workspace.readFile('/workspace/result.txt')).toBe('a\na\n');

    await run('echo done >> result.txt');
    expect(await workspace.readFile('/workspace/result.txt')).toBe('a\na\ndone\n');
  });

  it('supports common shell sequencing and conditionals', async () => {
    const { run } = await createRunner({
      '/workspace/foo.txt': 'foo\n',
      '/workspace/bar.txt': 'bar\n',
    });

    const chained = await run('pwd && ls && cat foo.txt');
    expect(chained.stdout).toContain('/workspace');
    expect(chained.stdout).toContain('foo.txt');
    expect(chained.stdout).toContain('foo');
    expect((await run('false || echo recovered')).stdout).toBe('recovered\n');
    expect((await run('set -x\npwd\ncat bar.txt')).stdout).toContain('bar');
  });

  it('runs multiline redirection followed by another command', async () => {
    const { workspace, run } = await createRunner({});

    const result = await run("printf 'hello\\n' > /tmp/demo-output.md\ncat /tmp/demo-output.md");

    expect(await workspace.readFile('/tmp/demo-output.md')).toBe('hello\n');
    expect(result.stdout).toBe('hello\n');
  });

  it('prints grep results like a terminal', async () => {
    const { run } = await createRunner({
      '/workspace/brief.md': '# Serverless Agent Harness\nCloudflare demo\n',
      '/workspace/data.json': '{"done":false}\n',
    });

    expect((await run('grep -RIn Serverless .')).stdout).toContain('brief.md:1:# Serverless Agent Harness');
    const regex = await run("grep -RInE 'Serverless|Cloudflare' .");
    expect(regex.stdout).toContain('brief.md:1:# Serverless Agent Harness');
    expect(regex.stdout).toContain('brief.md:2:Cloudflare demo');
    expect((await run('grep -Rni "serverless\\|demo" .')).stdout).toContain('brief.md:1:# Serverless Agent Harness');
  });

  it('supports simple for loops over workspace files', async () => {
    const { run } = await createRunner({
      '/workspace/foo.txt': 'foo\n',
      '/workspace/bar.txt': 'bar\n',
    });

    const result = await run('for f in *; do echo "--- $f ---"; cat "$f"; done');
    expect(result.stdout).toContain('--- bar.txt ---');
    expect(result.stdout).toContain('bar');
    expect(result.stdout).toContain('--- foo.txt ---');
    expect(result.stdout).toContain('foo');
  });

  it('supports common text utilities', async () => {
    const { run } = await createRunner({
      '/workspace/lines.txt': 'one\ntwo\nthree\n',
      '/workspace/table.txt': 'a,1\nb,2\n',
    });

    expect((await run('head -n 2 lines.txt')).stdout).toBe('one\ntwo\n');
    expect((await run('tail -n 1 lines.txt')).stdout).toBe('three\n');
    expect((await run('wc -l lines.txt')).stdout).toContain('3');
    expect((await run('cut -d , -f 2 table.txt')).stdout).toBe('1\n2\n');
    expect((await run('sed s/two/2/ lines.txt')).stdout).toBe('one\n2\nthree\n');
  });

  it('supports json, find filters, and file operations', async () => {
    const { workspace, run } = await createRunner({
      '/workspace/data.json': JSON.stringify({ foo: 'bar', nested: { value: 1 } }),
      '/workspace/dir/a.txt': 'a',
      '/workspace/dir/b.md': 'b',
    });

    expect((await run('jq -r .foo data.json')).stdout).toBe('bar\n');
    expect((await run('find . -type f -name "*.txt"')).stdout).toContain('dir/a.txt');

    await run('cp dir/a.txt copied.txt');
    expect(await workspace.readFile('/workspace/copied.txt')).toBe('a');
    await run('mv copied.txt moved.txt');
    expect(await workspace.readFile('/workspace/moved.txt')).toBe('a');
    await run('rm moved.txt');
    expect(await workspace.exists('/workspace/moved.txt')).toBe(false);
  });

  it('reports supported commands through help', async () => {
    const { run } = await createRunner({});
    const output = (await run('help')).stdout;
    expect(output).toContain('shell builtins');
    expect(output).toContain('printf');
  });
});
