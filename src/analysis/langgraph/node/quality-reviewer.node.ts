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

export const qualityReviewerNode = async (
  state: GraphState,
): Promise<Partial<GraphState>> => {
  const model = createGemini();
  const filesText = buildFilesPromptSection(state);
  const relatedContext = buildRelatedContextBlock(state);

  const prompt = `
You are a senior software engineer reviewing a pushed changeset focused on CODE QUALITY.

Focus areas:
- readability, naming, maintainability
- error handling and edge cases
- correctness risks and confusing logic
- API design clarity and consistency

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
    summary: 'Code quality review completed.',
    weakAreas: [],
    findings: [],
  });

  const report: DomainReport = buildDomainReport({
    domain: 'quality',
    parsed,
    fallbackSummary: 'Code quality review completed.',
  });

  logDomainComplete('quality', report);

  return {
    domainReports: {
      quality: report,
    },
  };
};
