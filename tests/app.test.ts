import { describe, expect, it } from 'vitest';
import app from '../app';

describe('demo web app', () => {
  it('serves the browser demo at the root route', async () => {
    const response = await app.fetch(new Request('http://localhost:3583/'), undefined, undefined);
    const body = await response.text();

    expect(response.headers.get('content-type')).toContain('text/html');
    expect(body).toContain('Serverless coding agent trace');
    expect(body).toContain('/agents/serverless-coding-demo/');
    expect(body).toContain('Accept: text/event-stream');
  });
});
