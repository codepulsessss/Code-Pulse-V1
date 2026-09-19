import {
  DOMAIN_KEYS,
  type DomainKey,
  type DomainReport,
  type Finding,
  type GraphState,
} from '../state.js';

const LOG_PREFIX = '[analysis]';
const MAX_FINDINGS = 20;
const MAX_ISSUE_TOKENS = 4;

const SEVERITY_RANK: Record<Finding['severity'], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export const assemblerNode = async (state: GraphState): Promise<Partial<GraphState>> => {
  const domainReports = state.domainReports ?? {};
  const reports: Partial<Record<DomainKey, DomainReport>> = {};

  for (const domain of DOMAIN_KEYS) {
    const report = domainReports[domain];
    if (report) {
      reports[domain] = report;
    }
  }

  const allFindings: Finding[] = [];
  for (const domain of DOMAIN_KEYS) {
    const report = reports[domain];
    if (report?.findings?.length) {
      allFindings.push(...report.findings);
    }
  }

  const postprocessed = postprocessFindings(allFindings);

  const severityCounts = postprocessed.reduce(
    (acc, finding) => {
      acc[finding.severity] += 1;
      return acc;
    },
    { low: 0, medium: 0, high: 0 } as Record<'low' | 'medium' | 'high', number>,
  );

  const domainCounts = DOMAIN_KEYS.reduce(
    (acc, domain) => {
      acc[domain] = reports[domain]?.findings?.length ?? 0;
      return acc;
    },
    {} as Record<DomainKey, number>,
  );

  const overallSummary =
    `Found ${postprocessed.length} issues ` +
    `(high: ${severityCounts.high}, medium: ${severityCounts.medium}, low: ${severityCounts.low}).`;

  console.log(
    `${LOG_PREFIX} assembler node: ${state.input.branch}@${state.input.afterSha?.slice(0, 7)} ` +
      `raw=${allFindings.length} unique=${postprocessed.length} ` +
      `domains=${JSON.stringify(domainCounts)}`,
  );

  const relatedContextCount = state.relatedContext?.length ?? 0;
  const relatedContextPaths =
    state.relatedContext?.slice(0, 12).map((chunk) => chunk.path) ?? [];

  return {
    finalReport: {
      owner: state.input.owner,
      repo: state.input.repo,
      branch: state.input.branch,
      beforeSha: state.input.beforeSha,
      afterSha: state.input.afterSha,
      overallSummary,
      summary: overallSummary,
      domainReports: reports,
      allFindings: postprocessed,
      findings: postprocessed,
      counts: {
        severity: severityCounts,
        domain: domainCounts,
      },
      bugDetectionPromptAddendum: state.bugDetectionPromptAddendum ?? '',
      relatedContextCount,
      relatedContextPaths,
    },
  };
};

export function postprocessFindings(findings: Finding[]): Finding[] {
  const deduped = dedupeFindings(findings);
  const floored = deduped.map(applySeverityFloor);
  floored.sort((a, b) => {
    const severityDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return a.file.localeCompare(b.file);
  });
  return floored.slice(0, MAX_FINDINGS);
}

function dedupeFindings(findings: Finding[]): Finding[] {
  const groups: Finding[] = [];

  for (const finding of findings) {
    const key = normalizeIssue(finding.issue);
    const matchIndex = groups.findIndex(
      (existing) =>
        existing.file === finding.file &&
        issuesAreDuplicate(normalizeIssue(existing.issue), key),
    );

    if (matchIndex === -1) {
      groups.push(finding);
      continue;
    }

    groups[matchIndex] = preferFinding(groups[matchIndex]!, finding);
  }

  return groups;
}

function issuesAreDuplicate(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  return a.startsWith(b) || b.startsWith(a);
}

function normalizeIssue(issue: string): string {
  const tokens = issue
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_ISSUE_TOKENS);

  return tokens.join(' ');
}

function preferFinding(a: Finding, b: Finding): Finding {
  const rankDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (rankDiff > 0) {
    return b;
  }
  if (rankDiff < 0) {
    return a;
  }

  const aSuggestion = a.suggestion?.length ?? 0;
  const bSuggestion = b.suggestion?.length ?? 0;
  return bSuggestion > aSuggestion ? b : a;
}

function applySeverityFloor(finding: Finding): Finding {
  const text = `${finding.issue} ${finding.suggestion ?? ''}`.toLowerCase();
  const floor = severityFloorForText(text);
  if (SEVERITY_RANK[floor] <= SEVERITY_RANK[finding.severity]) {
    return finding;
  }
  return { ...finding, severity: floor };
}

function severityFloorForText(text: string): Finding['severity'] {
  if (
    /sql\s*injection/.test(text) ||
    /open\s*redirect/.test(text) ||
    /missing\s*auth/.test(text) ||
    /unauthenticated/.test(text) ||
    (/hardcoded/.test(text) && /(?:secret|password|api\s*key)/.test(text))
  ) {
    return 'high';
  }

  if (
    /n\s*\+\s*1/.test(text) ||
    /null\s*dereference/.test(text) ||
    /off[\s-]*by[\s-]*one/.test(text)
  ) {
    return 'medium';
  }

  return 'low';
}
