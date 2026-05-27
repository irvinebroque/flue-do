import { flue, type Fetchable } from '@flue/runtime/app';

const flueApp = flue();

const html = String.raw`<!doctype html>
<html lang="en" data-mode="light">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Flue Serverless Coding Agent Demo</title>
  <link rel="stylesheet" href="https://unpkg.com/@cloudflare/kumo@2.3.0/dist/styles/kumo-standalone.css" />
  <style>
    :root { color-scheme: light; }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text-color-kumo-default, #171717);
      background: var(--color-kumo-canvas, #fafafa);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    button, textarea, input { font: inherit; }

    .app-shell {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      min-height: 100vh;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      border-bottom: 1px solid var(--color-kumo-hairline, rgba(255, 255, 255, 0.12));
      background: var(--color-kumo-base, #fff);
    }

    .topbar-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      width: min(100%, 960px);
      margin: 0 auto;
      padding: 12px 18px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .brand-mark { display: none; }

    .brand-title { margin: 0; font-size: 0.95rem; font-weight: 720; }
    .brand-subtitle { margin: 1px 0 0; color: var(--text-color-kumo-subtle, #a3a3a3); font-size: 0.78rem; }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 30px;
      padding: 0 10px;
      border: 1px solid var(--color-kumo-hairline, rgba(255, 255, 255, 0.12));
      border-radius: 999px;
      color: var(--text-color-kumo-subtle, #a3a3a3);
      background: var(--color-kumo-base, #fff);
      font-size: 0.82rem;
      white-space: nowrap;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-color-kumo-subtle, #a3a3a3);
    }

    .status-dot.running { background: var(--color-kumo-brand, #f6821f); }
    .status-dot.done { background: #4ade80; }
    .status-dot.error { background: #fb7185; }

    .chat-log {
      width: min(100%, 960px);
      margin: 0 auto;
      padding: 24px 18px;
      overflow: auto;
    }

    .empty-state {
      display: grid;
      place-items: center;
      min-height: 54vh;
      text-align: center;
    }

    .empty-card {
      width: min(100%, 680px);
      border: 1px solid var(--color-kumo-hairline, rgba(255, 255, 255, 0.12));
      border-radius: 12px;
      background: var(--color-kumo-base, #fff);
      padding: 24px;
    }

    .empty-card h1 {
      margin: 0 0 10px;
      font-size: 1.5rem;
      letter-spacing: -0.02em;
      line-height: 1.2;
    }

    .empty-card p {
      margin: 0 auto;
      max-width: 560px;
      color: var(--text-color-kumo-subtle, #a3a3a3);
      line-height: 1.6;
    }

    .message {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
      margin: 0 0 14px;
    }

    .message.user {
      grid-template-columns: minmax(0, 1fr);
    }

    .avatar { display: none; }

    .bubble {
      width: fit-content;
      max-width: min(760px, 100%);
      border: 1px solid var(--color-kumo-hairline, rgba(255, 255, 255, 0.12));
      border-radius: 12px;
      background: var(--color-kumo-base, #fff);
      padding: 12px;
    }

    .message.user .bubble {
      justify-self: end;
      background: var(--color-kumo-tint, #f5f5f5);
      border-color: var(--color-kumo-fill, #e5e5e5);
    }

    .bubble.work {
      width: 100%;
      background: var(--color-kumo-base, #fff);
    }

    .bubble.final {
      width: 100%;
      border-color: var(--color-kumo-brand, #f6821f);
    }

    .message-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 6px;
      color: var(--text-color-kumo-subtle, #a3a3a3);
      font-size: 0.78rem;
      font-weight: 600;
    }

    .message-body {
      margin: 0;
      color: var(--text-color-kumo-default, #171717);
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .message-body p { margin: 0 0 10px; }
    .message-body p:last-child { margin-bottom: 0; }

    .final-summary { margin: 0 0 12px; line-height: 1.6; }

    .outcome-grid {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }

    .outcome-list {
      margin: 6px 0 0;
      padding-left: 20px;
      color: var(--text-color-kumo-subtle, #a3a3a3);
    }

    pre {
      overflow: auto;
      margin: 8px 0 0;
      padding: 10px;
      border: 1px solid var(--color-kumo-hairline, rgba(255, 255, 255, 0.12));
      border-radius: 8px;
      color: var(--text-color-kumo-default, #171717);
      background: var(--color-kumo-recessed, #f5f5f5);
      font: 0.83rem/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .run-links {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 14px;
    }

    .run-links a {
      display: inline-flex;
      align-items: center;
      min-height: 30px;
      padding: 0 10px;
      border: 1px solid var(--color-kumo-hairline, rgba(255, 255, 255, 0.12));
      border-radius: 999px;
      color: var(--text-color-kumo-link, #93c5fd);
      background: var(--color-kumo-tint, #f5f5f5);
      text-decoration: none;
      font-size: 0.82rem;
      font-weight: 650;
    }

    .composer-wrap {
      position: sticky;
      bottom: 0;
      border-top: 1px solid var(--color-kumo-hairline, rgba(255, 255, 255, 0.12));
      background: var(--color-kumo-canvas, #fafafa);
      padding: 12px 18px;
    }

    .composer {
      width: min(100%, 960px);
      margin: 0 auto;
      border: 1px solid var(--color-kumo-hairline, rgba(255, 255, 255, 0.12));
      border-radius: 12px;
      background: var(--color-kumo-base, #fff);
      padding: 12px;
    }

    .composer-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
      color: var(--text-color-kumo-subtle, #a3a3a3);
      font-size: 0.8rem;
    }

    .session-field {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .session-field span { white-space: nowrap; }

    .session-input {
      width: min(260px, 42vw);
      min-height: 30px;
      border: 1px solid var(--color-kumo-hairline, rgba(255, 255, 255, 0.12));
      border-radius: 8px;
      color: var(--text-color-kumo-default, #171717);
      background: var(--color-kumo-recessed, #f5f5f5);
      padding: 0 10px;
      outline: none;
    }

    .prompt-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: end;
    }

    textarea {
      width: 100%;
      min-height: 68px;
      max-height: 220px;
      resize: vertical;
      border: 0;
      border-radius: 8px;
      color: var(--text-color-kumo-default, #171717);
      background: var(--color-kumo-recessed, #f5f5f5);
      padding: 13px 14px;
      line-height: 1.5;
      outline: none;
    }

    .send-button {
      min-height: 44px;
      border: 0;
      border-radius: 8px;
      padding: 0 18px;
      color: #15110c;
      background: var(--color-kumo-brand, #f6821f);
      font-weight: 760;
      cursor: pointer;
    }

    .send-button:disabled { cursor: wait; opacity: 0.6; }

    @media (max-width: 720px) {
      .topbar-inner { padding-inline: 12px; }
      .chat-log { padding-inline: 12px; }
      .message, .message.user { grid-template-columns: 1fr; }
      .avatar { display: none; }
      .bubble { max-width: 100%; width: 100%; }
      .message.user .bubble { justify-self: stretch; }
      .prompt-row { grid-template-columns: 1fr; }
      .send-button { width: 100%; }
      .composer-top { align-items: flex-start; flex-direction: column; }
      .session-input { width: 100%; }
      .session-field { width: 100%; }
    }
  </style>
</head>
<body class="bg-kumo-canvas text-kumo-default">
  <div class="app-shell">
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand" aria-label="Flue serverless coding agent demo">
          <span class="brand-mark" aria-hidden="true"></span>
          <div>
            <p class="brand-title">Flue Serverless Coding Agent</p>
            <p class="brand-subtitle">Cloudflare Workers, Durable Objects, AI Gateway, and @cloudflare/shell</p>
          </div>
        </div>
        <span class="status-pill"><span class="status-dot" id="status-dot"></span><span id="status-text">Ready</span></span>
      </div>
    </header>

    <main class="chat-log" id="chat-log" aria-live="polite">
      <section class="empty-state" id="empty-state">
        <div class="empty-card bg-kumo-base border-kumo-hairline">
          <h1>What should the agent show?</h1>
          <p>Ask the demo to prove it can inspect files, run terminal commands, write to its workspace, and return a structured outcome. The full work trace will appear here as the session runs.</p>
        </div>
      </section>
    </main>

    <section class="composer-wrap">
      <form class="composer bg-kumo-base border-kumo-hairline" id="demo-form">
        <div class="composer-top">
          <label class="session-field" for="session-id">
            <span>Agent instance</span>
            <input class="session-input" id="session-id" name="session-id" />
          </label>
          <span id="run-id">No run yet</span>
        </div>
        <div class="prompt-row">
          <textarea id="message" name="message" aria-label="Prompt">Use the terminal to inspect this workspace and prove the serverless demo works. Show familiar commands like cat and grep, then write a short note to /tmp/demo-output.md and show it.</textarea>
          <button class="send-button" id="run-button" type="submit">Run</button>
        </div>
      </form>
    </section>
  </div>

  <script>
    const form = document.querySelector('#demo-form');
    const chatLog = document.querySelector('#chat-log');
    const emptyState = document.querySelector('#empty-state');
    const message = document.querySelector('#message');
    const sessionId = document.querySelector('#session-id');
    const button = document.querySelector('#run-button');
    const runIdEl = document.querySelector('#run-id');
    const statusText = document.querySelector('#status-text');
    const statusDot = document.querySelector('#status-dot');
    const toolCards = new Map();
    let currentRunId = '';

    sessionId.value = 'demo-' + Math.random().toString(36).slice(2, 9);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      await runAgent();
    });

    message.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });

    async function runAgent() {
      const prompt = message.value.trim();
      if (!prompt) return;

      const id = encodeURIComponent(sessionId.value.trim() || 'demo-session');
      resetRun();
      appendUserMessage(prompt);
      message.value = '';
      setStatus('running', 'Agent running');
      button.disabled = true;

      try {
        const response = await fetch('/agents/serverless-coding-demo/' + id, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
          },
          body: JSON.stringify({ message: prompt }),
        });

        const headerRunId = response.headers.get('x-flue-run-id');
        if (headerRunId) {
          currentRunId = headerRunId;
          setRunId(headerRunId);
        }
        if (!response.ok || !response.body) throw new Error('Agent request failed: HTTP ' + response.status);

        await readSse(response.body, (frame) => handleFrame(frame, prompt));
      } catch (error) {
        setStatus('error', 'Run failed');
        appendWorkMessage('Error', error instanceof Error ? error.message : String(error), { tone: 'error' });
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

    function handleFrame(frame, prompt) {
      let event;
      try {
        event = JSON.parse(frame.data);
      } catch {
        appendWorkMessage(frame.event, frame.data);
        return;
      }

      if (event.runId) {
        currentRunId = event.runId;
        setRunId(event.runId);
      }

      switch (event.type) {
        case 'run_start':
          appendWorkMessage('Run started', 'Cloudflare accepted the invocation and routed it to a Durable Object agent instance.');
          break;
        case 'operation_start':
          appendWorkMessage('Operation started', event.operationKind);
          break;
        case 'tool_start':
          appendToolStart(event);
          break;
        case 'tool_call':
          appendToolResult(event);
          break;
        case 'text_delta':
          appendAssistantDelta(event.text);
          break;
        case 'thinking_start':
          appendWorkMessage('Reasoning', 'The model is reasoning internally. Private thinking text is not displayed, but all tool calls and outputs are shown.');
          break;
        case 'turn':
          appendWorkMessage('Model turn complete', [event.model, event.usage ? event.usage.totalTokens + ' tokens' : undefined].filter(Boolean).join(' | '));
          break;
        case 'operation':
          appendWorkMessage('Operation complete', event.operationKind + ' in ' + event.durationMs + 'ms');
          break;
        case 'run_end':
          handleRunEnd(event, prompt);
          break;
        case 'log':
          appendWorkMessage('Log: ' + event.level, event.message);
          break;
      }
    }

    function handleRunEnd(event, prompt) {
      if (event.isError) {
        setStatus('error', 'Run ended with an error');
        appendWorkMessage('Run error', JSON.stringify(event.error, null, 2), { tone: 'error' });
        return;
      }

      setStatus('done', 'Run complete');
      const result = event.result || {};
      appendFinalOutcome(result, prompt);
    }

    function resetRun() {
      currentRunId = '';
      toolCards.clear();
      emptyState?.remove();
      chatLog.innerHTML = '';
      setRunId('Starting...');
    }

    function appendUserMessage(text) {
      const row = createMessage('user', 'You');
      row.body.textContent = text;
      chatLog.appendChild(row.el);
      scrollToBottom();
    }

    function appendAssistantDelta(text) {
      let row = chatLog.lastElementChild;
      if (!row || row.dataset.kind !== 'assistant-stream') {
        const created = createMessage('assistant', 'Agent');
        created.el.dataset.kind = 'assistant-stream';
        created.body.textContent = '';
        chatLog.appendChild(created.el);
        row = created.el;
      }
      row.querySelector('.message-body').textContent += text;
      scrollToBottom();
    }

    function appendWorkMessage(title, body, options) {
      const row = createMessage('assistant', title, { work: true });
      if (options?.tone === 'error') row.bubble.style.borderColor = 'rgba(251, 113, 133, 0.45)';
      row.body.textContent = body || '';
      chatLog.appendChild(row.el);
      scrollToBottom();
      return row;
    }

    function appendToolStart(event) {
      const command = commandFromEvent(event);
      const title = event.toolName === 'bash' && command ? 'Terminal command' : 'Tool call: ' + event.toolName;
      const row = appendWorkMessage(title, '');
      if (command) row.body.appendChild(pre('$ ' + command, 'bash'));
      else row.body.appendChild(pre(JSON.stringify(event.args || {}, null, 2), 'json'));
      toolCards.set(event.toolCallId, row);
    }

    function appendToolResult(event) {
      const row = toolCards.get(event.toolCallId) || appendWorkMessage('Tool result: ' + event.toolName, '');
      const result = toolResultText(event) || (event.isError ? 'Tool failed.' : 'Tool completed.');
      const label = document.createElement('div');
      label.className = 'message-label';
      label.textContent = (event.toolName === 'bash' ? 'Command ' : 'Result ') + (event.isError ? 'failed' : 'completed') + ' in ' + event.durationMs + 'ms';
      row.body.appendChild(label);
      row.body.appendChild(pre(result, 'text'));
      if (event.isError) row.bubble.style.borderColor = 'rgba(251, 113, 133, 0.45)';
      scrollToBottom();
    }

    function appendFinalOutcome(result, prompt) {
      const row = createMessage('assistant', 'Final outcome', { final: true });
      const data = result.data || result;
      const summary = document.createElement('p');
      summary.className = 'final-summary';
      summary.textContent = data.summary || 'The agent completed the session.';
      row.body.appendChild(summary);

      const grid = document.createElement('div');
      grid.className = 'outcome-grid';
      grid.appendChild(detailList('Terminal commands', data.terminalCommands));
      grid.appendChild(detailList('Files inspected', data.filesInspected));
      grid.appendChild(detailList('Files changed', data.filesChanged));
      row.body.appendChild(grid);

      row.body.appendChild(pre(JSON.stringify(data, null, 2), 'json'));
      row.body.appendChild(runLinks(result.run || runLinksFor(currentRunId)));
      chatLog.appendChild(row.el);
      scrollToBottom();
    }

    function detailList(title, items) {
      const section = document.createElement('section');
      const label = document.createElement('div');
      label.className = 'message-label';
      label.textContent = title;
      section.appendChild(label);
      const list = document.createElement('ul');
      list.className = 'outcome-list';
      const values = Array.isArray(items) && items.length ? items : ['None reported'];
      for (const item of values) {
        const li = document.createElement('li');
        li.textContent = String(item);
        list.appendChild(li);
      }
      section.appendChild(list);
      return section;
    }

    function createMessage(kind, label, options) {
      const el = document.createElement('article');
      el.className = 'message ' + (kind === 'user' ? 'user' : 'assistant');
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = kind === 'user' ? 'You' : 'AI';
      const bubble = document.createElement('div');
      bubble.className = 'bubble' + (options?.work ? ' work' : '') + (options?.final ? ' final' : '');
      const header = document.createElement('div');
      header.className = 'message-label';
      header.textContent = label;
      const body = document.createElement('div');
      body.className = 'message-body';
      bubble.appendChild(header);
      bubble.appendChild(body);
      if (kind === 'user') {
        el.appendChild(bubble);
        el.appendChild(avatar);
      } else {
        el.appendChild(avatar);
        el.appendChild(bubble);
      }
      return { el, bubble, body };
    }

    function pre(value, lang) {
      const node = document.createElement('pre');
      node.dataset.lang = lang;
      node.textContent = value;
      return node;
    }

    function runLinks(links) {
      const wrapper = document.createElement('div');
      wrapper.className = 'run-links';
      if (links?.eventsUrl) wrapper.appendChild(linkTo(links.eventsUrl, 'Durable event log'));
      if (links?.streamUrl) wrapper.appendChild(linkTo(links.streamUrl, 'Replay stream'));
      return wrapper;
    }

    function runLinksFor(runId) {
      if (!runId) return null;
      const path = '/runs/' + encodeURIComponent(runId);
      return {
        run: path,
        eventsUrl: path + '/events?limit=1000',
        streamUrl: path + '/stream',
      };
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

    function setStatus(kind, text) {
      statusText.textContent = text;
      statusDot.className = 'status-dot ' + (kind || '');
    }

    function setRunId(value) {
      runIdEl.textContent = value ? 'Run: ' + value : 'No run yet';
    }

    function scrollToBottom() {
      requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
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
