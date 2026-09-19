import {
  Controller,
  DefaultValuePipe,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Request,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { AnalysisService } from '../analysis/analysis.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { IndexingService } from '../repo-rag/indexing/indexing.service.js';
import { GithubService } from './github.service.js';

const LOG_PREFIX = '[github-webhook]';

/**
 * GitHub OAuth + slim discover APIs + push webhook.
 * Base path: /api/v1/github
 */
@Controller('/api/v1/github')
export class GithubController {
  constructor(
    private readonly githubService: GithubService,
    private readonly indexingService: IndexingService,
    private readonly analysisService: AnalysisService,
  ) {}

  @Get('/oauth/url')
  getAuthorizationUrl() {
    return this.githubService.getAuthorizationUrl();
  }

  @Get('/oauth/callback')
  handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    return this.githubService.handleOAuthCallback(code, state);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/profile')
  getProfile(@Request() req: { user: AuthenticatedUser }) {
    return this.githubService.getAuthenticatedGithubProfile(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories')
  listRepositories(
    @Request() req: { user: AuthenticatedUser },
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('perPage', new DefaultValuePipe(20), ParseIntPipe) perPage: number,
  ) {
    return this.githubService.listRepositories(req.user, page, perPage);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/branches')
  listBranches(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('perPage', new DefaultValuePipe(100), ParseIntPipe) perPage: number,
  ) {
    return this.githubService.listBranches(
      req.user,
      owner,
      repo,
      page,
      perPage,
    );
  }

  @Post('/webhook')
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<ExpressRequest>,
    @Headers('x-hub-signature-256') signature?: string,
    @Headers('x-github-event') event?: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new UnauthorizedException('Missing raw request body');
    }

    if (!this.githubService.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (event !== 'push') {
      return { ok: true, ignored: true, event };
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const result = await this.indexingService.handlePushWebhook(payload);

    if (result.handled && result.analysis) {
      const analysisInput = result.analysis;
      void this.analysisService
        .analyzePushFromWebhook(analysisInput)
        .then((outcome) => {
          console.log(
            `${LOG_PREFIX} analysis finished: ${analysisInput.owner}/${analysisInput.repo}@${analysisInput.branch}`,
            outcome && typeof outcome === 'object' && 'skipped' in outcome
              ? outcome
              : { runId: (outcome as { runId?: string })?.runId },
          );
        })
        .catch((error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(
            `${LOG_PREFIX} analysis failed: ${analysisInput.owner}/${analysisInput.repo}@${analysisInput.branch} — ${message}`,
          );
        });
    }

    return {
      ok: true,
      handled: result.handled,
      reason: result.reason,
      changed: result.changed,
      removed: result.removed,
      analysisStarted: Boolean(result.analysis),
    };
  }
}
