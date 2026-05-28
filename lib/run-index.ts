import { InMemoryFs } from '@cloudflare/shell';
import { createGit } from '@cloudflare/shell/git';
import { Type, defineTool, type ToolDefinition } from '@flue/runtime';
import { deployedVersion, getArtifactRepoAccess, type ArtifactEnv } from './artifacts';

const indexBranch = 'flue-run-index';
const indexPath = '/repo/.flue/run-index/index.jsonl';
const pointerDir = '/repo/.flue/run-index/runs';

export type RunPointer = {
  version: 1;
  runId: string;
  agentName: string;
  agentInstanceId: string;
  session: string;
  status: 'active' | 'completed' | 'errored';
  startedAt: string;
  endedAt?: string;
  workerVersion: ReturnType<typeof deployedVersion>;
};

export type WaitUntilLike = {
  waitUntil?: (promise: Promise<unknown>) => void;
};

type DirectAgentRunPointer = Pick<RunPointer, 'runId' | 'agentName' | 'agentInstanceId' | 'session' | 'startedAt' | 'workerVersion'>;

export function createRunHistoryTools(env: ArtifactEnv): ToolDefinition[] {
  return [
    defineTool({
      name: 'list_recent_runs',
      description: 'List recent global direct-agent run pointers. The index stores metadata only; session content remains in the owning Durable Object.',
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: 'Maximum run pointers to list. Defaults to 10.' })),
      }),
      execute: async (args) => JSON.stringify(await listRecentRunPointers(env, numberArg(args.limit, 10)), null, 2),
    }),
    defineTool({
      name: 'read_run',
      description: 'Read a run pointer and, when it points at this agent Durable Object, include the relevant durable Flue session entries from that DO.',
      parameters: Type.Object({
        runId: Type.String({ description: 'Run id returned by list_recent_runs.' }),
      }),
      execute: async (args) => {
        const runId = typeof args.runId === 'string' ? args.runId.trim() : '';
        if (!runId) throw new Error('read_run requires a runId.');
        return JSON.stringify(await readRunPointerWithSession(env, runId), null, 2);
      },
    }),
  ];
}

export async function indexDirectAgentRunResponse(params: {
  response: Response;
  env: ArtifactEnv;
  ctx?: WaitUntilLike;
  agentName: string;
  agentInstanceId: string;
  session: string;
}): Promise<Response> {
  if (!params.response.body || !isEventStream(params.response)) return params.response;

  const pointer: DirectAgentRunPointer = {
    runId: `agent-${new Date().toISOString().replace(/[^0-9A-Za-z]/g, '')}-${crypto.randomUUID()}`,
    agentName: params.agentName,
    agentInstanceId: params.agentInstanceId,
    session: params.session,
    startedAt: new Date().toISOString(),
    workerVersion: deployedVersion(params.env),
  };

  const [clientBody, observedBody] = params.response.body.tee();
  const writePointer = recordRunPointer(params.env, { ...pointer, version: 1, status: 'active' })
    .then(() => observeDirectAgentCompletion(observedBody))
    .then((status) => recordRunPointer(params.env, { ...pointer, version: 1, status, endedAt: new Date().toISOString() }))
    .catch((error) => console.error('[flue-demo] failed to update run pointer index', error));

  if (params.ctx?.waitUntil) params.ctx.waitUntil(writePointer);
  else void writePointer;

  const response = new Response(clientBody, params.response);
  response.headers.set('x-flue-demo-run-id', pointer.runId);
  return response;
}

export async function recordRunPointer(env: ArtifactEnv, pointer: RunPointer): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await recordRunPointerOnce(env, pointer);
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

export async function listRecentRunPointers(env: ArtifactEnv, limit = 10): Promise<RunPointer[]> {
  const fs = await cloneIndexBranch(env);
  if (!fs || !await fs.exists(indexPath)) return [];

  const seen = new Set<string>();
  const pointers: RunPointer[] = [];
  const lines = (await fs.readFile(indexPath)).trim().split('\n').filter(Boolean).reverse();
  for (const line of lines) {
    const pointer = JSON.parse(line) as RunPointer;
    if (seen.has(pointer.runId)) continue;
    seen.add(pointer.runId);
    pointers.push(pointer);
    if (pointers.length >= Math.max(1, Math.min(limit, 50))) break;
  }
  return pointers;
}

export async function readRunPointer(env: ArtifactEnv, runId: string): Promise<RunPointer | null> {
  const fs = await cloneIndexBranch(env);
  if (!fs) return null;
  const path = `${pointerDir}/${safeRunId(runId)}.json`;
  if (!await fs.exists(path)) return null;
  return JSON.parse(await fs.readFile(path)) as RunPointer;
}

export async function readRunPointerWithSession(env: ArtifactEnv, runId: string) {
  const pointer = await readRunPointer(env, runId);
  if (!pointer) return null;

  return {
    pointer,
    session: await readCurrentDurableSession(pointer),
  };
}

