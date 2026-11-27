import type { JsonValue } from './llm';

export type Variable = { name: string; value: JsonValue };
export const variableLimit = 100;
export const variableValueLimit = 16_000;

export function isVariableName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z_][a-zA-Z_0-9]{0,63}$/.test(value);
}

export function isVariableValue(value: unknown): value is JsonValue {
  function valid(item: unknown, depth: number): boolean {
    if (typeof item === 'string') return item.isWellFormed();
    if (typeof item === 'number') return Number.isFinite(item);
    if (item === null || typeof item === 'boolean') return true;
    if (typeof item !== 'object' || depth === 12) return false;
    if (Array.isArray(item)) return item.every((child) => valid(child, depth + 1));
    return Object.entries(item).every(([key, child]) => key.isWellFormed() && valid(child, depth + 1));
  }
  return valid(value, 0) && JSON.stringify(value).length <= variableValueLimit;
}

export function readVariables(value: unknown): { variables: Variable[] } | { field: string } {
  if (!Array.isArray(value) || value.length > variableLimit) return { field: '/variables' };
  const names = new Set<string>();
  const variables: Variable[] = [];
  for (const [index, item] of value.entries()) {
    const path = `/variables/${index}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item) ||
      Object.keys(item).some((key) => key !== 'name' && key !== 'value') ||
      !isVariableName(item.name) || names.has(item.name)) return { field: `${path}/name` };
    if (!isVariableValue(item.value)) return { field: `${path}/value` };
    names.add(item.name);
    variables.push({ name: item.name, value: item.value });
  }
  return { variables };
}
