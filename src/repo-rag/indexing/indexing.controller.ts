import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type.js';
import { parseWorkspace } from '../../github/github.mappers.js';
import { ConnectRepoDto } from '../dto/connect-repo.dto.js';
import { IndexingService } from './indexing.service.js';

@Controller('/api/v1/repo-index')
export class IndexingController {
  constructor(
    private readonly indexingService: IndexingService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Connect a workspace branch: build embeddings + register push webhook.
   * Body: { workspace: "owner/repo", branch } (or owner + repo + branch)
   */
  @UseGuards(JwtAuthGuard)
  @Post('/connect')
  async connect(
    @Request() req: { user: AuthenticatedUser },
    @Body() body: ConnectRepoDto,
  ) {
    let owner: string;
    let repo: string;
    try {
      ({ owner, repo } = parseWorkspace(body.workspace, body.owner, body.repo));
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid workspace',
      );
    }

    const webhookUrl =
      body.webhookUrl?.trim() ||
      this.config.getOrThrow<string>('PUBLIC_WEBHOOK_URL');

    return this.indexingService.connectWorkspace(req.user, {
      owner,
      repo,
      branch: body.branch.trim(),
      webhookUrl,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/branches/:branch/status')
  async getIndexStatus(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('branch') branch: string,
  ) {
    return this.indexingService.getStatus(owner, repo, branch);
  }
}
