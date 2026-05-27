# Flue Serverless Coding Agent Demo

This is a small Flue agent that demonstrates a serverless coding-agent-style harness backed by `just-bash` and `@cloudflare/shell` instead of a container sandbox.

Flue owns the programmable TypeScript harness, `just-bash` provides bash-like terminal semantics, and `@cloudflare/shell` provides a durable Workspace filesystem. A small adapter connects the shell to the Cloudflare-native workspace. The demo is customer-neutral and does not name any prospect.

## What It Shows

- A Cloudflare Workers deploy target for Flue.
- A Flue harness running in a Cloudflare Durable Object, so no container is required.
- A durable `@cloudflare/shell` Workspace for scratch files and generated artifacts.
- Familiar terminal commands like `pwd`, `ls`, `cat`, `grep`, and shell redirection through the agent's `bash` tool.
- Terminal commands passed to `bash` are interpreted by `just-bash` against a durable Cloudflare Workspace; the demo intentionally exposes only `bash` so the work trace looks like a terminal session.
- Cloudflare AI Gateway through the Workers AI binding with gateway id `default`.
- Host-controlled setup through TypeScript before the model runs.
- Structured output proving which commands ran and which files were inspected and changed.
- A Kumo-styled chat UI that shows Flue's live run events, tool calls, terminal output, and final outcome.

## Project Layout

This directory was empty when scaffolded, so it uses the root Flue layout:

- `agents/serverless-coding-demo.ts` - HTTP agent endpoint.
- `app.ts` - Small Kumo-styled chat UI at `/` plus delegation back to Flue's built-in routes.
- `wrangler.jsonc` - Cloudflare Workers config with the `AI` binding used by Cloudflare AI Gateway and the `LOADER` binding used by Dynamic Worker execution.

## Setup

Install dependencies:

```bash
npm install
```

Log in to Cloudflare if needed:

```bash
npx wrangler login
```

This demo uses the Workers AI binding and Cloudflare AI Gateway `default`, so it does not require a provider API key in `.env`.

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

The page uses Kumo's standalone stylesheet and a familiar chat layout. It triggers the same agent endpoint with `Accept: text/event-stream`, renders Flue run events live as chat messages, and then shows the final structured outcome as the last assistant response. The sidebar stores a local index of chat ids and run ids; each chat id maps to one Cloudflare Durable Object agent instance.

Call the demo agent:

```bash
curl http://localhost:3583/agents/serverless-coding-demo/demo-session-1 \
  -H "Content-Type: application/json" \
  -d '{"audience":"senior platform engineers","message":"Show a serverless coding-agent harness with familiar terminal commands, a virtual filesystem, Cloudflare AI Gateway default, and no container sandbox."}'
```

Reuse the same `demo-session-1` id to demonstrate Durable Object scoped state across requests.

On Cloudflare, each `/agents/serverless-coding-demo/<id>` URL maps to one Durable Object. Flue stores the session history in that DO's SQLite storage, `@cloudflare/shell` stores the Workspace in the same DO storage, and run events are persisted in run-history tables in that DO. A small registry Durable Object maps `runId` values back to the owning agent instance so `/runs/<runId>/events` can replay the durable event log.

The JSON response includes:

- `result.data` - the typed outcome returned by the agent.
- `result.call` - the selected model and token usage for the prompt call.
- `result.run.eventsUrl` - the durable Cloudflare-backed run event log at `/runs/<runId>/events?limit=1000`.
- `result.run.streamUrl` - the replayable event stream at `/runs/<runId>/stream`.

For a live event-stream view instead of a sync JSON response, add `-H "Accept: text/event-stream"` to the same request. Flue will stream tool calls, terminal command output, model turns, and run lifecycle events as server-sent events while the agent is running.

This demo does not add a separate Cloudflare Agents SDK chat UI. Flue's Cloudflare target already uses Durable Objects and the Agents SDK under the hood for agent instances, while Flue exposes the simple app-facing API used here: `POST /agents/<agent>/<id>`, `Accept: text/event-stream`, and `/runs/<runId>/events`.

## Deploy

Build and deploy to Cloudflare:

```bash
npm run deploy
```

## Demo Narrative

The point is that the agent harness can remain programmable and runtime-agnostic while the filesystem and command layer can be serverless, durable, and non-containerized.

The agent gets a familiar coding-agent surface: it can run commands like `ls`, `cat foo.txt`, `grep -R "foo" /workspace`, and `cat > /tmp/demo-output.md <<'EOF'`. `just-bash` handles shell parsing and command behavior, while the adapter maps file operations onto `@cloudflare/shell` Workspace APIs instead of starting a Linux container. `/tmp/demo-output.md` is the scratch file that proves the agent can write to its filesystem-like workspace.

Model traffic uses Cloudflare AI Gateway through the Workers AI binding:

```jsonc
{
  "ai": {
    "binding": "AI"
  }
}
```

Workers Logs are enabled in `wrangler.jsonc`:

```jsonc
{
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  }
}
```

The Flue Cloudflare build registers the `cloudflare/` model provider with gateway id `default`, so `cloudflare/openai/gpt-5.5` is invoked through Cloudflare AI Gateway `default`.

Third-party models through the Workers AI binding require AI Gateway Unified Billing balance or BYOK on the Cloudflare account Wrangler is using.

## Adapter Shape

The agent stays small:

```ts
const workspace = getDefaultWorkspace();
await seedDemoWorkspace(workspace);

const harness = await init({
  sandbox: cloudflareTerminalSandbox({ workspace, loader: env.LOADER, cwd: '/workspace' }),
  model: 'cloudflare/openai/gpt-5.5',
});
```

The verbose part lives in `lib/cloudflare-terminal.ts`. That file is the reusable layer that turns Flue's normal `bash` tool into `just-bash` executions backed by `@cloudflare/shell`.

The adapter intentionally mirrors a large part of the `just-bash` command surface. Run `help` through the agent's `bash` tool to list supported commands. Current coverage includes filesystem commands (`cat`, `cp`, `mv`, `mkdir`, `rm`, `find`, `stat`, `tree`), search (`grep`, `rg`), text utilities (`head`, `tail`, `wc`, `sort`, `uniq`, `sed`, `cut`), JSON basics (`jq`), hashes, archive/compression helpers, pipes, and `>`/`>>` redirection.
