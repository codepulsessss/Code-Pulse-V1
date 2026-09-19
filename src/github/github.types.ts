/** Signed OAuth state payload (JWT body). */
export type GithubOauthState = {
  nonce: string;
};

export type GithubUserProfile = {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string;
};

export type GithubUserEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};

export type GithubTreeEntry = {
  path?: string;
  mode?: string;
  type?: 'blob' | 'tree' | 'commit';
  sha?: string;
  size?: number;
};

export type GithubWebhook = {
  id: number;
  type?: string;
  active: boolean;
  events: string[];
  config?: {
    url?: string;
    content_type?: string;
    insecure_ssl?: string;
  };
};

export type GithubPushWebhookPayload = {
  ref?: string;
  before?: string;
  after?: string;
  repository?: {
    name?: string;
    owner?: { login?: string };
    full_name?: string;
  };
  commits?: Array<{
    id?: string;
    message?: string;
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
  head_commit?: {
    id?: string;
    message?: string;
  } | null;
};

/** Slim client-facing DTOs */

export type SlimGithubProfile = {
  id: number;
  login: string;
  name?: string;
  avatarUrl?: string;
};

export type SlimGithubRepository = {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  updatedAt?: string;
};

export type SlimGithubBranch = {
  name: string;
  protected: boolean;
  commitSha?: string;
};

export type GithubRepoRaw = {
  full_name?: string;
  name?: string;
  private?: boolean;
  default_branch?: string;
  updated_at?: string;
  owner?: { login?: string };
};

export type GithubBranchRaw = {
  name?: string;
  protected?: boolean;
  commit?: { sha?: string };
};

export type GithubCompareFile = {
  filename?: string;
  status?: string;
  patch?: string;
};

export type GithubCompareResponse = {
  files?: GithubCompareFile[];
  status?: string;
  ahead_by?: number;
  behind_by?: number;
  total_commits?: number;
};
