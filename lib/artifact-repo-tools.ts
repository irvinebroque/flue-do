import { WorkspaceFileSystem, type Workspace } from '@cloudflare/shell';
import { createGit, type Git } from '@cloudflare/shell/git';
import { Type, defineTool, type ToolDefinition } from '@flue/runtime';
import { deployedVersion, getArtifactRepoAccess, type ArtifactEnv, type ArtifactRepoAccess } from './artifacts';

const repoDir = '/repo';
const metadataPath = '/.flue/artifact-repo.json';
const selfImprovePrefix = 'self-improve/';

type RepoToolOptions = {
  workspace: Workspace;
  env: ArtifactEnv;
  git?: Git;
  access?: ArtifactRepoAccess;
};

type PreparedRepo = {
  git: Git;
  access: ArtifactRepoAccess;
  cloned: boolean;
  pulled: boolean;
  dirtyBeforePull: boolean;
};

export function createArtifactRepoTools(options: RepoToolOptions): ToolDefinition[] {
  return [
    defineTool({
      name: 'repo_prepare',
      description: 'Prepare the Artifacts-backed canonical agent code repository in /repo. Run this before inspecting or changing agent code.',
      parameters: Type.Object({
        force: Type.Optional(Type.Boolean({ description: 'Delete and reclone the local /repo checkout.' })),
      }),
      execute: async (args) => {
        const prepared = await prepareArtifactRepo(options, Boolean(args.force));
        return JSON.stringify({
          repo: prepared.access.repoName,
          remote: prepared.access.remote,
          defaultBranch: prepared.access.defaultBranch,
          checkout: repoDir,
          cloned: prepared.cloned,
          pulled: prepared.pulled,
          dirtyBeforePull: prepared.dirtyBeforePull,
          deployedVersion: deployedVersion(options.env),
        }, null, 2);
      },
    }),
    defineTool({
      name: 'repo_status',
      description: 'Show changed files in the /repo Artifacts checkout.',
      parameters: Type.Object({}),
      execute: async () => {
        const { git } = await prepareArtifactRepo(options, false);
        return JSON.stringify(await git.status({ dir: repoDir }), null, 2);
      },
    }),
    defineTool({
      name: 'repo_log',
      description: 'Show recent commits from the /repo Artifacts checkout.',
      parameters: Type.Object({
        depth: Type.Optional(Type.Number({ description: 'Number of commits to return.' })),
      }),
      execute: async (args) => {
        const { git } = await prepareArtifactRepo(options, false);
        return JSON.stringify(await git.log({ dir: repoDir, depth: numberArg(args.depth, 10) }), null, 2);
      },
    }),
    defineTool({
      name: 'repo_branch',
      description: 'List branches, check out an existing branch, or create a new self-improvement branch in /repo.',
      parameters: Type.Object({
        name: Type.Optional(Type.String({ description: 'Branch or ref name.' })),
        create: Type.Optional(Type.Boolean({ description: 'Create and check out the named branch.' })),
      }),
      execute: async (args) => {
        const { git } = await prepareArtifactRepo(options, false);
        const name = stringArg(args.name);
        if (!name) return JSON.stringify(await git.branch({ dir: repoDir, list: true }), null, 2);
        if (args.create) assertSelfImproveBranch(name);
        const result = args.create ? await git.checkout({ dir: repoDir, branch: name }) : await git.checkout({ dir: repoDir, ref: name });
        return JSON.stringify(result, null, 2);
      },
    }),
    defineTool({
      name: 'repo_diff',
      description: 'Show the files changed in /repo. Use read/edit tools to inspect or modify individual files.',
      parameters: Type.Object({}),
      execute: async () => {
        const { git } = await prepareArtifactRepo(options, false);
        return JSON.stringify(await git.diff({ dir: repoDir }), null, 2);
      },
    }),
    defineTool({
      name: 'repo_commit',
      description: 'Stage and commit changes in /repo with the Flue agent author identity.',
      parameters: Type.Object({
        message: Type.String({ description: 'Commit message explaining the self-improvement.' }),
        addAll: Type.Optional(Type.Boolean({ description: 'Stage all changed files before committing. Defaults to true.' })),
      }),
      execute: async (args) => {
        const message = stringArg(args.message);
        if (!message) throw new Error('repo_commit requires a non-empty message.');
        const { git } = await prepareArtifactRepo(options, false);
        if (args.addAll !== false) await git.add({ dir: repoDir, filepath: '.' });
        const result = await git.commit({
          dir: repoDir,
          message,
          author: { name: 'Flue Self-Improvement Agent', email: 'flue-agent@cloudflare.dev' },
        });
        return JSON.stringify(result, null, 2);
      },
    }),
    defineTool({
      name: 'repo_push',
      description: 'Push a self-improvement branch from /repo to the canonical Artifacts repository. Direct pushes to main are blocked.',
      parameters: Type.Object({
        branch: Type.Optional(Type.String({ description: 'Branch to push. Defaults to the current branch.' })),
        force: Type.Optional(Type.Boolean({ description: 'Force push. Defaults to false.' })),
      }),
      execute: async (args) => {
        const { git, access } = await prepareArtifactRepo(options, false);
        const current = await git.branch({ dir: repoDir, list: true });
        const branch = stringArg(args.branch) || ('current' in current && typeof current.current === 'string' ? current.current : '');
        assertSelfImproveBranch(branch);
        const result = await git.push({
          dir: repoDir,
          remote: 'origin',
          ref: branch,
          force: Boolean(args.force),
          username: access.auth.username,
          password: access.auth.password,
        });
        return JSON.stringify({ branch, result }, null, 2);
      },
    }),
  ];
}

