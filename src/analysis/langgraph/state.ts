import { Annotation } from '@langchain/langgraph';

export interface ChangedFile {
  filename: string;
  patch: string;
  content: string;
  baseContent: string;
}

export interface PushAnalysisPayload {
  title: string;
  description?: string;
  owner: string;
  repo: string;
  branch: string;
  beforeSha: string;
  afterSha: string;
  files: ChangedFile[];
}

export interface RetrievedChunk {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  source: string;
}

export interface Finding {
  file: string;
  issue: string;
  severity: 'low' | 'medium' | 'high';
  suggestion?: string;
}

export type DomainKey = 'quality' | 'security' | 'performance' | 'bugDetection';

export const PARALLEL_DOMAIN_KEYS: DomainKey[] = [
  'quality',
  'security',
  'performance',
];

export const DOMAIN_KEYS: DomainKey[] = [
  ...PARALLEL_DOMAIN_KEYS,
  'bugDetection',
];

export type DomainReport = {
  domain: DomainKey;
  rating: 1 | 2 | 3 | 4 | 5;
  summary: string;
  weakAreas?: string[];
  findings: Finding[];
};

export const GraphAnnotation = Annotation.Root({
  input: Annotation<PushAnalysisPayload>(),
  cleanedInput: Annotation<PushAnalysisPayload | undefined>(),
  relatedContext: Annotation<RetrievedChunk[] | undefined>(),
  relatedContextFormatted: Annotation<string | undefined>(),
  findings: Annotation<Finding[] | undefined>(),
  domainReports: Annotation<Partial<Record<DomainKey, DomainReport>>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  bugDetectionPromptAddendum: Annotation<string | undefined>(),
  finalReport: Annotation<Record<string, unknown> | undefined>(),
});

export type GraphState = typeof GraphAnnotation.State;
