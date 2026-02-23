import type { RunAudit } from '../types';

export function buildAudit(params: RunAudit): RunAudit {
  return {
    ...params,
    generatedAtIso: params.generatedAtIso,
    issuesByReason: { ...params.issuesByReason },
    counts: { ...params.counts },
    inputs: { ...params.inputs },
    mappings: { ...params.mappings },
    parameters: { ...params.parameters },
    notes: [...params.notes],
    outputFiles: [...params.outputFiles],
  };
}

export function auditToPrettyJson(audit: RunAudit): string {
  return `${JSON.stringify(audit, null, 2)}\n`;
}

export function incrementReason(
  reasons: Record<string, number>,
  reason: string,
): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}
