# Flue Serverless Coding Agent Demo

This demo shows a coding-agent-style harness running on Cloudflare without a container sandbox. The agent can inspect prior global runs, check out the Cloudflare Artifacts repo that contains its own codebase, edit that repo, commit to a self-improvement branch, and push the branch for a separate build/deploy system.

The important pieces are:

- **Durable Objects as the agent runtime.** Each chat id maps to one Durable Object instance. That DO is where the agent handler runs and where Flue persists session state.
- **Flue as the agent harness.** Flue owns the programmable TypeScript harness, sessions, tools, run events, and HTTP endpoints. Flue is built on Pi, so the same idea could be applied to other harnesses such as Pi directly, Codex, or another agent runtime.
- **A terminal-like workspace without containers.** The agent gets a `bash` tool. `just-bash` provides the broad command surface, while Flue 0.8 and `@cloudflare/shell` provide the durable Workspace filesystem backed by Cloudflare storage.
- **Artifacts as the canonical agent repo.** The deployed Worker is one built version of the Artifacts repo. The `repo_*` tools clone that canonical repo into `/repo`, create `self-improve/<id>` branches, commit changes, and push those branches back to Artifacts.
- **Global run pointer index in Artifacts.** The app records direct-agent run pointers on the `flue-run-index` branch. The index stores metadata only; durable Flue session content stays in the owning agent Durable Object. The `list_recent_runs` and `read_run` tools let the agent discover prior runs before changing its own codebase.

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

Create or import the canonical Artifacts repo named by `ARTIFACTS_REPO` in `wrangler.jsonc` before running the self-improvement flow. The demo expects that repo to contain this codebase; it does not silently create an empty replacement if the repo is missing.

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

The generated `dist/wrangler.jsonc` is patched after `flue build` so the deployed Worker receives the Artifacts binding, version metadata binding, and `ARTIFACTS_REPO` variable from the source `wrangler.jsonc`.

For production demos, configure your deployer to tag Worker versions with the Artifacts commit SHA. The Worker reads `env.CF_VERSION_METADATA`, so the UI/tools can associate a running Worker version with the source commit that produced it.

## Self-Improvement Flow

1. User prompts the agent.
2. The app records a pointer for the direct-agent run on the `flue-run-index` branch in Artifacts. It does not copy the session transcript or tool output into the index.
3. On a later run, the agent calls `list_recent_runs` and `read_run` to inspect prior behavior.
4. The agent calls `repo_prepare`, which checks out the canonical Artifacts repo at `/repo`.
5. The agent edits prompt, context, or source files in `/repo`.
6. The agent calls `repo_diff`, `repo_status`, `repo_branch`, `repo_commit`, and `repo_push`.
7. The pushed branch is reviewed/built/deployed by an external system.
8. Future runs execute the newly deployed Worker version.

## Files

- `agents/serverless-coding-demo.ts` - Flue HTTP agent endpoint.
- `lib/cloudflare-terminal.ts` - Thin adapter that keeps Flue's `bash` tool on top of `just-bash` while using `@cloudflare/shell`'s Workspace filesystem adapter.
- `lib/artifact-repo-tools.ts` - Artifacts-backed repository tools exposed to the agent.
- `lib/run-index.ts` - Pointer-only run index persistence and run-history tools.
- `lib/artifacts.ts` - Shared Artifacts/version metadata helpers.
- `lib/demo-workspace.ts` - Seeds the demo Workspace files.
- `scripts/patch-flue-wrangler.mjs` - Restores Artifacts/version metadata config after Flue build output generation.
- `app.ts` - Small chat UI and Flue route delegation.
- `wrangler.jsonc` - Cloudflare Worker bindings.
