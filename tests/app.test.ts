import { describe, expect, it } from 'vitest';
import app from '../app';

describe('demo web app', () => {
  it('serves the browser demo at the root route', async () => {
    const response = await app.fetch(new Request('http://localhost:3583/'), undefined, undefined);
    const body = await response.text();

    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('@cloudflare/kumo@2.3.0');
    expect(body).toContain('What should the agent show?');
    expect(body).toContain('/agents/serverless-coding-demo/');
    expect(body).toContain("accept: 'text/event-stream'");
    expect(body).toContain('Terminal command');
    expect(body).toContain('Final outcome');
    expect(body).not.toContain('Serverless coding agent trace');
  });
});
