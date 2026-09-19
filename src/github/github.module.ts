import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AnalysisModule } from '../analysis/analysis.module.js';
import { RepoRagModule } from '../repo-rag/repo-rag.module.js';
import { GithubController } from './github.controller.js';
import { GithubService } from './github.service.js';

/**
 * GitHub OAuth + slim discover APIs + webhook.
 */
@Module({
  imports: [
    AuthModule,
    forwardRef(() => RepoRagModule),
    forwardRef(() => AnalysisModule),
  ],
  controllers: [GithubController],
  providers: [GithubService],
  exports: [GithubService],
})
export class GithubModule {}
