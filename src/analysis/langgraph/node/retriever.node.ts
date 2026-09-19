import type { RetrieverService } from '../../../repo-rag/retrieval/retriever.service.js';
import type { GraphState } from '../state.js';

const LOG_PREFIX = '[analysis]';

export const createRetrieverNode =
  (retrieverService: RetrieverService) =>
  async (state: GraphState): Promise<Partial<GraphState>> => {
    const input = state.cleanedInput ?? state.input;
    console.log(
      `${LOG_PREFIX} retriever node: ${input.owner}/${input.repo}@${input.branch} ` +
        `files=${input.files.length}`,
    );

    const { chunks, formatted } = await retrieverService.retrieveRelatedContext({
      owner: input.owner,
      repo: input.repo,
      baseBranch: input.branch,
      files: input.files,
    });

    console.log(
      `${LOG_PREFIX} retriever node complete: ${chunks.length} chunks, ` +
        `formatted=${formatted.length} chars`,
    );

    return {
      relatedContext: chunks,
      relatedContextFormatted: formatted,
    };
  };
