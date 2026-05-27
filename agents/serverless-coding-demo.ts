import { createAgent } from '@flue/runtime';
import type { MiddlewareHandler } from 'hono';
import { getDefaultWorkspace, getShellSandbox } from '../connectors/cloudflare-shell';
import { seedDemoWorkspace } from '../lib/demo-workspace';

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
 * durable @cloudflare/shell Workspace exposed through a Worker Loader-backed
 * `code` tool.
 */
export default createAgent(async ({ env }) => {
  const workspace = getDefaultWorkspace();
  await seedDemoWorkspace(workspace);

  return {
    model,
    sandbox: getShellSandbox({ workspace, loader: env.LOADER }),
    instructions: [
      'You are running inside the Flue serverless coding demo on Cloudflare Workers and Durable Objects.',
      'Use the code tool and its state API to inspect and modify the durable workspace.',
      'Prefer files under /workspace for this demo.',
      'When you finish, summarize the JavaScript actions you ran, files you inspected, and files you changed.',
    ].join('\n'),
  };
});
