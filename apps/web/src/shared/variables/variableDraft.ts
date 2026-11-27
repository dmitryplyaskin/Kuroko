import type { Variable } from '@kuroko/contracts/variables';
import { newLocalId } from '../browser/id';

export type VariableDraft = { id: string; name: string; source: string; format: 'text' | 'json' };

export function variableDrafts(variables: Variable[] = []): VariableDraft[] {
  return variables.map(({ name, value }) => typeof value === 'string'
    ? { id: newLocalId(), name, source: value, format: 'text' }
    : { id: newLocalId(), name, source: JSON.stringify(value), format: 'json' });
}

export function variableDraftsEqual(baseline: VariableDraft[], draft: VariableDraft[]) {
  return baseline.length === draft.length && draft.every(({ name, source, format }, index) => {
    const initial = baseline[index]!;
    return name === initial.name && source === initial.source && format === initial.format;
  });
}

export function parseVariableDrafts(drafts: VariableDraft[]): { variables: Variable[] } | { field: string } {
  const variables: Variable[] = [];
  for (const [index, { name, source, format }] of drafts.entries()) {
    try {
      variables.push({ name: name.trim(), value: format === 'text' ? source : JSON.parse(source) });
    } catch {
      return { field: `/variables/${index}/value` };
    }
  }
  return { variables };
}
