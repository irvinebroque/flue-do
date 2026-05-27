import { createAgent } from '@flue/runtime';
import { getDefaultWorkspace } from '@flue/runtime/cloudflare';
import { cloudflareTerminalSandbox } from '../lib/cloudflare-terminal';
import { seedDemoWorkspace } from '../lib/demo-workspace';

/** Model id passed to Flue for the hosted coding-agent session. */
const model = 'cloudflare/openai/gpt-5.5';

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
    instructions: [
      'You are running inside the Flue serverless coding demo on Cloudflare Workers and Durable Objects.',
      'Use the bash tool to inspect and modify the durable workspace when the user asks for terminal work.',
      'When you finish, summarize the commands you ran, files you inspected, and files you changed.',
    ].join('\n'),
  };
});
