import type { DomainReport, GraphState } from '../state.js';
import { createGemini } from '../gemini.factory.js';
import {
  SHARED_REVIEW_RULES,
  buildDomainReport,
  buildFilesPromptSection,
  buildRelatedContextBlock,
  extractModelTextContent,
  logDomainComplete,
  parseStrictJson,
} from './domain-review.util.js';

const LOG_PREFIX = '[analysis]';

/**
 * Bug detection pass — runs after parallel domain reviews and joinNode shaping.
 */
export const bugDetectionReviewerNode = async (
  state: GraphState,
): Promise<Partial<GraphState>> => {
  const quality = state.domainReports?.quality;
  const security = state.domainReports?.security;
  const performance = state.domainReports?.performance;

  if (!quality || !security || !performance) {
    return {};
  }

  console.log(`${LOG_PREFIX} bugDetection node: invoking LLM for ${state.input.branch}@${state.input.afterSha?.slice(0, 7)}`);

  const model = createGemini();
  const filesText = buildFilesPromptSection(state);
  const relatedContext = buildRelatedContextBlock(state);
  const addendum = state.bugDetectionPromptAddendum?.trim();

  const prompt = `
You are a senior software engineer doing BUG DETECTION in a pushed changeset.

Goal: find correctness bugs, edge-case failures, hidden regressions, and logic mistakes.

${addendum ? `EXTRA FOCUS (derived from other domain reviews):\n${addendum}\n` : ''}
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
    summary: 'Bug detection review completed.',
    weakAreas: [],
    findings: [],
  });

  const report: DomainReport = buildDomainReport({
    domain: 'bugDetection',
    parsed,
    fallbackSummary: 'Bug detection review completed.',
  });

  logDomainComplete('bugDetection', report);

  return {
    findings: report.findings,
    domainReports: {
      bugDetection: report,
    },
  };
};

