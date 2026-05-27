# Flue Serverless Coding Agent Demo

This demo shows a coding-agent-style harness running on Cloudflare without a container sandbox.

The important pieces are:

- **Durable Objects as the agent runtime.** Each chat id maps to one Durable Object instance. That DO is where the agent handler runs and where Flue persists session state.
- **Flue as the agent harness.** Flue owns the programmable TypeScript harness, sessions, tools, run events, and HTTP endpoints. Flue is built on Pi, so the same idea could be applied to other harnesses such as Pi directly, Codex, or another agent runtime.
- **A terminal-like workspace without containers.** The agent gets a `bash` tool. `just-bash` provides the broad command surface, while Flue 0.8 and `@cloudflare/shell` provide the durable Workspace filesystem backed by Cloudflare storage.

The web UI is intentionally small: enter a prompt, watch the agent use terminal commands like `cat` and `grep`, and see the final outcome. The sidebar keeps a local list of chat ids so you can return to the same Durable Object-backed session.

## Setup

Install dependencies:

```bash
npm install
```

Log in to Cloudflare if needed:

```bash
npx wrangler login
```

If you have access to multiple Cloudflare accounts, select the account outside the repo with your Wrangler login/session or an environment variable such as `CLOUDFLARE_ACCOUNT_ID`.

## Local Dev

Run the Cloudflare dev target:

```bash
npm run dev
```

Open the web demo:

```text
http://localhost:3583/
```

You can also call the agent directly:

```bash
curl http://localhost:3583/agents/serverless-coding-demo/demo-session-1 \
  -H "Content-Type: application/json" \
  -d '{"message":"Use the terminal to inspect this workspace and prove the serverless demo works. Show familiar commands like cat and grep, then write a short note to /tmp/demo-output.md and show it."}'
```

Reuse the same URL id, for example `demo-session-1`, to hit the same Durable Object-backed agent session again.

## Deploy

Build and deploy to Cloudflare:

```bash
npm run deploy
```

## Files

- `agents/serverless-coding-demo.ts` - Flue HTTP agent endpoint.
- `lib/cloudflare-terminal.ts` - Thin adapter that keeps Flue's `bash` tool on top of `just-bash` while using `@cloudflare/shell`'s Workspace filesystem adapter.
- `lib/demo-workspace.ts` - Seeds the demo Workspace files.
- `app.ts` - Small chat UI and Flue route delegation.
- `wrangler.jsonc` - Cloudflare Worker bindings.
