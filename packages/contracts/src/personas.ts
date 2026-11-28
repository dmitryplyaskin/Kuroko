import { readAvatar } from './avatar';
import { presetNameLimit, readPresetName } from './presets';
import { readVariables, type Variable } from './variables';

export type PersonaDraft = { name: string; description: string; avatar?: string; variables: Variable[] };
export type SavedPersona = PersonaDraft & { id: string; revision: number; createdAt: number; updatedAt: number };
export type CreatePersona = PersonaDraft & Pick<SavedPersona, 'id'>;
export type UpdatePersona = PersonaDraft & Pick<SavedPersona, 'revision'>;
export type DeletePersona = Pick<SavedPersona, 'revision'>;
export type PersonaFavorite = { favorite: boolean };
export type PersonaSelection = { id: string | null };
export type PersonaForPrompt = Pick<SavedPersona, 'id' | 'name' | 'description' | 'variables'>;
export type PersonaSummary = Pick<SavedPersona, 'id' | 'name' | 'revision'> &
  PersonaFavorite & { excerpt: string; hasAvatar: boolean; variableCount: number };
export type PersonaIdentity = Pick<PersonaSummary, 'id' | 'name' | 'revision' | 'hasAvatar'>;
export type PersonaSelectionResult = PersonaIdentity | { id: null };

export const personaSorts = ['updated', 'created', 'name-asc', 'name-desc'] as const;
export const personaVariableFilters = ['any', 'with', 'without'] as const;
export type PersonaListQuery = {
  q: string;
  sort: typeof personaSorts[number];
  variables: typeof personaVariableFilters[number];
  favorites: boolean;
  offset: number;
};
export type PersonaList = { items: PersonaSummary[]; total: number; offset: number };
export const defaultPersonaQuery: PersonaListQuery = { q: '', sort: 'updated', variables: 'any', favorites: false, offset: 0 };

export const personaNameLimit = presetNameLimit;
export const personaDescriptionLimit = 32_000;
export const personaSearchLimit = 200;
export const personaPageSize = 24;
export const personaRequestByteLimit = 8 * 1024 * 1024;

export function isPersonaId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

export function readPersona(value: unknown): { draft: PersonaDraft } | { field: string } {
  const input = value as Partial<Record<keyof PersonaDraft, unknown>> | null | undefined;
  const name = readPresetName(input?.name);
  if (!name) return { field: '/name' };
  const description = input?.description;
  if (typeof description !== 'string' || description.length > personaDescriptionLimit ||
    !description.isWellFormed() || description.includes('\0')) return { field: '/description' };
  const avatar = input?.avatar;
  if (avatar !== undefined && (typeof avatar !== 'string' || !readAvatar(avatar))) return { field: '/avatar' };
  const variables = readVariables(input?.variables);
  if ('field' in variables) return variables;
  return { draft: { name, description: description.trim(), avatar, variables: variables.variables } };
}
