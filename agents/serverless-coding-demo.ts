import type { FlueContext } from '@flue/runtime';
import { getDefaultWorkspace } from '@flue/runtime/cloudflare';
import * as v from 'valibot';
import { cloudflareTerminalSandbox } from '../lib/cloudflare-terminal';
import { seedDemoWorkspace } from '../lib/demo-workspace';

export const triggers = { webhook: true };

const model = 'cloudflare/openai/gpt-5.5';
const gateway = 'default';

const result = v.object({
  summary: v.string(),
  terminalCommands: v.array(v.string()),
  filesInspected: v.array(v.string()),
  filesChanged: v.array(v.string())
});

type DemoPayload = {
  message?: unknown;
};

function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function runInspectionUrls(runId: string, req: Request | undefined) {
  const path = `/runs/${encodeURIComponent(runId)}`;
  const origin = req ? new URL(req.url).origin : '';

  return {
    run: `${origin}${path}`,
    eventsUrl: `${origin}${path}/events?limit=1000`,
    streamUrl: `${origin}${path}/stream`,
  };
}

export default async function (ctx: FlueContext) {
  const { init, id, payload, env, req, runId } = ctx;
  const input = payload as DemoPayload;
  const message = text(
    input.message,
    'Use the terminal to inspect this workspace and summarize what you found.',
  );

  const workspace = getDefaultWorkspace();
  await seedDemoWorkspace(workspace);

  const harness = await init({
    sandbox: cloudflareTerminalSandbox({ workspace, loader: env.LOADER, cwd: '/workspace' }),
    model,
  });
  const session = await harness.session();

  const { data, usage, model: selectedModel } = await session.prompt(message, { result });
  const inspectionUrls = runInspectionUrls(runId, req);

  return {
    agent: 'serverless-coding-demo',
    instance: id,
    runId,
    runtime: 'Flue harness in a Cloudflare Durable Object with @cloudflare/shell Dynamic Worker terminal execution',
    model,
    aiGateway: gateway,
    data,
    call: {
      model: selectedModel,
      usage,
    },
    run: inspectionUrls,
  };
}
