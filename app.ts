import { flue, type Fetchable } from '@flue/runtime/app';

const flueApp = flue();

const html = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Flue Serverless Coding Agent Demo</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #08111f;
      --panel: rgba(12, 24, 43, 0.86);
      --panel-strong: #101e34;
      --line: rgba(134, 165, 217, 0.24);
      --text: #edf4ff;
      --muted: #9cb0cb;
      --accent: #66e3ff;
      --accent-2: #b99cff;
      --good: #7dffbd;
      --bad: #ff8b8b;
      --code: #06101d;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(102, 227, 255, 0.18), transparent 32rem),
        radial-gradient(circle at 80% 10%, rgba(185, 156, 255, 0.18), transparent 28rem),
        linear-gradient(135deg, #08111f 0%, #10172b 46%, #070b13 100%);
    }

    main {
      width: min(1180px, calc(100% - 32px));
      margin: 0 auto;
      padding: 42px 0 56px;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 390px;
      gap: 28px;
      align-items: stretch;
      margin-bottom: 28px;
    }

    .card {
      border: 1px solid var(--line);
      border-radius: 28px;
      background: var(--panel);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
      backdrop-filter: blur(14px);
    }

    .intro { padding: 34px; }

    .eyebrow {
      margin: 0 0 12px;
      color: var(--accent);
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: clamp(2.3rem, 7vw, 5.7rem);
      line-height: 0.88;
      letter-spacing: -0.075em;
    }

    .lede {
      max-width: 710px;
      margin: 24px 0 0;
      color: var(--muted);
      font-size: 1.08rem;
      line-height: 1.7;
    }

    .stack {
      display: grid;
      gap: 12px;
      align-content: stretch;
      padding: 18px;
    }

    .fact {
      min-height: 96px;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: rgba(255, 255, 255, 0.035);
    }

    .fact strong {
      display: block;
      margin-bottom: 8px;
      color: var(--accent);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }

    .fact span { color: var(--muted); line-height: 1.5; }

    .runner {
      display: grid;
      grid-template-columns: 410px minmax(0, 1fr);
      gap: 28px;
      align-items: start;
    }

    form { padding: 24px; }

    label {
      display: block;
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    textarea, input {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 16px;
      color: var(--text);
      background: rgba(3, 9, 18, 0.74);
      font: inherit;
      outline: none;
    }

    textarea {
      min-height: 166px;
      resize: vertical;
      padding: 15px 16px;
      line-height: 1.55;
    }

    input { padding: 12px 14px; }

    .field { margin-bottom: 16px; }

    button {
      width: 100%;
      border: 0;
      border-radius: 18px;
      padding: 15px 18px;
      color: #06101d;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      font: inherit;
      font-weight: 850;
      cursor: pointer;
      transition: transform 160ms ease, opacity 160ms ease;
    }

    button:hover { transform: translateY(-1px); }
    button:disabled { cursor: wait; opacity: 0.58; transform: none; }

    .hint {
      margin: 14px 0 0;
      color: var(--muted);
      font-size: 0.9rem;
      line-height: 1.5;
    }

    .workspace {
      overflow: hidden;
    }

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: space-between;
      align-items: center;
      padding: 18px 22px;
      border-bottom: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.025);
    }

    .status {
      color: var(--muted);
      font-size: 0.95rem;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 30px;
      padding: 6px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.04);
      font-size: 0.82rem;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--muted);
    }

    .dot.running { background: var(--accent); box-shadow: 0 0 18px var(--accent); }
    .dot.done { background: var(--good); }
    .dot.error { background: var(--bad); }

    .panes {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      min-height: 640px;
    }

    .pane {
      min-width: 0;
      padding: 18px;
    }

    .pane + .pane { border-left: 1px solid var(--line); }

    .pane h2 {
      margin: 0 0 14px;
      color: var(--accent);
      font-size: 0.8rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }

    #events {
      display: grid;
      gap: 12px;
      max-height: 575px;
      overflow: auto;
      padding-right: 4px;
    }

    .event {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 14px;
      background: rgba(255, 255, 255, 0.035);
    }

    .event-title {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
      color: var(--text);
      font-weight: 780;
    }

    .event small { color: var(--muted); }

    pre {
      overflow: auto;
      margin: 8px 0 0;
      padding: 12px;
      border: 1px solid rgba(134, 165, 217, 0.16);
      border-radius: 14px;
      color: #d9e8ff;
      background: var(--code);
      font: 0.86rem/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      word-break: break-word;
    }

    #outcome {
      min-height: 575px;
      max-height: 575px;
      overflow: auto;
      margin: 0;
    }

    .links {
      display: none;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 14px;
    }

    .links a {
      color: var(--accent);
      text-decoration: none;
      font-size: 0.9rem;
    }

    @media (max-width: 980px) {
      main { width: min(100% - 22px, 720px); padding-top: 22px; }
      .hero, .runner, .panes { grid-template-columns: 1fr; }
      .pane + .pane { border-left: 0; border-top: 1px solid var(--line); }
      .intro { padding: 24px; }
      #events, #outcome { max-height: none; }
    }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <div class="card intro">
        <p class="eyebrow">Cloudflare + Flue</p>
        <h1>Serverless coding agent trace.</h1>
        <p class="lede">Trigger the Flue agent, watch its tool calls live, then inspect the exact outcome and transcript. The harness runs in a Cloudflare Durable Object, stores session state durably, and executes familiar terminal commands through a Dynamic Worker-backed shell.</p>
      </div>
      <div class="card stack" aria-label="Demo capabilities">
        <div class="fact"><strong>Harness</strong><span>Flue sessions persist inside the agent instance. Reuse an id to continue the same serverless session.</span></div>
        <div class="fact"><strong>Terminal</strong><span>The model calls the normal bash tool. This demo adapts it to @cloudflare/shell instead of a container.</span></div>
        <div class="fact"><strong>Trace</strong><span>The UI renders Flue run events. It shows commands, tool output, progress, and final result without exposing private reasoning text.</span></div>
      </div>
    </section>

    <section class="runner">
      <form class="card" id="demo-form">
        <div class="field">
          <label for="message">Prompt</label>
          <textarea id="message" name="message">Show a serverless coding-agent harness with familiar terminal commands, a virtual filesystem, Cloudflare AI Gateway default, and no container sandbox.</textarea>
        </div>
        <div class="field">
          <label for="session-id">Agent instance id</label>
          <input id="session-id" name="session-id" />
        </div>
        <button id="run-button" type="submit">Run Agent</button>
        <p class="hint">The page uses Flue's built-in SSE mode: <code>POST /agents/serverless-coding-demo/&lt;id&gt;</code> with <code>Accept: text/event-stream</code>.</p>
        <div class="links" id="links"></div>
      </form>

      <div class="card workspace">
        <div class="toolbar">
          <div class="status"><span class="pill"><span class="dot" id="status-dot"></span><span id="status-text">Ready</span></span></div>
          <span class="pill" id="run-id">No run yet</span>
        </div>
        <div class="panes">
          <div class="pane">
            <h2>Live Work Trace</h2>
            <div id="events"></div>
          </div>
          <div class="pane">
            <h2>Outcome And Transcript</h2>
            <pre id="outcome">Run the agent to see the final structured outcome and Markdown transcript.</pre>
          </div>
        </div>
      </div>
    </section>
  </main>

  <script>
    const form = document.querySelector('#demo-form');
    const message = document.querySelector('#message');
    const sessionId = document.querySelector('#session-id');
    const button = document.querySelector('#run-button');
    const eventsEl = document.querySelector('#events');
    const outcome = document.querySelector('#outcome');
    const runIdEl = document.querySelector('#run-id');
    const statusText = document.querySelector('#status-text');
    const statusDot = document.querySelector('#status-dot');
    const links = document.querySelector('#links');

    sessionId.value = 'demo-' + Math.random().toString(36).slice(2, 9);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await runAgent();
    });

    async function runAgent() {
      const id = encodeURIComponent(sessionId.value.trim() || 'demo-session');
      resetUi();
      setStatus('running', 'Agent running');
      button.disabled = true;

      try {
        const response = await fetch('/agents/serverless-coding-demo/' + id, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
          },
          body: JSON.stringify({ message: message.value }),
        });

        const headerRunId = response.headers.get('x-flue-run-id');
        if (headerRunId) setRunId(headerRunId);
        if (!response.ok || !response.body) throw new Error('Agent request failed: HTTP ' + response.status);

        await readSse(response.body, (frame) => handleFrame(frame));
      } catch (error) {
        setStatus('error', 'Run failed');
        addEvent('Error', error instanceof Error ? error.message : String(error), 'error');
      } finally {
        button.disabled = false;
      }
    }

    async function readSse(body, onFrame) {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const raw = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const frame = parseSseFrame(raw);
          if (frame) onFrame(frame);
          boundary = buffer.indexOf('\n\n');
        }
        if (done) break;
      }
    }

    function parseSseFrame(raw) {
      if (!raw.trim() || raw.startsWith(':')) return null;
      const frame = { event: 'message', id: '', data: '' };
      for (const line of raw.split('\n')) {
        const index = line.indexOf(':');
        const field = index >= 0 ? line.slice(0, index) : line;
        const value = index >= 0 ? line.slice(index + 1).trimStart() : '';
        if (field === 'event') frame.event = value;
        if (field === 'id') frame.id = value;
        if (field === 'data') frame.data += value;
      }
      return frame;
    }

    function handleFrame(frame) {
      let event;
      try {
        event = JSON.parse(frame.data);
      } catch {
        addEvent(frame.event, frame.data);
        return;
      }

      if (event.runId) setRunId(event.runId);

      switch (event.type) {
        case 'run_start':
          addEvent('Run started', 'Cloudflare Durable Object accepted the invocation.');
          break;
        case 'operation_start':
          addEvent('Operation started', event.operationKind);
          break;
        case 'tool_start':
          addEvent('Tool: ' + event.toolName, commandFromEvent(event) || JSON.stringify(event.args, null, 2));
          break;
        case 'tool_call':
          addEvent('Tool result', toolResultText(event) || (event.isError ? 'Tool failed.' : 'Tool completed.'), event.isError ? 'error' : 'tool');
          break;
        case 'text_delta':
          appendAssistant(event.text);
          break;
        case 'thinking_start':
          addEvent('Reasoning', 'The model is reasoning internally. Private reasoning text is intentionally not displayed.');
          break;
        case 'turn':
          addEvent('Model turn complete', [event.model, event.usage ? event.usage.totalTokens + ' tokens' : undefined].filter(Boolean).join(' | '));
          break;
        case 'operation':
          addEvent('Operation complete', event.operationKind + ' in ' + event.durationMs + 'ms');
          break;
        case 'run_end':
          handleRunEnd(event);
          break;
        case 'log':
          addEvent('Log: ' + event.level, event.message);
          break;
      }
    }

    function handleRunEnd(event) {
      if (event.isError) {
        setStatus('error', 'Run ended with an error');
        outcome.textContent = JSON.stringify(event.error, null, 2);
        return;
      }

      setStatus('done', 'Run complete');
      const result = event.result || {};
      const transcript = result.session?.transcript;
      outcome.textContent = [
        'Final outcome:',
        JSON.stringify(result.data || result, null, 2),
        transcript ? '\nTranscript:\n' + transcript : '',
      ].filter(Boolean).join('\n');

      const session = result.session;
      if (session?.eventsUrl || session?.streamUrl) {
        links.style.display = 'flex';
        links.innerHTML = '';
        if (session.eventsUrl) links.appendChild(linkTo(session.eventsUrl, 'Durable event log'));
        if (session.streamUrl) links.appendChild(linkTo(session.streamUrl, 'Replay stream'));
      }
    }

    function resetUi() {
      eventsEl.innerHTML = '';
      links.innerHTML = '';
      links.style.display = 'none';
      outcome.textContent = 'Waiting for the agent to finish...';
      setRunId('Starting...');
    }

    function setStatus(kind, text) {
      statusText.textContent = text;
      statusDot.className = 'dot ' + (kind || '');
    }

    function setRunId(value) {
      runIdEl.textContent = value ? 'Run: ' + value : 'No run yet';
    }

    function addEvent(title, body, kind) {
      const card = document.createElement('div');
      card.className = 'event';
      const titleRow = document.createElement('div');
      titleRow.className = 'event-title';
      titleRow.innerHTML = '<span></span><small></small>';
      titleRow.querySelector('span').textContent = title;
      titleRow.querySelector('small').textContent = new Date().toLocaleTimeString();
      card.appendChild(titleRow);
      if (body) {
        const pre = document.createElement('pre');
        pre.textContent = body;
        if (kind === 'error') pre.style.borderColor = 'rgba(255, 139, 139, 0.45)';
        card.appendChild(pre);
      }
      eventsEl.appendChild(card);
      eventsEl.scrollTop = eventsEl.scrollHeight;
    }

    function appendAssistant(text) {
      let last = eventsEl.lastElementChild;
      if (!last || last.dataset.kind !== 'assistant') {
        addEvent('Assistant output', '');
        last = eventsEl.lastElementChild;
        last.dataset.kind = 'assistant';
        const pre = document.createElement('pre');
        last.appendChild(pre);
      }
      const pre = last.querySelector('pre');
      pre.textContent += text;
      eventsEl.scrollTop = eventsEl.scrollHeight;
    }

    function commandFromEvent(event) {
      return event.args && typeof event.args.command === 'string' ? event.args.command : '';
    }

    function toolResultText(event) {
      const content = event.result?.content;
      if (!Array.isArray(content)) return '';
      return content.map((item) => item?.type === 'text' ? item.text : JSON.stringify(item, null, 2)).filter(Boolean).join('\n').trim();
    }

    function linkTo(url, text) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.textContent = text;
      return a;
    }
  </script>
</body>
</html>`;

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    return (flueApp as Fetchable).fetch(request, env, ctx);
  },
} satisfies Fetchable;
