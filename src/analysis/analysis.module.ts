import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module.js';
import { GithubModule } from '../github/github.module.js';
import { RepoRagModule } from '../repo-rag/repo-rag.module.js';
import { AnalysisController } from './analysis.controller.js';
import { AnalysisService } from './analysis.service.js';
import {
  PushAnalysisRun,
  PushAnalysisRunSchema,
} from './schemas/push-analysis-run.schema.js';

@Module({
  imports: [
    AuthModule,
    forwardRef(() => GithubModule),
    RepoRagModule,
    MongooseModule.forFeature([
      { name: PushAnalysisRun.name, schema: PushAnalysisRunSchema },
    ]),
  ],
  controllers: [AnalysisController],
  providers: [AnalysisService],
  exports: [AnalysisService],
})
export class AnalysisModule {}
