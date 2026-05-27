import type { Workspace } from '@cloudflare/shell';

const seedMarker = '/.demo-v3';

const files: Record<string, string> = {
  '/workspace/AGENTS.md': 'Use bash tools. Keep the demo short.\n',
  '/workspace/foo.txt': 'foo\n',
  '/workspace/bar.txt': 'bar\n',
  '/workspace/data.json': JSON.stringify({ foo: 'bar', done: false }, null, 2),
};

export async function seedDemoWorkspace(workspace: Workspace) {
  if (await workspace.exists(seedMarker)) return;

  await workspace.mkdir('/workspace', { recursive: true });
  await workspace.mkdir('/tmp', { recursive: true });

  for (const [path, content] of Object.entries(files)) {
    await workspace.writeFile(path, content);
  }

  await workspace.writeFile(seedMarker, new Date().toISOString());
}
