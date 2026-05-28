import { createAgent } from '@flue/runtime';
import { getDefaultWorkspace } from '@flue/runtime/cloudflare';
import type { MiddlewareHandler } from 'hono';
import { createArtifactRepoTools } from '../lib/artifact-repo-tools';
import { cloudflareTerminalSandbox } from '../lib/cloudflare-terminal';
import { seedDemoWorkspace } from '../lib/demo-workspace';
import { createRunHistoryTools } from '../lib/run-index';

/** Model id passed to Flue for the hosted coding-agent session. */
const model = 'cloudflare/openai/gpt-5.5';

/** Expose this created agent over Flue's POST /agents/:name/:id route. */
export const route: MiddlewareHandler = async (_c, next) => {
  await next();
};

/**
 * Flue 0.8 agent definition for the serverless coding demo.
 *
 * Each HTTP id maps to a Durable Object-backed Flue session. The agent uses a
 * durable @cloudflare/shell Workspace, exposed through this demo's `bash` tool
 * so the model keeps the broad just-bash command set.
 */
export default createAgent(async ({ env }) => {
  const workspace = getDefaultWorkspace();
  await seedDemoWorkspace(workspace);

  return {
    model,
    sandbox: cloudflareTerminalSandbox({ workspace, loader: env.LOADER, cwd: '/workspace' }),
    tools: [
      ...createRunHistoryTools(env),
      ...createArtifactRepoTools({ workspace, env }),
    ],
    instructions: [
      'You are running inside the Flue serverless coding demo on Cloudflare Workers and Durable Objects.',
      'The canonical source of your own agent codebase is a Cloudflare Artifacts Git repository, not local session memory.',
      'Use list_recent_runs and read_run to inspect global prior runs before deciding how to improve yourself.',
      'Use repo_prepare to check out the canonical Artifacts repo into /repo, then use read, edit, write, bash, and repo_* tools to inspect and modify it.',
      'When you self-improve, create a branch named self-improve/<short-run-or-task-id>, commit the change, and push that branch with repo_push. Never push directly to main.',
      'Prefer improving prompts, context files, AGENTS.md, or other low-risk agent operating context first. You may edit source when it is clearly justified.',
      'An external deployer, not this running invocation, is responsible for building and deploying pushed Artifact commits so future runs execute updated code.',
      'When you finish, summarize prior runs inspected, repository files inspected, files changed, branch/commit pushed, and remaining deploy/review steps.',
    ].join('\n'),
  };
});
