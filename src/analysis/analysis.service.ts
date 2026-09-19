import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { GithubPushWebhookPayload } from '../github/github.types.js';
import { GithubService } from '../github/github.service.js';
import { RetrieverService } from '../repo-rag/retrieval/retriever.service.js';
import {
  PushAnalysisRun,
  type PushAnalysisRunDocument,
} from './schemas/push-analysis-run.schema.js';
import { buildGraph } from './langgraph/graph.js';
import type { ChangedFile, PushAnalysisPayload } from './langgraph/state.js';

const LOG_PREFIX = '[analysis]';
const ZERO_SHA = '0'.repeat(40);

@Injectable()
export class AnalysisService {
  constructor(
    private readonly retrieverService: RetrieverService,
    private readonly githubService: GithubService,
    @InjectModel(PushAnalysisRun.name)
    private readonly pushAnalysisRunModel: Model<PushAnalysisRunDocument>,
  ) {}

  async analyzePush(userId: string, payload: PushAnalysisPayload) {
    const repoId = `${payload.owner}/${payload.repo}`;
    console.log(
      `${LOG_PREFIX} analyze started: ${repoId}@${payload.branch} ` +
        `before=${payload.beforeSha.slice(0, 7)} after=${payload.afterSha.slice(0, 7)} ` +
        `files=${payload.files.length}`,
    );

    await this.retrieverService.ensureIndexed(
      payload.owner,
      payload.repo,
      payload.branch,
    );
    console.log(
      `${LOG_PREFIX} index verified for ${repoId}@${payload.branch}`,
    );

    const run = await this.pushAnalysisRunModel.create({
      userId: new Types.ObjectId(userId),
      owner: payload.owner,
      repo: payload.repo,
      branch: payload.branch,
      beforeSha: payload.beforeSha,
      afterSha: payload.afterSha,
      status: 'running',
    });

    try {
      console.log(
        `${LOG_PREFIX} graph invoke started: runId=${run._id} ` +
          `pipeline=inputGuard→retriever→[quality|security|performance]→join→bugDetection→assembler`,
      );
      const graph = buildGraph(this.retrieverService);
      const result = await graph.invoke({ input: payload });
      const finalReport = result.finalReport ?? {
        overallSummary: 'Review completed.',
        findings: [],
        allFindings: [],
        domainReports: {},
      };

      const allFindingsCount = Array.isArray(finalReport.allFindings)
        ? finalReport.allFindings.length
        : Array.isArray(finalReport.findings)
          ? finalReport.findings.length
          : 0;
      const relatedContextCount =
        typeof finalReport.relatedContextCount === 'number'
          ? finalReport.relatedContextCount
          : (result.relatedContext?.length ?? 0);
      console.log(
        `${LOG_PREFIX} graph complete: runId=${run._id} ` +
          `findings=${allFindingsCount} relatedContext=${relatedContextCount}`,
      );

      await this.pushAnalysisRunModel.findByIdAndUpdate(run._id, {
        status: 'completed',
        finalReport,
      });

      return {
        runId: String(run._id),
        ...finalReport,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analysis failed';
      console.error(
        `${LOG_PREFIX} analyze failed: ${repoId}@${payload.branch} runId=${run._id} — ${message}`,
      );
      await this.pushAnalysisRunModel.findByIdAndUpdate(run._id, {
        status: 'failed',
        error: message,
      });
      throw error;
    }
  }

  /**
   * Builds a push payload from a GitHub push webhook and runs analysis.
   * Intended to be fire-and-forget from the webhook handler.
   */
  async analyzePushFromWebhook(params: {
    userId: string;
    owner: string;
    repo: string;
    branch: string;
    beforeSha: string;
    afterSha: string;
    payload: GithubPushWebhookPayload;
  }) {
    const { userId, owner, repo, branch, beforeSha, afterSha, payload } =
      params;

    if (!beforeSha || beforeSha === ZERO_SHA) {
      console.log(
        `${LOG_PREFIX} skip analysis (branch create / zero before SHA): ${owner}/${repo}@${branch}`,
      );
      return { skipped: true, reason: 'branch-create' };
    }

    if (!afterSha || afterSha === ZERO_SHA) {
      console.log(
        `${LOG_PREFIX} skip analysis (branch delete): ${owner}/${repo}@${branch}`,
      );
      return { skipped: true, reason: 'branch-delete' };
    }

    const compare = await this.githubService.compareCommitsForUserId(
      userId,
      owner,
      repo,
      beforeSha,
      afterSha,
    );

    const compareFiles = compare.files ?? [];
    const files: ChangedFile[] = await Promise.all(
      compareFiles.map(async (file) => {
        const filename = file.filename;
        if (!filename) {
          return null;
        }

        const patch =
          typeof file.patch === 'string' && file.patch.trim().length > 0
            ? file.patch
            : '';

        const [content, baseContent] = await Promise.all([
          file.status === 'removed'
            ? Promise.resolve('')
            : this.fetchFileContent(userId, owner, repo, filename, afterSha),
          file.status === 'added'
            ? Promise.resolve('')
            : this.fetchFileContent(userId, owner, repo, filename, beforeSha),
        ]);

        return { filename, patch, content, baseContent } satisfies ChangedFile;
      }),
    ).then((results) =>
      results.filter((file): file is ChangedFile => file !== null),
    );

    const title =
      payload.head_commit?.message?.split('\n')[0]?.trim() ||
      payload.commits?.[payload.commits.length - 1]?.message
        ?.split('\n')[0]
        ?.trim() ||
      `Push to ${branch}`;

    const description =
      (payload.commits ?? [])
        .map((c) => c.message?.trim())
        .filter(Boolean)
        .join('\n\n') || undefined;

    const analysisPayload: PushAnalysisPayload = {
      title,
      description,
      owner,
      repo,
      branch,
      beforeSha,
      afterSha,
      files,
    };

    return this.analyzePush(userId, analysisPayload);
  }

  async listRuns(
    userId: string,
    owner: string,
    repo: string,
    branch: string,
  ) {
    return this.pushAnalysisRunModel
      .find({
        userId: new Types.ObjectId(userId),
        owner,
        repo,
        branch,
      })
      .sort({ createdAt: -1 })
      .lean();
  }

  async getRun(userId: string, owner: string, repo: string, runId: string) {
    const run = await this.pushAnalysisRunModel
      .findOne({
        _id: runId,
        userId: new Types.ObjectId(userId),
        owner,
        repo,
      })
      .lean();

    if (!run) {
      throw new NotFoundException('Analysis run not found');
    }

    return run;
  }

  private async fetchFileContent(
    userId: string,
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string> {
    try {
      const filePayload = (await this.githubService.getRepositoryFileForUserId(
        userId,
        owner,
        repo,
        path,
        ref,
      )) as { content?: string };

      return typeof filePayload.content === 'string' ? filePayload.content : '';
    } catch {
      return '';
    }
  }
}
