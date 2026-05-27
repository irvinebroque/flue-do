import type { FlueContext } from '@flue/runtime';
import { getDefaultWorkspace } from '@flue/runtime/cloudflare';
import * as v from 'valibot';
import { cloudflareTerminalSandbox } from '../lib/cloudflare-terminal';
import { seedDemoWorkspace } from '../lib/demo-workspace';
import { createSessionRecorder, formatSessionTranscript, runInspectionUrls } from '../lib/session-transcript';

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

export default async function (ctx: FlueContext) {
  const { init, id, payload, env, runId } = ctx;
  const input = payload as DemoPayload;
  const message = text(
    input.message,
    'test.',
  );

  const workspace = getDefaultWorkspace();
  await seedDemoWorkspace(workspace);

  const harness = await init({
    sandbox: cloudflareTerminalSandbox({ workspace, loader: env.LOADER, cwd: '/workspace' }),
    model,
  });
  const session = await harness.session();
  const recorder = createSessionRecorder(ctx);

  const promptResult = await (async () => {
    try {
      return await session.prompt(
        `User request: ${message}`,
        {
          role: 'architect',
          result,
        },
      );
    } catch (error) {
      recorder.stop();
      throw error;
    }
  })();

  const { data, usage, model: selectedModel } = promptResult;
  const events = recorder.stop();
  const inspectionUrls = runInspectionUrls(ctx);
  const transcript = formatSessionTranscript({
    agent: 'serverless-coding-demo',
    instance: id,
    runId,
    message,
    events,
    outcome: data,
    model: selectedModel,
    usage,
    eventsUrl: inspectionUrls.events,
    streamUrl: inspectionUrls.stream,
  });

  return {
    agent: 'serverless-coding-demo',
    instance: id,
    runId,
    runtime: 'Flue harness in a Cloudflare Durable Object with @cloudflare/shell Dynamic Worker terminal execution',
    model,
    aiGateway: gateway,
    data,
    session: {
      transcript,
      events,
      eventCapture: recorder.available ? 'inline' : 'durable-run-log-only',
      run: inspectionUrls.run,
      eventsUrl: inspectionUrls.events,
      streamUrl: inspectionUrls.stream,
    },
  };
}
