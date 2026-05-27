import type { Workspace } from '@cloudflare/shell';

const seedMarker = '/.demo-v5';

const files: Record<string, string> = {
  '/workspace/foo.txt': 'foo\n',
  '/workspace/bar.txt': 'bar\n',
  '/workspace/data.json': JSON.stringify({ foo: 'bar', done: false }, null, 2),
  '/workspace/brief.md': [
    '# Serverless Agent Harness',
    '',
    'This demo runs a Flue harness on Cloudflare Workers and Durable Objects.',
    'Terminal commands execute through @cloudflare/shell and a Dynamic Worker.',
    'No container sandbox is required for this demonstration.',
    '',
  ].join('\n'),
};

export async function seedDemoWorkspace(workspace: Workspace) {
  const staleAgents = await workspace.readFile('/workspace/AGENTS.md').catch(() => null);
  if (staleAgents?.includes('terminal-first Cloudflare serverless agent demo')) {
    await workspace.rm('/workspace/AGENTS.md', { force: true });
  }

  if (await workspace.exists(seedMarker)) return;

  await workspace.mkdir('/workspace', { recursive: true });
  await workspace.mkdir('/tmp', { recursive: true });

  for (const [path, content] of Object.entries(files)) {
    await workspace.writeFile(path, content);
  }

  await workspace.writeFile(seedMarker, new Date().toISOString());
}
