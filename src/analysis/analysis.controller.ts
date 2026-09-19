import {
  Controller,
  Get,
  Param,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.type.js';
import { AnalysisService } from './analysis.service.js';

@Controller('/api/v1/analysis')
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/branches/:branch/runs')
  listRuns(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('branch') branch: string,
  ) {
    return this.analysisService.listRuns(
      req.user.userId,
      owner,
      repo,
      branch,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('/repositories/:owner/:repo/runs/:runId')
  getRun(
    @Request() req: { user: AuthenticatedUser },
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('runId') runId: string,
  ) {
    return this.analysisService.getRun(
      req.user.userId,
      owner,
      repo,
      runId,
    );
  }
}
