import { createGemini } from '../gemini.factory.js';
import type { DomainReport, GraphState } from '../state.js';
import {
  SHARED_REVIEW_RULES,
  buildDomainReport,
  buildFilesPromptSection,
  buildRelatedContextBlock,
  extractModelTextContent,
  logDomainComplete,
  parseStrictJson,
} from './domain-review.util.js';

export const performanceReviewerNode = async (
  state: GraphState,
): Promise<Partial<GraphState>> => {
  const model = createGemini();
  const filesText = buildFilesPromptSection(state);
  const relatedContext = buildRelatedContextBlock(state);

  const prompt = `
You are a senior software engineer reviewing a pushed changeset focused on PERFORMANCE.

Focus areas:
- slow loops, unnecessary work, excessive allocations
- N+1 query patterns / inefficient DB usage
- expensive synchronous operations on request paths
- missing pagination/caching opportunities
- algorithmic complexity regressions

Analyze the following changes and return STRICT JSON only (no markdown/backticks/explanations).

CHANGESET TITLE:
${state.cleanedInput?.title ?? ''}

CHANGESET DESCRIPTION:
${state.cleanedInput?.description ?? ''}

FILES:
${filesText}
${relatedContext}
${SHARED_REVIEW_RULES}
Return ONLY this JSON structure:
{
  "rating": 1,
  "summary": "string",
  "weakAreas": ["string"],
  "findings": [
    {
      "file": "string",
      "issue": "string",
      "severity": "low | medium | high",
      "suggestion": "string"
    }
  ]
}
`;

  const response = await model.invoke(prompt);
  const raw = extractModelTextContent(response);
  const parsed = parseStrictJson(raw, {
    rating: 3,
    summary: 'Performance review completed.',
    weakAreas: [],
    findings: [],
  });

  const report: DomainReport = buildDomainReport({
    domain: 'performance',
    parsed,
    fallbackSummary: 'Performance review completed.',
  });

  logDomainComplete('performance', report);

  return {
    domainReports: {
      performance: report,
    },
  };
};
