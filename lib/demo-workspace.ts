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
    '# Serverless Self-Improving Agent Harness',
    '',
    'This demo runs a Flue harness on Cloudflare Workers and Durable Objects.',
    'The running agent can inspect global prior run summaries, check out its canonical Cloudflare Artifacts Git repository into /repo, edit its own codebase, commit to a self-improvement branch, and push that branch for an external deployer.',
    'Terminal commands are interpreted by just-bash and operate through Flue-compatible @cloudflare/shell Workspace plumbing. Git operations are exposed through repo_* tools backed by the Artifacts repository.',
    'No container sandbox is required for this demonstration.',
    '',
  ].join('\n'),
  '/workspace/self-improvement-playbook.md': [
    '# Self-Improvement Playbook',
    '',
    '1. Call list_recent_runs and read_run to understand previous behavior.',
    '2. Call repo_prepare to materialize the canonical source repository at /repo.',
    '3. Inspect likely prompt/context/source files with read, grep, bash, and repo_log.',
    '4. Create a branch named self-improve/<run-or-task-id>.',
    '5. Edit low-risk prompt or context files first unless source changes are clearly warranted.',
    '6. Use repo_diff and repo_status before committing.',
    '7. Commit and push the branch. A separate deployer handles build and deploy.',
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
