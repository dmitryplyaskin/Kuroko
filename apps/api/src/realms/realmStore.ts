import {
  realmSearchKey, realmSorts, type Realm, type RealmFilterOption, type RealmFilterOptions, type RealmListQuery,
  type RealmSort, type RealmStartsFilter, type RealmSummary, type SavedRealm, type UpdateRealm,
} from '@kuroko/contracts/realms';
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';
import { realmFilterKey, realmTagKeys } from './realmFilterKeys';

type Row = Omit<SavedRealm, 'realm' | 'favorite'> & { documentId: string; documentJson: string; favorite: 0 | 1 };
type SummaryRow = Omit<RealmSummary, 'hasAvatar' | 'favorite' | 'tags'> & {
  hasAvatar: 0 | 1;
  favorite: 0 | 1;
  tagsJson: string | null;
};
type FilterArgs = [number, string, string, string, RealmStartsFilter, number];

const rowFields = 'id, revision, created_at AS createdAt, updated_at AS updatedAt, document_id AS documentId, document_json AS documentJson, favorite';
const filter = `
  user_id = ?1 AND (?2 = '' OR instr(search_text, ?2) > 0) AND (?3 = '' OR author_key = ?3)
  AND NOT EXISTS (
    SELECT 1 FROM json_each(?4) AS wanted
    WHERE NOT EXISTS (SELECT 1 FROM json_each(realms.tag_keys_json) AS tag WHERE tag.value = wanted.value)
  )
  AND CASE ?5
    WHEN 'with' THEN coalesce(json_array_length(document_json, '$.starts'), 0) > 0
    WHEN 'without' THEN coalesce(json_array_length(document_json, '$.starts'), 0) = 0
    ELSE 1
  END
  AND (?6 = 0 OR favorite = 1)
`;
const ordering: Record<RealmSort, string> = {
  updated: 'updated_at DESC, id',
  created: 'created_at DESC, id',
  'title-asc': 'title_key, id',
  'title-desc': 'title_key DESC, id DESC',
};

function indexRealm(realm: Realm) {
  const text = [realm.title, realm.base, realm.description, realm.author, realm.version, realm.authorNotes, ...(realm.tags ?? [])];
  for (const character of realm.characters ?? []) text.push(character.title, character.summary, character.content);
  for (const entry of realm.lorebook ?? []) text.push(entry.title, entry.content);
  for (const section of realm.sections ?? []) {
    text.push(section.title);
    for (const entry of section.entries) text.push(entry.title, entry.content);
  }
  for (const start of realm.starts ?? []) text.push(start.title, start.scenario ?? '', start.greeting ?? '');
  return {
    titleKey: realmSearchKey(realm.title),
    excerpt: Array.from((realm.description?.trim() || realm.base).replace(/\s+/g, ' ').trim()).slice(0, 180).join(''),
    searchText: realmSearchKey(text.join('\n')),
    authorKey: realmFilterKey(realm.author ?? ''),
    tagsJson: realmTagKeys(realm.tags ?? []),
  };
}

function favoriteMetadata(favorite: 0 | 1) {
  return favorite ? { favorite: true as const } : {};
}

function readRow({ id, revision, createdAt, updatedAt, documentJson, favorite }: Row): SavedRealm {
  return { id, revision, createdAt, updatedAt, ...favoriteMetadata(favorite), realm: JSON.parse(documentJson) as Realm };
}

function addFilterOption(options: Map<string, string>, raw: string) {
  const label = raw.trim();
  const value = realmFilterKey(label);
  if (value && !options.has(value)) options.set(value, label);
}

