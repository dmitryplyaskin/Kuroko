import { realmSearchKey, realmSorts, type Realm, type RealmListQuery, type RealmSort, type RealmSummary, type SavedRealm, type UpdateRealm } from '@kuroko/contracts/realms';
import type { Database } from 'bun:sqlite';
import { randomUUID } from 'node:crypto';

type Row = Omit<SavedRealm, 'realm'> & { documentId: string; documentJson: string };
type SummaryRow = Omit<RealmSummary, 'hasAvatar'> & { hasAvatar: 0 | 1 };

const rowFields = 'id, revision, created_at AS createdAt, updated_at AS updatedAt, document_id AS documentId, document_json AS documentJson';
const filter = "user_id = ?1 AND (?2 = '' OR instr(search_text, ?2) > 0)";
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
  };
}

function readRow({ id, revision, createdAt, updatedAt, documentJson }: Row): SavedRealm {
  return { id, revision, createdAt, updatedAt, realm: JSON.parse(documentJson) as Realm };
}

export function createRealmStore(db: Database) {
  const lists = new Map(realmSorts.map((sort) => [sort, db.query<SummaryRow, [number, string, number, number]>(`
    SELECT id, title, excerpt, created_at AS createdAt, updated_at AS updatedAt,
      json_type(document_json, '$.avatar') IS NOT NULL AS hasAvatar,
      coalesce(json_array_length(document_json, '$.characters'), 0) AS characters,
      coalesce(json_array_length(document_json, '$.starts'), 0) AS starts
    FROM realms WHERE ${filter} ORDER BY ${ordering[sort]} LIMIT ?3 OFFSET ?4
  `)]));
  const count = db.query<{ total: number }, [number, string]>(`SELECT count(*) AS total FROM realms WHERE ${filter}`);
  const find = db.query<Row, [number, string]>(`SELECT ${rowFields} FROM realms WHERE user_id = ? AND id = ?`);
  const findAvatar = db.query<{ avatar: string | null }, [number, string]>(`
    SELECT json_extract(document_json, '$.avatar') AS avatar FROM realms WHERE user_id = ? AND id = ?
  `);
  const findDocument = db.query<Row, [number, string]>(`SELECT ${rowFields} FROM realms WHERE user_id = ? AND document_id = ?`);
  const insert = db.query(`
    INSERT INTO realms (id, user_id, document_id, title, title_key, excerpt, search_text, created_at, updated_at, revision, document_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `);
  const update = db.query(`
    UPDATE realms SET title = ?, title_key = ?, excerpt = ?, search_text = ?, updated_at = ?, revision = revision + 1, document_json = ?
    WHERE user_id = ? AND id = ?
  `);
  const remove = db.query('DELETE FROM realms WHERE user_id = ? AND id = ?');

  const list = db.transaction((userId: number, { q, sort, limit, offset }: RealmListQuery) => {
    const query = realmSearchKey(q);
    const items: RealmSummary[] = lists.get(sort)!.all(userId, query, limit, offset).map(({ hasAvatar, ...row }) =>
      hasAvatar ? { ...row, hasAvatar: true } : row);
    return { items, total: count.get(userId, query)!.total };
  });

  const create = db.transaction((userId: number, realm: Realm) => {
    const documentJson = JSON.stringify(realm);
    const existing = findDocument.get(userId, realm.id);
    if (existing) return existing.documentJson === documentJson ? { saved: readRow(existing), created: false } : 'duplicate';
    const id = randomUUID();
    const now = Date.now();
    const { titleKey, excerpt, searchText } = indexRealm(realm);
    insert.run(id, userId, realm.id, realm.title, titleKey, excerpt, searchText, now, now, documentJson);
    return { saved: { id, createdAt: now, updatedAt: now, revision: 0, realm }, created: true };
  });

  const save = db.transaction((userId: number, id: string, { revision, realm }: UpdateRealm) => {
    const row = find.get(userId, id);
    if (!row) return 'missing';
    const documentJson = JSON.stringify(realm);
    if (row.documentJson === documentJson && (row.revision === revision || row.revision === revision + 1)) return readRow(row);
    if (row.revision !== revision) return 'conflict';
    if (row.documentId !== realm.id) return 'identity';
    const { titleKey, excerpt, searchText } = indexRealm(realm);
    const updatedAt = Math.max(Date.now(), row.updatedAt + 1);
    update.run(realm.title, titleKey, excerpt, searchText, updatedAt, documentJson, userId, id);
    return { id, createdAt: row.createdAt, updatedAt, revision: revision + 1, realm };
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