export async function prepareArtifactRepo(options: RepoToolOptions, force: boolean): Promise<PreparedRepo> {
  const access = options.access ?? await getArtifactRepoAccess(options.env, 'write');
  const git = options.git ?? createGit(new WorkspaceFileSystem(options.workspace), repoDir);
  const fs = new WorkspaceFileSystem(options.workspace);

  if (force) await fs.rm(repoDir, { recursive: true, force: true });

  const hasCheckout = await fs.exists(`${repoDir}/.git`);
  let cloned = false;
  let pulled = false;
  let dirtyBeforePull = false;

  if (!hasCheckout) {
    await fs.rm(repoDir, { recursive: true, force: true });
    await git.clone({
      dir: repoDir,
      url: access.remote,
      branch: access.defaultBranch,
      singleBranch: false,
      username: access.auth.username,
      password: access.auth.password,
    });
    cloned = true;
  } else {
    const status = await git.status({ dir: repoDir });
    dirtyBeforePull = status.length > 0;
    await git.fetch({ dir: repoDir, remote: 'origin', username: access.auth.username, password: access.auth.password });
    if (!dirtyBeforePull) {
      await git.pull({
        dir: repoDir,
        remote: 'origin',
        author: { name: 'Flue Self-Improvement Agent', email: 'flue-agent@cloudflare.dev' },
        username: access.auth.username,
        password: access.auth.password,
      });
      pulled = true;
    }
  }

  await fs.mkdir('/.flue', { recursive: true });
  await fs.writeFile(metadataPath, JSON.stringify({
    repo: access.repoName,
    remote: access.remote,
    defaultBranch: access.defaultBranch,
    checkout: repoDir,
    deployedVersion: deployedVersion(options.env),
    preparedAt: new Date().toISOString(),
  }, null, 2));

  return { git, access, cloned, pulled, dirtyBeforePull };
}

export function assertSelfImproveBranch(branch: string): void {
  if (!branch || !branch.startsWith(selfImprovePrefix)) {
    throw new Error(`Refusing to push or create branch "${branch || '(empty)'}". Use a branch under ${selfImprovePrefix}<run-id>.`);
  }
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 100) : fallback;
}
