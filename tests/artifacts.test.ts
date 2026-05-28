import { describe, expect, it } from 'vitest';
import { artifactBasicAuth, artifactRepoName, artifactTokenSecret, deployedVersion } from '../lib/artifacts';
import { assertSelfImproveBranch, createArtifactRepoTools } from '../lib/artifact-repo-tools';
import { createRunHistoryTools } from '../lib/run-index';

describe('artifact repository helpers', () => {
  it('derives repo name, token auth, and deployed version metadata', () => {
    expect(artifactRepoName({})).toBe('flue-do');
    expect(artifactRepoName({ ARTIFACTS_REPO: ' custom-repo ' })).toBe('custom-repo');
    expect(artifactTokenSecret('art_v1_secret?expires=123')).toBe('art_v1_secret');
    expect(artifactBasicAuth('art_v1_secret?expires=123')).toEqual({ username: 'x', password: 'art_v1_secret' });
    expect(deployedVersion({ CF_VERSION_METADATA: { id: 'version-id', tag: 'abc123', timestamp: '2026-01-01T00:00:00Z' } })).toEqual({
      id: 'version-id',
      tag: 'abc123',
      timestamp: '2026-01-01T00:00:00Z',
    });
  });

  it('allows only self-improvement branches for agent pushes', () => {
    expect(() => assertSelfImproveBranch('self-improve/run-123')).not.toThrow();
    expect(() => assertSelfImproveBranch('main')).toThrow(/Refusing to push/);
    expect(() => assertSelfImproveBranch('feature/demo')).toThrow(/self-improve/);
  });

  it('exposes the expected agent tool surface', () => {
    const repoTools = createArtifactRepoTools({ workspace: {} as never, env: {} }).map((tool) => tool.name);
    const runTools = createRunHistoryTools({}).map((tool) => tool.name);

    expect(repoTools).toEqual(['repo_prepare', 'repo_status', 'repo_log', 'repo_branch', 'repo_diff', 'repo_commit', 'repo_push']);
    expect(runTools).toEqual(['list_recent_runs', 'read_run']);
  });
});
