import type { FlueContext } from '@flue/runtime';
import { getDefaultWorkspace } from '@flue/runtime/cloudflare';
import * as v from 'valibot';
import { cloudflareTerminalSandbox } from '../lib/cloudflare-terminal';
import { seedDemoWorkspace } from '../lib/demo-workspace';

/** Enable Flue's HTTP webhook route for this agent module. */
export const triggers = { webhook: true };

/** Model id passed to Flue for the hosted coding-agent session. */
const model = 'cloudflare/openai/gpt-5.5';

/** AI Gateway name used by the configured Cloudflare account. */
const gateway = 'default';

/**
 * Structured result contract requested from the model.
 *
 * The browser UI renders these fields as the final outcome, while tests and demo
 * users can still inspect the raw run events for the full tool trace.
 */
const result = v.object({
  summary: v.string(),
  terminalCommands: v.array(v.string()),
  filesInspected: v.array(v.string()),
  filesChanged: v.array(v.string())
});

type DemoPayload = {
  message?: unknown;
};

/** Returns a non-empty string payload value, or the demo's default prompt. */
function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

/**
 * Builds links to Flue's run inspection endpoints relative to the incoming request.
 *
 * These URLs are included in the agent response so the browser can persist links
 * to the event log and replay stream for each saved chat run.
 */
function runInspectionUrls(runId: string, req: Request | undefined) {
  const path = `/runs/${encodeURIComponent(runId)}`;
  const origin = req ? new URL(req.url).origin : '';

  return {
    run: `${origin}${path}`,
    eventsUrl: `${origin}${path}/events?limit=1000`,
    streamUrl: `${origin}${path}/stream`,
  };
}

/**
 * Flue agent entrypoint for the serverless coding demo.
 *
 * Each HTTP id maps to a Durable Object-backed Flue context. The handler seeds a
 * durable @cloudflare/shell Workspace, exposes it as a `bash` tool through the
 * just-bash adapter, and asks the model to return a small structured summary of
 * the commands and files it touched.
 */
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
    runtime: 'Flue harness in a Cloudflare Durable Object with just-bash terminal semantics over a durable @cloudflare/shell Workspace',
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
