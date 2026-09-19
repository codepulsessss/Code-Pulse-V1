import type {
  GithubBranchRaw,
  GithubRepoRaw,
  GithubUserProfile,
  SlimGithubBranch,
  SlimGithubProfile,
  SlimGithubRepository,
} from './github.types.js';

export function toSlimProfile(profile: GithubUserProfile): SlimGithubProfile {
  return {
    id: profile.id,
    login: profile.login,
    name: profile.name ?? undefined,
    avatarUrl: profile.avatar_url,
  };
}

export function toSlimRepository(repo: GithubRepoRaw): SlimGithubRepository {
  return {
    fullName: repo.full_name ?? `${repo.owner?.login ?? ''}/${repo.name ?? ''}`,
    owner: repo.owner?.login ?? '',
    name: repo.name ?? '',
    private: Boolean(repo.private),
    defaultBranch: repo.default_branch ?? 'main',
    updatedAt: repo.updated_at,
  };
}

export function toSlimBranch(branch: GithubBranchRaw): SlimGithubBranch {
  return {
    name: branch.name ?? '',
    protected: Boolean(branch.protected),
    commitSha: branch.commit?.sha,
  };
}

export function parseWorkspace(
  workspace?: string,
  owner?: string,
  repo?: string,
): { owner: string; repo: string } {
  if (workspace?.trim()) {
    const parts = workspace.trim().split('/').filter(Boolean);
    if (parts.length !== 2) {
      throw new Error(
        'workspace must be in the form "owner/repo"',
      );
    }
    return { owner: parts[0]!, repo: parts[1]! };
  }

  if (owner?.trim() && repo?.trim()) {
    return { owner: owner.trim(), repo: repo.trim() };
  }

  throw new Error('Provide workspace as "owner/repo", or owner and repo');
}
