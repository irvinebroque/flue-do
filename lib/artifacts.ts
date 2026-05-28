type TokenScope = 'read' | 'write';

export type VersionMetadata = {
  id?: string;
  tag?: string;
  timestamp?: string;
};

type ArtifactsCreateResult = {
  name?: string;
  remote?: string;
  defaultBranch?: string;
  token?: string;
};

type ArtifactsTokenResult =
  | string
  | {
      plaintext?: string;
      token?: string;
      expiresAt?: string;
      scope?: string;
    };

type ArtifactsRepoInfo = {
  name?: string;
  remote?: string;
  defaultBranch?: string;
};

type ArtifactsRepoHandle = ArtifactsRepoInfo & {
  info?: () => Promise<ArtifactsRepoInfo>;
  createToken?: (scope?: TokenScope, ttl?: number) => Promise<ArtifactsTokenResult>;
};

export type ArtifactsBinding = {
  create?: (name: string, opts?: { description?: string; readOnly?: boolean; setDefaultBranch?: string }) => Promise<ArtifactsCreateResult>;
  get?: (name: string) => Promise<ArtifactsRepoHandle>;
};

export type ArtifactEnv = {
  ARTIFACTS?: ArtifactsBinding;
  ARTIFACTS_REPO?: string;
  CF_VERSION_METADATA?: VersionMetadata;
};

export type ArtifactRepoAccess = {
  repoName: string;
  remote: string;
  defaultBranch: string;
  token: string;
  auth: {
    username: string;
    password: string;
  };
};

const defaultRepoName = 'flue-do';

export function artifactRepoName(env: ArtifactEnv): string {
  return typeof env.ARTIFACTS_REPO === 'string' && env.ARTIFACTS_REPO.trim() !== '' ? env.ARTIFACTS_REPO.trim() : defaultRepoName;
}

export function artifactTokenSecret(token: string): string {
  return token.split('?expires=')[0] || token;
}

export function artifactBasicAuth(token: string): { username: string; password: string } {
  return { username: 'x', password: artifactTokenSecret(token) };
}

export function deployedVersion(env: ArtifactEnv) {
  const metadata = env.CF_VERSION_METADATA;
  return {
    id: metadata?.id || 'local-dev',
    tag: metadata?.tag || undefined,
    timestamp: metadata?.timestamp || undefined,
  };
}

export async function getArtifactRepoAccess(env: ArtifactEnv, scope: TokenScope, options?: { allowCreate?: boolean }): Promise<ArtifactRepoAccess> {
  const artifacts = env.ARTIFACTS;
  if (!artifacts?.get) throw new Error('Artifacts binding ARTIFACTS is not configured. Add an artifacts binding before using repo tools.');

  const repoName = artifactRepoName(env);
  let repo: ArtifactsRepoHandle | undefined;
  let created: ArtifactsCreateResult | undefined;

  try {
    repo = await artifacts.get(repoName);
  } catch (error) {
    if (!options?.allowCreate || !artifacts.create) throw error;
    created = await artifacts.create(repoName, {
      description: 'Canonical source repository for the Flue self-improving agent demo',
      readOnly: false,
      setDefaultBranch: 'main',
    });
  }

  const info = created ?? await resolveRepoInfo(repo);
  const remote = info.remote;
  if (!remote) throw new Error(`Artifacts repo "${repoName}" did not provide a Git remote URL.`);

  const token = created?.token ?? await createRepoToken(repo, scope);
  if (!token) throw new Error(`Artifacts repo "${repoName}" did not provide a ${scope} token.`);

  return {
    repoName,
    remote,
    defaultBranch: info.defaultBranch || 'main',
    token,
    auth: artifactBasicAuth(token),
  };
}

async function resolveRepoInfo(repo: ArtifactsRepoHandle | undefined): Promise<ArtifactsRepoInfo> {
  if (!repo) throw new Error('Artifacts repo handle is unavailable.');
  if (repo.remote) return repo;
  if (repo.info) return repo.info();
  return repo;
}

async function createRepoToken(repo: ArtifactsRepoHandle | undefined, scope: TokenScope): Promise<string> {
  if (!repo?.createToken) throw new Error('Artifacts repo handle cannot mint repo tokens.');
  const token = await repo.createToken(scope, 3600);
  if (typeof token === 'string') return token;
  return token.plaintext || token.token || '';
}
