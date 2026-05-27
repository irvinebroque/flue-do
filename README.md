# Flue Serverless Coding Agent Demo

This demo shows a coding-agent-style harness running on Cloudflare without a container sandbox.

The important pieces are:

- **Durable Objects as the agent runtime.** Each chat id maps to one Durable Object instance. That DO is where the agent handler runs and where Flue persists session state.
- **Flue as the agent harness.** Flue owns the programmable TypeScript harness, sessions, tools, run events, and HTTP endpoints. Flue is built on Pi, so the same idea could be applied to other harnesses such as Pi directly, Codex, or another agent runtime.
- **A durable workspace without containers.** The agent gets a `code` tool that runs JavaScript against `@cloudflare/shell` Workspace state through a Worker Loader binding.

The web UI is intentionally small: enter a prompt, watch the agent inspect and update workspace files with the `code` tool, and see the final outcome. The sidebar keeps a local list of chat ids so you can return to the same Durable Object-backed session.

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
  -d '{"message":"Use the code tool to inspect /workspace and prove the serverless demo works. Read a few files, write a short note to /tmp/demo-output.md, then return what you found."}'
```

Reuse the same URL id, for example `demo-session-1`, to hit the same Durable Object-backed agent session again.

## Deploy

Build and deploy to Cloudflare:

```bash
npm run deploy
```

## Files

- `agents/serverless-coding-demo.ts` - Flue HTTP agent endpoint.
- `connectors/cloudflare-shell.ts` - Connector that exposes the durable `@cloudflare/shell` Workspace through Flue's Worker Loader-backed `code` tool.
- `lib/demo-workspace.ts` - Seeds the demo Workspace files.
- `app.ts` - Small chat UI and Flue route delegation.
- `wrangler.jsonc` - Cloudflare Worker bindings.
