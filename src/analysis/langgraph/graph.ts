import { END, START, StateGraph } from '@langchain/langgraph';
import type { RetrieverService } from '../../repo-rag/retrieval/retriever.service.js';
import { GraphAnnotation } from './state.js';
import { assemblerNode } from './node/assembler.node.js';
import { bugDetectionReviewerNode } from './node/reviewer.node.js';
import { inputGuardNode } from './node/input-guard.node.js';
import { joinNode } from './node/join.node.js';
import { performanceReviewerNode } from './node/performance-reviewer.node.js';
import { qualityReviewerNode } from './node/quality-reviewer.node.js';
import { createRetrieverNode } from './node/retriever.node.js';
import { securityReviewerNode } from './node/security-reviewer.node.js';

/**
 * Pipeline:
 *   inputGuard → retriever (RAG) → [qualityReview | securityReview | performanceReview]
 *   → joinNode → bugDetection → assembler
 *
 * The retriever node must run before domain reviewers so `relatedContextFormatted`
 * is available in every LLM prompt.
 */
export const buildGraph = (retrieverService: RetrieverService) => {
  const retrieverNode = createRetrieverNode(retrieverService);

  const graph = new StateGraph(GraphAnnotation)
    .addNode('inputGuard', inputGuardNode)
    .addNode('retriever', retrieverNode)
    .addNode('qualityReview', qualityReviewerNode)
    .addNode('securityReview', securityReviewerNode)
    .addNode('performanceReview', performanceReviewerNode)
    .addNode('joinNode', joinNode)
    .addNode('bugDetection', bugDetectionReviewerNode)
    .addNode('assembler', assemblerNode)
    .addEdge(START, 'inputGuard')
    .addEdge('inputGuard', 'retriever')
    .addEdge('retriever', 'qualityReview')
    .addEdge('retriever', 'securityReview')
    .addEdge('retriever', 'performanceReview')
    .addEdge('qualityReview', 'joinNode')
    .addEdge('securityReview', 'joinNode')
    .addEdge('performanceReview', 'joinNode')
    .addEdge('joinNode', 'bugDetection')
    .addEdge('bugDetection', 'assembler')
    .addEdge('assembler', END);

  return graph.compile();
};
