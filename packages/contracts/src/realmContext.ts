import type { PersonaDraft } from './personas';
import { orderedRealmRecords, type Realm, type RealmEntry, type RealmPlayerRole, type RealmStart } from './realms';

type ContextEntry = Pick<RealmEntry, 'id' | 'title' | 'content'> & { order: number } & (
  { source: 'character' | 'lorebook' } | { source: 'section'; sectionId: string; sectionTitle: string }
);

export type RealmContext = {
  base: string;
  scenario?: string;
  greeting?: string;
  playerRole?: RealmPlayerRole;
  playerPersona?: { name?: string; description: string };
  entries: ContextEntry[];
};

export function resolvePlayerPersona(role?: RealmPlayerRole, persona?: Pick<PersonaDraft, 'name' | 'description'>): RealmContext['playerPersona'] {
  const roleDescription = role?.description?.trim();
  const name = role?.name?.trim() || persona?.name;
  const description = roleDescription && role?.descriptionMode === 'replace'
    ? roleDescription : [persona?.description, roleDescription].filter(Boolean).join('\n\n');
  return name || description ? { ...(name ? { name } : {}), description } : undefined;
}

export function resolveRealmContext(realm: Realm, start?: RealmStart, persona?: Pick<PersonaDraft, 'name' | 'description'>): RealmContext {
  const playerRole = realm.playerRoles?.find(({ id }) => id === start?.playerRoleId);
  const characterIds = new Set(start?.characterIds);
  const loreIds = new Set(start?.loreEntryIds);
  const sectionIds = new Map<string, Set<string>>();
  for (const { sectionId, entryId } of start?.sectionEntries ?? []) {
    const ids = sectionIds.get(sectionId) ?? new Set<string>();
    ids.add(entryId);
    sectionIds.set(sectionId, ids);
  }

  const entries: ContextEntry[] = [];
  for (const { record: { id, title, content }, order } of orderedRealmRecords(realm.characters ?? [])) {
    if (characterIds.has(id)) entries.push({ source: 'character', id, title, content, order });
  }
  for (const { record: { id, title, content }, order } of orderedRealmRecords(realm.lorebook ?? [])) {
    if (loreIds.has(id)) entries.push({ source: 'lorebook', id, title, content, order });
  }
  for (const section of realm.sections ?? []) {
    const ids = sectionIds.get(section.id);
    if (!ids) continue;
    for (const { record: { id, title, content }, order } of orderedRealmRecords(section.entries)) {
      if (ids.has(id)) entries.push({ source: 'section', sectionId: section.id, sectionTitle: section.title, id, title, content, order });
    }
  }

  const playerPersona = resolvePlayerPersona(playerRole, persona);
  return {
    base: realm.base, scenario: start?.scenario, greeting: start?.greeting, entries: entries.sort((a, b) => a.order - b.order),
    ...(playerRole ? { playerRole } : {}),
    ...(playerPersona ? { playerPersona } : {}),
  };
}
