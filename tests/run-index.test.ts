import { describe, expect, it, vi } from 'vitest';
import { indexDirectAgentRunResponse, listRecentRunPointers, readRunPointer } from '../lib/run-index';

function sse(frames: Array<{ event?: string; data?: unknown }>) {
  return frames.map((frame, index) => [
    `event: ${frame.event || 'message'}`,
    `id: ${index}`,
    `data: ${JSON.stringify(frame.data ?? { type: 'idle' })}`,
    '',
    '',
  ].join('\n')).join('');
}

describe('run pointer index', () => {
  it('passes SSE responses through while scheduling pointer updates only', async () => {
    const body = sse([
      { data: { type: 'tool_start', toolName: 'bash', args: { command: 'cat brief.md' } } },
      { data: { type: 'idle' } },
    ]);
    const waitUntil = vi.fn((promise: Promise<unknown>) => void promise.catch(() => undefined));
    const response = await indexDirectAgentRunResponse({
      response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
      env: {},
      ctx: { waitUntil },
      agentName: 'serverless-coding-demo',
      agentInstanceId: 'demo',
      session: 'default',
    });

    await expect(response.text()).resolves.toBe(body);
    expect(response.headers.get('x-flue-demo-run-id')).toMatch(/^agent-/);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('returns empty pointer history when no Artifacts binding is configured', async () => {
    await expect(listRecentRunPointers({}, 5)).resolves.toEqual([]);
    await expect(readRunPointer({}, 'missing')).resolves.toBeNull();
  });
});
