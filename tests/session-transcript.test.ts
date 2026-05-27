import { describe, expect, it } from 'vitest';
import type { FlueContext, FlueEvent } from '@flue/runtime';
import { createSessionRecorder, formatSessionTranscript, runInspectionUrls } from '../lib/session-transcript';

describe('session transcript', () => {
  it('formats tool activity and final outcome', () => {
    const transcript = formatSessionTranscript({
      agent: 'serverless-coding-demo',
      instance: 'demo-session-1',
      runId: 'run_123',
      message: 'show me the serverless harness',
      events: [
        { type: 'operation_start', operationId: 'op_1', operationKind: 'prompt' },
        { type: 'tool_start', toolName: 'bash', toolCallId: 'tool_1', args: { command: 'ls' } },
        {
          type: 'tool_call',
          toolName: 'bash',
          toolCallId: 'tool_1',
          isError: false,
          durationMs: 12,
          result: { content: [{ type: 'text', text: 'foo.txt\nbar.txt\n' }] },
        },
        { type: 'text_delta', text: 'The agent used a Dynamic Worker terminal.' },
        { type: 'operation', operationId: 'op_1', operationKind: 'prompt', durationMs: 40, isError: false },
      ],
      outcome: { summary: 'done' },
      model: { id: 'cloudflare/openai/gpt-5.5' },
      eventsUrl: 'http://localhost:3583/runs/run_123/events?limit=1000',
      streamUrl: 'http://localhost:3583/runs/run_123/stream',
    });

    expect(transcript).toContain('Tool 1: bash');
    expect(transcript).toContain('```bash\nls\n```');
    expect(transcript).toContain('foo.txt');
    expect(transcript).toContain('The agent used a Dynamic Worker terminal.');
    expect(transcript).toContain('"summary": "done"');
    expect(transcript).toContain('/runs/run_123/events?limit=1000');
  });

  it('records user-facing events and hides thinking deltas', () => {
    const subscribers: Array<(event: FlueEvent) => void> = [];
    let unsubscribed = false;
    const ctx = {
      id: 'demo-session-1',
      runId: 'run_123',
      payload: {},
      env: {},
      req: new Request('http://localhost:3583/agents/serverless-coding-demo/demo-session-1'),
      log: { info() {}, warn() {}, error() {} },
      init: async () => { throw new Error('not used'); },
      subscribeEvent(callback: (event: FlueEvent) => void) {
        subscribers.push(callback);
        return () => { unsubscribed = true; };
      },
    } as unknown as FlueContext;

    const recorder = createSessionRecorder(ctx);
    subscribers[0]?.({ type: 'thinking_delta', delta: 'hidden reasoning' });
    subscribers[0]?.({ type: 'tool_start', toolName: 'bash', toolCallId: 'tool_1', args: { command: 'pwd' } });

    const events = recorder.stop();

    expect(recorder.available).toBe(true);
    expect(unsubscribed).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('tool_start');
  });

  it('builds run inspection URLs from the current request origin', () => {
    const ctx = {
      runId: 'run_123',
      req: new Request('http://localhost:3583/agents/serverless-coding-demo/demo-session-1'),
    } as FlueContext;

    expect(runInspectionUrls(ctx)).toEqual({
      run: 'http://localhost:3583/runs/run_123',
      events: 'http://localhost:3583/runs/run_123/events?limit=1000',
      stream: 'http://localhost:3583/runs/run_123/stream',
    });
  });
});
