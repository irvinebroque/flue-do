import type { Workspace } from '@cloudflare/shell';

/**
 * File written after the demo workspace has been initialized.
 *
 * The marker makes seeding idempotent for a Durable Object-backed Workspace: the
 * first run creates predictable demo files, and later runs preserve any changes
 * the agent made while still reusing the same chat/session id.
 */
const seedMarker = '/.demo-v6';

/** Initial files that give the coding-agent demo something concrete to inspect. */
const files: Record<string, string> = {
  '/workspace/foo.txt': 'foo\n',
  '/workspace/bar.txt': 'bar\n',
  '/workspace/data.json': JSON.stringify({ foo: 'bar', done: false }, null, 2),
  '/workspace/brief.md': [
    '# Serverless Agent Harness',
    '',
    'This demo runs a Flue harness on Cloudflare Workers and Durable Objects.',
    'The code tool runs JavaScript against a durable @cloudflare/shell Workspace through a Worker Loader binding.',
    'No container sandbox is required for this demonstration.',
    '',
  ].join('\n'),
};

/**
 * Ensures the durable Workspace contains the starter files used by the demo.
 *
 * The Workspace may survive across prompts for the same Durable Object instance,
 * so this function intentionally does not overwrite files after the marker is
 * present. That lets the UI demonstrate persisted filesystem state between runs.
 */
export async function seedDemoWorkspace(workspace: Workspace) {
  if (await workspace.exists(seedMarker)) return;

  await workspace.mkdir('/workspace', { recursive: true });
  await workspace.mkdir('/tmp', { recursive: true });

  for (const [path, content] of Object.entries(files)) {
    await workspace.writeFile(path, content);
  }

  await workspace.writeFile(seedMarker, new Date().toISOString());
}
