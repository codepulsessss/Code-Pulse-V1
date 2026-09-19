import type { RetrievedChunk } from '../types/chunk.types.js';
import { normalizePath } from '../vector-store/vector-store.service.js';

const DEFAULT_TOKEN_BUDGET = 6000;
const MAX_CHUNKS_PER_PATH = 3;

export function mergeByFixedPriority(
  tiers: RetrievedChunk[][],
  changedFiles: string[],
  tokenBudget = DEFAULT_TOKEN_BUDGET,
): RetrievedChunk[] {
  const excluded = new Set(changedFiles.map(normalizePath));
  const seen = new Set<string>();
  const perPathCount = new Map<string, number>();
  const merged: RetrievedChunk[] = [];
  let usedChars = 0;

  for (const tier of tiers) {
    for (const chunk of tier) {
      const normalizedPath = normalizePath(chunk.path);
      if (excluded.has(normalizedPath)) {
        continue;
      }

      const key = `${normalizedPath}:${chunk.startLine}:${chunk.endLine}`;
      if (seen.has(key)) {
        continue;
      }

      const pathCount = perPathCount.get(normalizedPath) ?? 0;
      if (pathCount >= MAX_CHUNKS_PER_PATH) {
        continue;
      }

      const chunkLength = chunk.text.length;
      if (usedChars + chunkLength > tokenBudget) {
        return merged;
      }

      seen.add(key);
      perPathCount.set(normalizedPath, pathCount + 1);
      usedChars += chunkLength;
      merged.push(chunk);
    }
  }

  return merged;
}

export function formatRelatedContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return '';
  }

  const body = chunks
    .map(
      (chunk) =>
        `--- ${chunk.path} (L${chunk.startLine}-${chunk.endLine}) ---\n${chunk.text}`,
    )
    .join('\n\n');

  return `RELATED CODEBASE CONTEXT
(Repository code outside this changeset that may be affected)

${body}`;
}

export function isTestOrSpecPath(path: string): boolean {
  return /\.(spec|test)\./i.test(path) || /_(spec|test)\./i.test(path);
}

export function getDirectoryPrefix(filePath: string): string {
  const normalized = normalizePath(filePath);
  const parts = normalized.split('/');
  if (parts.length <= 1) {
    return '';
  }
  parts.pop();
  return `${parts.join('/')}/`;
}

export function buildTestPattern(baseName: string): RegExp {
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped}\\.(spec|test)\\.[a-z0-9]+$`, 'i');
}
