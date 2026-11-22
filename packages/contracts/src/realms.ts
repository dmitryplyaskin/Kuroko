export const realmSpecVersion = '0.1.0';

export type RealmEntry = { id: string; title: string; content: string; order?: number };
export type RealmCharacter = RealmEntry & { summary?: string; avatar?: string };
export type RealmSection = { id: string; title: string; entries: RealmEntry[] };
export type RealmSectionEntryRef = { sectionId: string; entryId: string };
export type RealmStart = {
  id: string;
  title: string;
  order?: number;
  scenario?: string;
  greeting?: string;
  characterIds?: string[];
  loreEntryIds?: string[];
  sectionEntries?: RealmSectionEntryRef[];
};
export type Realm = {
  specVersion: typeof realmSpecVersion;
  id: string;
  title: string;
  base: string;
  description?: string;
  author?: string;
  version?: string;
  authorNotes?: string;
  tags?: string[];
  avatar?: string;
  characters?: RealmCharacter[];
  lorebook?: RealmEntry[];
  sections?: RealmSection[];
  starts?: RealmStart[];
};

export type SavedRealm = { id: string; revision: number; createdAt: number; updatedAt: number; favorite?: true; realm: Realm };
export type UpdateRealm = Pick<SavedRealm, 'revision' | 'realm'>;
export type RealmSummary = Pick<SavedRealm, 'id' | 'createdAt' | 'updatedAt' | 'favorite'> & {
  title: string;
  excerpt: string;
  characters: number;
  starts: number;
  tags?: string[];
  hasAvatar?: true;
};
export const realmSorts = ['updated', 'created', 'title-asc', 'title-desc'] as const;
export type RealmSort = typeof realmSorts[number];
export const realmStartsFilters = ['any', 'with', 'without'] as const;
export type RealmStartsFilter = typeof realmStartsFilters[number];
export type RealmFilters = { author: string; tags: readonly string[]; starts: RealmStartsFilter; favorites: boolean };
export const defaultRealmFilters: RealmFilters = { author: '', tags: [], starts: 'any', favorites: false };
export type RealmFilterOption = { value: string; label: string };
export type RealmFilterOptions = { authors: RealmFilterOption[]; tags: RealmFilterOption[] };
export type RealmFavorite = { id: string; favorite: boolean };
export type RealmListQuery = { q: string; sort: RealmSort; limit: number; offset: number; filters: RealmFilters };
export type RealmList = { items: RealmSummary[]; total: number };
export const realmSearchMaxLength = 200;
export const realmPageSize = 24;
export const realmRequestByteLimit = 8 * 1024 * 1024;
export const realmAvatarMaxLength = 65_536;
export const realmMaxOrder = 999_999;

export function isRealmOrder(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= realmMaxOrder;
}

export function orderedRealmRecords<T extends { order?: number }>(records: readonly T[]) {
  return records.map((record, index) => ({ record, order: record.order ?? index + 1 }))
    .sort((a, b) => a.order - b.order);
}

export function realmSearchKey(text: string) {
  return text.normalize('NFKC').toLowerCase();
}

export function readRealmAvatar(value: unknown) {
  if (typeof value !== 'string' || value.length > realmAvatarMaxLength) return;
  const [matched, mime, data] = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value) ?? [];
  if (matched !== value || !mime || !data || data.length % 4 !== 0) return;
  const header = atob(data.slice(0, 16));
  const valid = mime === 'image/png' ? header.startsWith('\x89PNG\r\n\x1a\n')
    : mime === 'image/jpeg' ? header.startsWith('\xff\xd8\xff') : header.startsWith('RIFF') && header.slice(8) === 'WEBP';
  if (valid) return { mime, data };
}

type RealmIssue = { code: 'realm_invalid' | 'realm_duplicate_id' | 'realm_reference_missing'; field: string };

function objectWithKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key));
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.isWellFormed();
}

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isText) && new Set(value).size === value.length;
}

function isEntry(value: unknown): value is RealmEntry {
  return objectWithKeys(value, ['id', 'title', 'content', 'order']) &&
    isText(value.id) && isText(value.title) && isText(value.content) &&
    (value.order === undefined || isRealmOrder(value.order));
}

function isCharacter(value: unknown): value is RealmCharacter {
  return objectWithKeys(value, ['id', 'title', 'content', 'order', 'summary', 'avatar']) &&
    isText(value.id) && isText(value.title) && isText(value.content) &&
    (value.order === undefined || isRealmOrder(value.order)) &&
    (value.summary === undefined || isText(value.summary)) &&
    (value.avatar === undefined || readRealmAvatar(value.avatar) !== undefined);
}