async function recordRunPointerOnce(env: ArtifactEnv, pointer: RunPointer): Promise<void> {
  const access = await getArtifactRepoAccess(env, 'write');
  const fs = new InMemoryFs();
  const git = createGit(fs, '/repo');
  let clonedIndexBranch = false;

  try {
    await git.clone({
      dir: '/repo',
      url: access.remote,
      branch: indexBranch,
      singleBranch: true,
      username: access.auth.username,
      password: access.auth.password,
    });
    clonedIndexBranch = true;
  } catch {
    await git.clone({
      dir: '/repo',
      url: access.remote,
      branch: access.defaultBranch,
      singleBranch: true,
      username: access.auth.username,
      password: access.auth.password,
    });
    await git.checkout({ dir: '/repo', branch: indexBranch });
  }

  await fs.mkdir(pointerDir, { recursive: true });
  await fs.writeFile(`${pointerDir}/${safeRunId(pointer.runId)}.json`, `${JSON.stringify(pointer, null, 2)}\n`);
  const previousIndex = await fs.exists(indexPath) ? await fs.readFile(indexPath) : '';
  await fs.writeFile(indexPath, `${previousIndex}${JSON.stringify(pointer)}\n`);
  await git.add({ dir: '/repo', filepath: '.flue/run-index' });
  await git.commit({
    dir: '/repo',
    message: `${pointer.status === 'active' ? 'Start' : 'Complete'} Flue agent run pointer ${pointer.runId}`,
    author: { name: 'Flue Run Pointer Index', email: 'flue-runs@cloudflare.dev' },
  });
  await git.push({
    dir: '/repo',
    remote: 'origin',
    ref: indexBranch,
    force: !clonedIndexBranch,
    username: access.auth.username,
    password: access.auth.password,
  });
}

async function cloneIndexBranch(env: ArtifactEnv): Promise<InMemoryFs | null> {
  try {
    const access = await getArtifactRepoAccess(env, 'read');
    const fs = new InMemoryFs();
    const git = createGit(fs, '/repo');
    await git.clone({
      dir: '/repo',
      url: access.remote,
      branch: indexBranch,
      singleBranch: true,
      username: access.auth.username,
      password: access.auth.password,
    });
    return fs;
  } catch {
    return null;
  }
}

async function observeDirectAgentCompletion(body: ReadableStream<Uint8Array>): Promise<'completed' | 'errored'> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let errored = false;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (sseFrameType(raw) === 'error') errored = true;
      boundary = buffer.indexOf('\n\n');
    }
    if (done) break;
  }

  return errored ? 'errored' : 'completed';
}

function sseFrameType(raw: string): string | undefined {
  for (const line of raw.split('\n')) {
    const index = line.indexOf(':');
    const field = index >= 0 ? line.slice(0, index) : line;
    const value = index >= 0 ? line.slice(index + 1).trimStart() : '';
    if (field === 'event') return value;
  }
  return undefined;
}

async function readCurrentDurableSession(pointer: RunPointer) {
  const context = await getCloudflareContextIfAvailable();
  const currentInstance = context?.durableObjectIdentity?.name;
  if (!context?.storage?.sql || currentInstance !== pointer.agentInstanceId) {
    return {
      available: false,
      reason: currentInstance
        ? `Pointer belongs to Durable Object "${pointer.agentInstanceId}", but this tool is running in "${currentInstance}".`
        : 'Durable Object session storage is not available in this execution context.',
    };
  }

  const rows = context.storage.sql.exec('SELECT data FROM flue_sessions WHERE id = ?', pointer.session).toArray();
  const data = typeof rows[0]?.data === 'string' ? JSON.parse(rows[0].data) : null;
  if (!data) return { available: false, reason: `Session "${pointer.session}" was not found in this Durable Object.` };

  return {
    available: true,
    source: 'current durable object flue_sessions',
    session: pointer.session,
    entries: filterSessionEntries(data, pointer),
  };
}

async function getCloudflareContextIfAvailable(): Promise<{
  durableObjectIdentity?: { name: string };
  storage?: { sql?: { exec: (query: string, ...bindings: unknown[]) => { toArray: () => Array<Record<string, unknown>> } } };
} | null> {
  try {
    const mod = await import('@flue/runtime/cloudflare');
    return mod.getCloudflareContext();
  } catch {
    return null;
  }
}

function filterSessionEntries(data: unknown, pointer: RunPointer): unknown[] {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { entries?: unknown }).entries)) return [];
  const entries = (data as { entries: Array<Record<string, unknown>> }).entries;
  const start = Date.parse(pointer.startedAt);
  const end = pointer.endedAt ? Date.parse(pointer.endedAt) : Number.POSITIVE_INFINITY;
  return entries.filter((entry) => {
    if (typeof entry.timestamp !== 'string') return true;
    const timestamp = Date.parse(entry.timestamp);
    return Number.isNaN(timestamp) || (timestamp >= start && timestamp <= end);
  });
}

function isEventStream(response: Response): boolean {
  return (response.headers.get('content-type') || '').toLowerCase().includes('text/event-stream');
}

function safeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/g, '_');
}

function numberArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 50) : fallback;
}
