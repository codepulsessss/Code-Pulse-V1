import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import type { StringValue } from 'ms';
import { URLSearchParams } from 'url';
import { AuthService } from '../auth/auth.service.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { TokenEncryptionService } from '../common/services/token-encryption.service.js';
import { decodeGithubRepositoryFileContentIfApplicable } from './github.helpers.js';
import {
  toSlimBranch,
  toSlimProfile,
  toSlimRepository,
} from './github.mappers.js';
import type {
  GithubBranchRaw,
  GithubCompareResponse,
  GithubOauthState,
  GithubPushWebhookPayload,
  GithubRepoRaw,
  GithubTreeEntry,
  GithubWebhook,
  GithubUserEmail,
  GithubUserProfile,
  SlimGithubBranch,
  SlimGithubProfile,
  SlimGithubRepository,
} from './github.types.js';

@Injectable()
export class GithubService {
  private readonly apiBaseUrl: string;
  private readonly authorizeUrl: string;
  private readonly tokenUrl: string;
  private readonly callbackUrl: string;
  private readonly scopes: string;
  private readonly stateTtl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly tokenEncryptionService: TokenEncryptionService,
  ) {
    this.apiBaseUrl = this.config.getOrThrow<string>('GITHUB_API_BASE_URL');
    this.authorizeUrl = this.config.getOrThrow<string>(
      'GITHUB_OAUTH_AUTHORIZE_URL',
    );
    this.tokenUrl = this.config.getOrThrow<string>('GITHUB_OAUTH_TOKEN_URL');
    this.callbackUrl = this.config.getOrThrow<string>('GITHUB_CALLBACK_URL');
    this.scopes = this.config.getOrThrow<string>('GITHUB_OAUTH_SCOPES');
    this.stateTtl = this.config.getOrThrow<string>('GITHUB_OAUTH_STATE_TTL');
  }

  // --- OAuth ---

  getAuthorizationUrl() {
    const state = this.jwtService.sign(
      { nonce: randomUUID() } satisfies GithubOauthState,
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: this.stateTtl as StringValue,
      },
    );
    const params = new URLSearchParams({
      client_id: this.config.getOrThrow<string>('GITHUB_CLIENT_ID'),
      redirect_uri: this.callbackUrl,
      scope: this.scopes,
      state,
    });

    return {
      authorizationUrl: `${this.authorizeUrl}?${params.toString()}`,
      state,
    };
  }

  async handleOAuthCallback(code: string, state?: string) {
    if (!state) {
      throw new BadRequestException('Missing OAuth state parameter');
    }

    this.verifyState(state);

    const accessToken = await this.exchangeCodeForToken(code);
    const [profile, emails] = await Promise.all([
      this.fetchGithubUser(accessToken),
      this.fetchGithubEmails(accessToken),
    ]);

    const primaryEmail = this.resolvePrimaryEmail(profile, emails);
    return this.authService.upsertGithubUser({
      githubId: String(profile.id),
      githubUsername: profile.login,
      email: primaryEmail,
      encryptedAccessToken: this.tokenEncryptionService.encrypt(accessToken),
    });
  }

  // --- Client-facing (slim responses) ---

  async getAuthenticatedGithubProfile(
    user: AuthenticatedUser,
  ): Promise<SlimGithubProfile> {
    const token = await this.getDecryptedAccessToken(user.userId);
    const profile = await this.fetchGithubUser(token);
    return toSlimProfile(profile);
  }

  async listRepositories(
    user: AuthenticatedUser,
    page = 1,
    perPage = 20,
  ): Promise<{ items: SlimGithubRepository[]; page: number; perPage: number }> {
    const repos = await this.githubRequest<GithubRepoRaw[]>(
      user.userId,
      `/user/repos?sort=updated&direction=desc&page=${page}&per_page=${perPage}`,
    );
    return {
      items: (repos ?? []).map(toSlimRepository),
      page,
      perPage,
    };
  }

  async listBranches(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    page = 1,
    perPage = 100,
  ): Promise<{ items: SlimGithubBranch[]; page: number; perPage: number }> {
    const branches = await this.githubRequest<GithubBranchRaw[]>(
      user.userId,
      `/repos/${owner}/${repo}/branches?page=${page}&per_page=${perPage}`,
    );
    return {
      items: (branches ?? []).map(toSlimBranch),
      page,
      perPage,
    };
  }

  // --- Internal REST (used by indexing + analysis; not exposed publicly) ---

  async getRepositoryFile(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    filePath: string,
    ref?: string,
  ) {
    return this.getRepositoryFileForUserId(
      user.userId,
      owner,
      repo,
      filePath,
      ref,
    );
  }

  async resolveBranchHead(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string> {
    return this.resolveBranchHeadForUserId(user.userId, owner, repo, branch);
  }

  async resolveBranchHeadForUserId(
    userId: string,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string> {
    const payload = await this.githubRequestForUserId<{ sha: string }>(
      userId,
      `/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`,
    );
    return payload.sha;
  }

  async getTree(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    commitSha: string,
    recursive = true,
  ) {
    return this.getTreeForUserId(user.userId, owner, repo, commitSha, recursive);
  }

  async getTreeForUserId(
    userId: string,
    owner: string,
    repo: string,
    commitSha: string,
    recursive = true,
  ): Promise<GithubTreeEntry[]> {
    const commit = await this.githubRequestForUserId<{ tree: { sha: string } }>(
      userId,
      `/repos/${owner}/${repo}/git/commits/${commitSha}`,
    );

    const query = recursive ? '?recursive=1' : '';
    const tree = await this.githubRequestForUserId<{ tree: GithubTreeEntry[] }>(
      userId,
      `/repos/${owner}/${repo}/git/trees/${commit.tree.sha}${query}`,
    );

    return tree.tree ?? [];
  }

  async getRepositoryFileForUserId(
    userId: string,
    owner: string,
    repo: string,
    filePath: string,
    ref?: string,
  ) {
    const normalized = filePath.replace(/^\/+/, '');
    if (!normalized) {
      throw new BadRequestException('File path is required');
    }

    const data = await this.githubRequestForUserId(
      userId,
      this.buildContentsApiPath(owner, repo, normalized, ref),
    );
    return decodeGithubRepositoryFileContentIfApplicable(data);
  }

  async compareCommits(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<GithubCompareResponse> {
    return this.compareCommitsForUserId(user.userId, owner, repo, base, head);
  }

  async compareCommitsForUserId(
    userId: string,
    owner: string,
    repo: string,
    base: string,
    head: string,
  ): Promise<GithubCompareResponse> {
    return this.githubRequestForUserId<GithubCompareResponse>(
      userId,
      `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    );
  }

  async listRepositoryWebhooks(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
  ) {
    return this.githubRequest<GithubWebhook[]>(
      user.userId,
      `/repos/${owner}/${repo}/hooks`,
    );
  }

  async createRepositoryWebhook(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    webhookUrl: string,
    secret: string,
  ) {
    return this.githubRequest<GithubWebhook>(
      user.userId,
      `/repos/${owner}/${repo}/hooks`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'web',
          active: true,
          events: ['push'],
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret,
            insecure_ssl: '0',
          },
        }),
      },
    );
  }

  async deleteRepositoryWebhook(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    hookId: number,
  ) {
    await this.githubRequestForUserId(
      user.userId,
      `/repos/${owner}/${repo}/hooks/${hookId}`,
      { method: 'DELETE' },
      false,
    );
  }

  normalizeWebhookUrl(url: string): string {
    return url.trim().replace(/\/+$/, '');
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader?: string): boolean {
    const secret = this.config.getOrThrow<string>('GITHUB_WEBHOOK_SECRET');
    if (!signatureHeader?.startsWith('sha256=')) {
      return false;
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const received = signatureHeader.slice('sha256='.length);

    try {
      return timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(received, 'hex'),
      );
    } catch {
      return false;
    }
  }

  findRepositoryWebhookByUrl(
    hooks: GithubWebhook[],
    webhookUrl: string,
  ): GithubWebhook | undefined {
    const normalizedUrl = this.normalizeWebhookUrl(webhookUrl);
    return hooks.find(
      (hook) =>
        this.normalizeWebhookUrl(hook.config?.url ?? '') === normalizedUrl,
    );
  }

  async ensurePushWebhook(
    user: AuthenticatedUser,
    owner: string,
    repo: string,
    webhookUrl: string,
    existingHookId?: number,
  ) {
    const normalizedUrl = this.normalizeWebhookUrl(webhookUrl);
    const secret = this.config.getOrThrow<string>('GITHUB_WEBHOOK_SECRET');
    const hooks = await this.listRepositoryWebhooks(user, owner, repo);
    const matchedHook = this.findRepositoryWebhookByUrl(hooks, normalizedUrl);

    if (matchedHook) {
      return {
        hook: matchedHook,
        webhookUrl: normalizedUrl,
        created: false,
      };
    }

    if (existingHookId) {
      try {
        await this.deleteRepositoryWebhook(user, owner, repo, existingHookId);
      } catch {
        // Previous hook may have been removed manually on GitHub.
      }
    }

    const hook = await this.createRepositoryWebhook(
      user,
      owner,
      repo,
      normalizedUrl,
      secret,
    );

    return {
      hook,
      webhookUrl: normalizedUrl,
      created: true,
    };
  }

  extractChangedPathsFromPushPayload(payload: GithubPushWebhookPayload): {
    changed: string[];
    removed: string[];
  } {
    const changed = new Set<string>();
    const removed = new Set<string>();

    for (const commit of payload.commits ?? []) {
      for (const path of commit.added ?? []) {
        changed.add(path);
      }
      for (const path of commit.modified ?? []) {
        changed.add(path);
      }
      for (const path of commit.removed ?? []) {
        removed.add(path);
        changed.delete(path);
      }
    }

    return {
      changed: Array.from(changed),
      removed: Array.from(removed),
    };
  }

  // --- Internals ---

  private buildContentsApiPath(
    owner: string,
    repo: string,
    objectPath: string | undefined,
    ref?: string,
  ) {
    const normalized = (objectPath ?? '').replace(/^\/+/, '').trim();
    const search = new URLSearchParams();
    if (ref) {
      search.set('ref', ref);
    }
    const query = search.toString() ? `?${search.toString()}` : '';
    const suffix =
      normalized.length > 0
        ? `/contents/${normalized.split('/').map(encodeURIComponent).join('/')}`
        : '/contents';
    return `/repos/${owner}/${repo}${suffix}${query}`;
  }

  private verifyState(state: string) {
    try {
      this.jwtService.verify<GithubOauthState>(state, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }
  }

  private async exchangeCodeForToken(code: string) {
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.getOrThrow<string>('GITHUB_CLIENT_ID'),
        client_secret: this.config.getOrThrow<string>('GITHUB_CLIENT_SECRET'),
        code,
        redirect_uri: this.callbackUrl,
      }),
    });

    const payload = (await response.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !payload.access_token) {
      throw new UnauthorizedException(
        payload.error_description ??
          payload.error ??
          'GitHub token exchange failed',
      );
    }

    return payload.access_token;
  }

  private async fetchGithubUser(accessToken: string) {
    return this.rawGithubRequest<GithubUserProfile>('/user', accessToken);
  }

  private async fetchGithubEmails(accessToken: string) {
    return this.rawGithubRequest<GithubUserEmail[]>('/user/emails', accessToken);
  }

  private resolvePrimaryEmail(
    profile: GithubUserProfile,
    emails: GithubUserEmail[],
  ) {
    const primaryVerifiedEmail = emails.find((e) => e.primary && e.verified);
    const fallbackVerifiedEmail = emails.find((e) => e.verified);

    return (
      primaryVerifiedEmail?.email ??
      fallbackVerifiedEmail?.email ??
      `${profile.id}+${profile.login}@users.noreply.github.com`
    );
  }

  private async getDecryptedAccessToken(userId: string) {
    const encryptedToken = await this.authService.getGithubAccessToken(userId);
    return this.tokenEncryptionService.decrypt(encryptedToken);
  }

  private async githubRequest<T>(
    userId: string,
    path: string,
    init?: RequestInit & { accept?: string },
    parseJson = true,
  ): Promise<T> {
    return this.githubRequestForUserId<T>(userId, path, init, parseJson);
  }

  private async githubRequestForUserId<T>(
    userId: string,
    path: string,
    init?: RequestInit & { accept?: string },
    parseJson = true,
  ): Promise<T> {
    const token = await this.getDecryptedAccessToken(userId);
    return this.rawGithubRequest(path, token, init, parseJson);
  }

  private async rawGithubRequest<T>(
    path: string,
    accessToken: string,
    init?: RequestInit & { accept?: string },
    parseJson = true,
  ): Promise<T> {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: init?.accept ?? 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'codepulse-backend',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BadRequestException(
        `GitHub API request failed with status ${response.status}: ${errorText}`,
      );
    }

    if (!parseJson) {
      return (await response.text()) as T;
    }

    return (await response.json()) as T;
  }
}