function sortedOptions(options: Map<string, string>): RealmFilterOption[] {
  return Array.from(options, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function createRealmStore(db: Database) {
  const lists = new Map(realmSorts.map((sort) => [sort, db.query<SummaryRow, [...FilterArgs, number, number]>(`
    SELECT id, title, excerpt, created_at AS createdAt, updated_at AS updatedAt, favorite,
      json_extract(document_json, '$.tags') AS tagsJson,
      json_type(document_json, '$.avatar') IS NOT NULL AS hasAvatar,
      coalesce(json_array_length(document_json, '$.characters'), 0) AS characters,
      coalesce(json_array_length(document_json, '$.starts'), 0) AS starts
    FROM realms WHERE ${filter} ORDER BY ${ordering[sort]} LIMIT ?7 OFFSET ?8
  `)]));
  const count = db.query<{ total: number }, FilterArgs>(`SELECT count(*) AS total FROM realms WHERE ${filter}`);
  const filterSources = db.query<{ author: string | null; tagsJson: string | null }, [number]>(`
    SELECT json_extract(document_json, '$.author') AS author, json_extract(document_json, '$.tags') AS tagsJson
    FROM realms WHERE user_id = ? AND (author_key <> '' OR tag_keys_json <> '[]') ORDER BY created_at, id
  `);
  const find = db.query<Row, [number, string]>(`SELECT ${rowFields} FROM realms WHERE user_id = ? AND id = ?`);
  const findAvatar = db.query<{ avatar: string | null }, [number, string]>(`
    SELECT json_extract(document_json, '$.avatar') AS avatar FROM realms WHERE user_id = ? AND id = ?
  `);
  const findDocument = db.query<Row, [number, string]>(`SELECT ${rowFields} FROM realms WHERE user_id = ? AND document_id = ?`);
  const insert = db.query(`
    INSERT INTO realms (id, user_id, document_id, title, title_key, excerpt, search_text, author_key, tag_keys_json,
      created_at, updated_at, revision, document_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  const update = db.query(`
    UPDATE realms SET title = ?, title_key = ?, excerpt = ?, search_text = ?, author_key = ?, tag_keys_json = ?,
      updated_at = ?, revision = revision + 1, document_json = ?
    WHERE user_id = ? AND id = ?
  `);
  const remove = db.query('DELETE FROM realms WHERE user_id = ? AND id = ?');
  const updateFavorite = db.query<{ id: string; favorite: 0 | 1 }, [number, number, string]>(`
    UPDATE realms SET favorite = ? WHERE user_id = ? AND id = ? RETURNING id, favorite
  `);

  const list = db.transaction((userId: number, { q, sort, limit, offset, filters }: RealmListQuery) => {
    const args: FilterArgs = [userId, realmSearchKey(q), realmFilterKey(filters.author), realmTagKeys(filters.tags),
      filters.starts, Number(filters.favorites)];
    const items: RealmSummary[] = lists.get(sort)!.all(...args, limit, offset).map(({ hasAvatar, favorite, tagsJson, ...row }) => {
      const tags = tagsJson ? JSON.parse(tagsJson) as string[] : [];
      return { ...row, ...(tags.length ? { tags } : {}), ...(hasAvatar ? { hasAvatar: true } : {}), ...favoriteMetadata(favorite) };
    });
    return { items, total: count.get(...args)!.total };
  });

  const create = db.transaction((userId: number, realm: Realm) => {
    const documentJson = JSON.stringify(realm);
    const existing = findDocument.get(userId, realm.id);
    if (existing) return existing.documentJson === documentJson ? { saved: readRow(existing), created: false } : 'duplicate';
    const id = randomUUID();
    const now = Date.now();
    const { titleKey, excerpt, searchText, authorKey, tagsJson } = indexRealm(realm);
    insert.run(id, userId, realm.id, realm.title, titleKey, excerpt, searchText, authorKey, tagsJson, now, now, documentJson);
    return { saved: { id, createdAt: now, updatedAt: now, revision: 0, realm }, created: true };
  });

  const save = db.transaction((userId: number, id: string, { revision, realm }: UpdateRealm) => {
    const row = find.get(userId, id);
    if (!row) return 'missing';
    const documentJson = JSON.stringify(realm);
    if (row.documentJson === documentJson && (row.revision === revision || row.revision === revision + 1)) return readRow(row);
    if (row.revision !== revision) return 'conflict';
    if (row.documentId !== realm.id) return 'identity';
    const { titleKey, excerpt, searchText, authorKey, tagsJson } = indexRealm(realm);
    const updatedAt = Math.max(Date.now(), row.updatedAt + 1);
    update.run(realm.title, titleKey, excerpt, searchText, authorKey, tagsJson, updatedAt, documentJson, userId, id);
    return { id, createdAt: row.createdAt, updatedAt, revision: revision + 1, ...favoriteMetadata(row.favorite), realm };
  });

  const deleteRealm = db.transaction((userId: number, id: string, revision?: number) => {
    if (revision !== undefined) {
      const row = find.get(userId, id);
      if (!row) return 'missing';
      if (row.revision !== revision) return 'conflict';
    }
    return remove.run(userId, id).changes ? 'deleted' : 'missing';
  });

  return {
    list: list.deferred,
    filters(userId: number): RealmFilterOptions {
      const authors = new Map<string, string>();
      const tags = new Map<string, string>();
      for (const { author, tagsJson } of filterSources.iterate(userId)) {
        if (author) addFilterOption(authors, author);
        if (tagsJson) for (const tag of JSON.parse(tagsJson) as string[]) addFilterOption(tags, tag);
      }
      return { authors: sortedOptions(authors), tags: sortedOptions(tags) };
    },
    setFavorite(userId: number, id: string, favorite: boolean) {
      const row = updateFavorite.get(Number(favorite), userId, id);
      return row && { id: row.id, favorite: Boolean(row.favorite) };
    },
    avatar: (userId: number, id: string) => findAvatar.get(userId, id)?.avatar,
    find(userId: number, id: string) {
      const row = find.get(userId, id);
      return row && readRow(row);
    },
    create: create.immediate,
    save: save.immediate,
    delete: deleteRealm.immediate,
  };
}