function isSection(value: unknown): value is Omit<RealmSection, 'entries'> & { entries: unknown[] } {
  return objectWithKeys(value, ['id', 'title', 'entries']) &&
    isText(value.id) && isText(value.title) && Array.isArray(value.entries);
}

function isSectionEntryRef(value: unknown): value is RealmSectionEntryRef {
  return objectWithKeys(value, ['sectionId', 'entryId']) && isText(value.sectionId) && isText(value.entryId);
}

function isStart(value: unknown): value is RealmStart {
  return objectWithKeys(value, ['id', 'title', 'order', 'scenario', 'greeting', 'characterIds', 'loreEntryIds', 'sectionEntries']) &&
    isText(value.id) && isText(value.title) &&
    (value.order === undefined || isRealmOrder(value.order)) &&
    (isText(value.scenario) || isText(value.greeting)) &&
    (value.scenario === undefined || isText(value.scenario)) &&
    (value.greeting === undefined || isText(value.greeting)) &&
    (value.characterIds === undefined || isIdList(value.characterIds)) &&
    (value.loreEntryIds === undefined || isIdList(value.loreEntryIds)) &&
    (value.sectionEntries === undefined || (Array.isArray(value.sectionEntries) && value.sectionEntries.every(isSectionEntryRef)));
}

function checkCollection<T extends { id: string }>(value: unknown, field: string, check: (item: unknown) => item is T): RealmIssue | undefined {
  if (value === undefined) return;
  if (!Array.isArray(value)) return { code: 'realm_invalid', field };
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!check(item)) return { code: 'realm_invalid', field: `${field}/${index}` };
    if (ids.has(item.id)) return { code: 'realm_duplicate_id', field: `${field}/${index}/id` };
    ids.add(item.id);
  }
}

export function readRealm(value: unknown): { realm: Realm } | RealmIssue {
  if (!objectWithKeys(value, [
    'specVersion', 'id', 'title', 'base', 'description', 'author', 'version', 'authorNotes', 'tags', 'avatar',
    'characters', 'lorebook', 'sections', 'starts',
  ])) {
    return { code: 'realm_invalid', field: '' };
  }
  if (value.specVersion !== realmSpecVersion) return { code: 'realm_invalid', field: '/specVersion' };
  for (const key of ['id', 'title', 'base'] as const) {
    if (!isText(value[key])) return { code: 'realm_invalid', field: `/${key}` };
  }
  for (const key of ['description', 'author', 'version', 'authorNotes'] as const) {
    if (value[key] !== undefined && !isText(value[key])) return { code: 'realm_invalid', field: `/${key}` };
  }
  if (value.tags !== undefined && !isIdList(value.tags)) return { code: 'realm_invalid', field: '/tags' };
  if (value.avatar !== undefined && !readRealmAvatar(value.avatar)) return { code: 'realm_invalid', field: '/avatar' };
  const issue = checkCollection(value.characters, '/characters', isCharacter) ??
    checkCollection(value.lorebook, '/lorebook', isEntry) ?? checkCollection(value.sections, '/sections', isSection) ??
    checkCollection(value.starts, '/starts', isStart);
  if (issue) return issue;
  const realm = value as Realm;
  for (const [index, section] of (realm.sections ?? []).entries()) {
    const invalid = checkCollection(section.entries, `/sections/${index}/entries`, isEntry);
    if (invalid) return invalid;
  }
  return checkReferences(realm) ?? { realm };
}

function checkReferences(realm: Realm): RealmIssue | undefined {
  const characters = new Set(realm.characters?.map(({ id }) => id));
  const lorebook = new Set(realm.lorebook?.map(({ id }) => id));
  const sections = new Map(realm.sections?.map(({ id, entries }) => [id, new Set(entries.map((entry) => entry.id))]));
  for (const [index, start] of (realm.starts ?? []).entries()) {
    const field = `/starts/${index}`;
    if (start.characterIds?.some((id) => !characters.has(id))) return { code: 'realm_reference_missing', field: `${field}/characterIds` };
    if (start.loreEntryIds?.some((id) => !lorebook.has(id))) return { code: 'realm_reference_missing', field: `${field}/loreEntryIds` };
    const seen = new Set<string>();
    for (const [refIndex, { sectionId, entryId }] of (start.sectionEntries ?? []).entries()) {
      const refField = `${field}/sectionEntries/${refIndex}`;
      if (!sections.get(sectionId)?.has(entryId)) return { code: 'realm_reference_missing', field: refField };
      const key = JSON.stringify([sectionId, entryId]);
      if (seen.has(key)) return { code: 'realm_duplicate_id', field: refField };
      seen.add(key);
    }
  }
}
