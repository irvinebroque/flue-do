# Flue Serverless Coding Agent Demo

This is a small Flue agent that demonstrates a serverless coding-agent-style harness backed by `@cloudflare/shell` instead of a container sandbox.

Flue owns the programmable TypeScript harness, while `@cloudflare/shell` provides a durable Workspace filesystem and Dynamic Worker execution. A small adapter gives the agent a familiar bash-like command surface. The demo is customer-neutral and does not name any prospect.

## What It Shows

- A Cloudflare Workers deploy target for Flue.
- A Flue harness running in a Cloudflare Durable Object, so no container is required.
- A durable `@cloudflare/shell` Workspace for scratch files and generated artifacts.
- Familiar coding-agent tools like `bash`, `read`, `write`, `edit`, `grep`, and `glob`.
- Terminal commands passed to `bash` execute inside a Cloudflare Dynamic Worker.
- Cloudflare AI Gateway through the Workers AI binding with gateway id `default`.
- Host-controlled setup through TypeScript before the model runs.
- Structured output proving which commands ran and which files were inspected and changed.
- A readable session transcript and raw Flue run events returned with the demo response.

## Project Layout

This directory was empty when scaffolded, so it uses the root Flue layout:

- `agents/serverless-coding-demo.ts` - HTTP agent endpoint.
- `app.ts` - Small web UI at `/` plus delegation back to Flue's built-in routes.
- `roles/architect.md` - role instructions for platform-engineer-facing output.
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

The page triggers the same agent endpoint with `Accept: text/event-stream`, renders Flue run events live, and then shows the final structured outcome plus the Markdown transcript returned by the agent.

Call the demo agent:

```bash
curl http://localhost:3583/agents/serverless-coding-demo/demo-session-1 \
  -H "Content-Type: application/json" \
  -d '{"audience":"senior platform engineers","message":"Show a serverless coding-agent harness with familiar terminal commands, a virtual filesystem, Cloudflare AI Gateway default, and no container sandbox."}'
```

Reuse the same `demo-session-1` id to demonstrate Durable Object scoped state across requests.

The JSON response includes:

- `result.data` - the typed outcome returned by the agent.
- `result.session.transcript` - a Markdown transcript of the prompt, model turns, tool calls, terminal commands, tool output, and final outcome.
- `result.session.events` - the captured Flue run events for this prompt call, excluding model thinking deltas so the transcript stays user-facing.
- `result.session.eventsUrl` - the durable Cloudflare-backed run event log at `/runs/<runId>/events?limit=1000`.
- `result.session.streamUrl` - the replayable event stream at `/runs/<runId>/stream`.

For a live event-stream view instead of a sync JSON response, add `-H "Accept: text/event-stream"` to the same request. Flue will stream the same tool and run events as server-sent events while the agent is running.

This demo does not add a separate Cloudflare Agents SDK chat UI. Flue's Cloudflare target already uses Durable Objects and the Agents SDK under the hood for agent instances, while Flue exposes the simple app-facing API used here: `POST /agents/<agent>/<id>`, `Accept: text/event-stream`, and `/runs/<runId>/events`.

## Deploy

Build and deploy to Cloudflare:

```bash
npm run deploy
```

## Demo Narrative

The point is that the agent harness can remain programmable and runtime-agnostic while the filesystem and command layer can be serverless, durable, and non-containerized.

The agent gets a familiar coding-agent surface: it can run commands like `ls`, `cat foo.txt`, `grep -R "foo" /workspace`, and `cat > /tmp/demo-output.md <<'EOF'`. The adapter runs those commands in a Cloudflare Dynamic Worker and maps file operations onto `@cloudflare/shell` Workspace APIs instead of starting a Linux container. `/tmp/demo-output.md` is the scratch file that proves the agent can write to its filesystem-like workspace.

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

The verbose part lives in `lib/cloudflare-terminal.ts`. That file is the reusable layer that turns Flue's normal `bash` tool into Dynamic Worker executions backed by `@cloudflare/shell`.

The adapter intentionally mirrors a large part of the `just-bash` command surface. Run `help` through the agent's `bash` tool to list supported commands. Current coverage includes filesystem commands (`cat`, `cp`, `mv`, `mkdir`, `rm`, `find`, `stat`, `tree`), search (`grep`, `rg`), text utilities (`head`, `tail`, `wc`, `sort`, `uniq`, `sed`, `cut`), JSON basics (`jq`), hashes, archive/compression helpers, pipes, and `>`/`>>` redirection.
