import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { ChangedFile } from '../../analysis/langgraph/state.js';
import { chunkFile } from '../chunking/chunk-file.js';
import {
  extractImportPaths,
  resolveImportCandidates,
} from '../chunking/symbol-extractor.js';
import { shouldIndex } from '../chunking/should-index.js';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import {
  RepoIndex,
  type RepoIndexDocument,
} from '../schemas/repo-index.schema.js';
import type { RetrievedChunk } from '../types/chunk.types.js';
import {
  normalizePath,
  VectorStoreService,
} from '../vector-store/vector-store.service.js';
import {
  buildTestPattern,
  formatRelatedContext,
  getDirectoryPrefix,
  isTestOrSpecPath,
  mergeByFixedPriority,
} from './context-assembler.js';

const LOG_PREFIX = '[analysis]';

export interface RetrievalInput {
  owner: string;
  repo: string;
  baseBranch: string;
  files: ChangedFile[];
}

@Injectable()
export class RetrieverService {
  constructor(
    @InjectModel(RepoIndex.name)
    private readonly repoIndexModel: Model<RepoIndexDocument>,
    private readonly vectorStore: VectorStoreService,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  async ensureIndexed(owner: string, repo: string, branch: string): Promise<RepoIndexDocument> {
    const record = await this.repoIndexModel.findOne({ owner, repo, branch });
    if (!record || record.status !== 'ready') {
      throw new ConflictException({
        message: 'Repository branch is not indexed for retrieval',
        indexUrl: `/api/v1/repo-index/connect`,
        hint: 'POST { workspace: "owner/repo", branch } to index and register a webhook',
        status: record?.status ?? 'missing',
      });
    }
    return record;
  }

  async retrieveRelatedContext(input: RetrievalInput): Promise<{
    chunks: RetrievedChunk[];
    formatted: string;
  }> {
    const { owner, repo, baseBranch, files } = input;
    const repoId = `${owner}/${repo}`;
    console.log(
      `${LOG_PREFIX} retrieval started: ${repoId}@${baseBranch} files=${files.length}`,
    );

    let indexRecord: RepoIndexDocument;
    try {
      indexRecord = await this.ensureIndexed(owner, repo, baseBranch);
    } catch {
      console.log(
        `${LOG_PREFIX} retrieval skipped: ${repoId}@${baseBranch} not indexed`,
      );
      return { chunks: [], formatted: '' };
    }

    if (indexRecord.status !== 'ready') {
      console.log(
        `${LOG_PREFIX} retrieval skipped: ${repoId}@${baseBranch} status=${indexRecord.status}`,
      );
      return { chunks: [], formatted: '' };
    }

    const changedFiles = files.map((file) => normalizePath(file.filename));
    const changedSet = new Set(changedFiles);

    // V1: embed the PATCH only. The HEAD and symbol-name query inputs were
    // dropped — they're largely redundant with the patch, and embedding the big
    // concatenated file content was the slow part of retrieval.
    const patchContent = files.map((file) => file.patch).join('\n\n');

    const [importGraph, pathTestResults, pathSiblingResults] = await Promise.all([
      this.retrieveImportGraph(repoId, baseBranch, files, changedSet),
      this.retrievePathTests(repoId, baseBranch, files, changedSet),
      this.retrievePathSiblings(repoId, baseBranch, files, changedSet),
    ]);

    const semanticQueryText = patchContent.trim().slice(0, 6000);

    let semanticResults: RetrievedChunk[] = [];
    if (semanticQueryText.trim().length > 0) {
      try {
        const embedding = await this.embeddingsService.embedQuery(semanticQueryText);
        semanticResults = await this.vectorStore.query(
          embedding,
          repoId,
          baseBranch,
          12,
          changedFiles,
        );
        semanticResults.forEach((chunk) => {
          chunk.source = 'semantic-query';
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `${LOG_PREFIX} semantic vector search skipped — ${message}`,
        );
      }
    }

    const merged = mergeByFixedPriority(
      [
        importGraph,
        pathTestResults,
        pathSiblingResults,
        semanticResults,
      ],
      changedFiles,
    );

    console.log(
      `${LOG_PREFIX} retrieval sources: import=${importGraph.length} tests=${pathTestResults.length} ` +
        `siblings=${pathSiblingResults.length} semantic=${semanticResults.length} → merged=${merged.length}`,
    );
    if (merged.length > 0) {
      console.log(
        `${LOG_PREFIX} retrieval top paths:`,
        merged.slice(0, 8).map((c) => `${c.path} (${c.source ?? 'unknown'})`),
      );
    }

    return {
      chunks: merged,
      formatted: formatRelatedContext(merged),
    };
  }

  private async retrieveImportGraph(
    repoId: string,
    branch: string,
    files: ChangedFile[],
    changedSet: Set<string>,
  ): Promise<RetrievedChunk[]> {
    const results: RetrievedChunk[] = [];
    const seenPaths = new Set<string>();

    for (const file of files) {
      const source = file.content || file.patch;
      const imports = extractImportPaths(source);

      for (const importPath of imports) {
        const candidates = resolveImportCandidates(importPath, file.filename);
        for (const candidate of candidates) {
          const normalized = normalizePath(candidate);
          if (changedSet.has(normalized) || seenPaths.has(normalized)) {
            continue;
          }

          const chunks = await this.vectorStore.getChunksForPath(
            repoId,
            branch,
            normalized,
          );
          if (chunks.length > 0) {
            seenPaths.add(normalized);
            results.push(...chunks.slice(0, 3));
            break;
          }
        }
      }
    }

    return results;
  }

  private async retrievePathTests(
    repoId: string,
    branch: string,
    files: ChangedFile[],
    changedSet: Set<string>,
  ): Promise<RetrievedChunk[]> {
    const results: RetrievedChunk[] = [];

    for (const file of files) {
      const normalized = normalizePath(file.filename);
      const baseName = normalized.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
      if (!baseName) {
        continue;
      }

      const pattern = buildTestPattern(baseName);
      const chunks = await this.vectorStore.queryByPathPattern(
        repoId,
        branch,
        pattern,
        5,
        Array.from(changedSet),
      );
      results.push(...chunks.filter((chunk) => isTestOrSpecPath(chunk.path)));
    }

    return results;
  }

  private async retrievePathSiblings(
    repoId: string,
    branch: string,
    files: ChangedFile[],
    changedSet: Set<string>,
  ): Promise<RetrievedChunk[]> {
    const results: RetrievedChunk[] = [];
    const seenPrefixes = new Set<string>();

    for (const file of files) {
      const prefix = getDirectoryPrefix(file.filename);
      if (!prefix || seenPrefixes.has(prefix)) {
        continue;
      }
      seenPrefixes.add(prefix);

      const chunks = await this.vectorStore.queryByPathPrefix(
        repoId,
        branch,
        prefix,
        5,
        Array.from(changedSet),
      );

      results.push(
        ...chunks.filter(
          (chunk) => !isTestOrSpecPath(chunk.path) && !changedSet.has(normalizePath(chunk.path)),
        ),
      );
    }

    return results;
  }
}
