import {
  personaPageSize, type PersonaDraft, type PersonaForPrompt, type PersonaIdentity, type PersonaListQuery, type PersonaSelectionResult,
  type PersonaSummary, type SavedPersona,
} from '@kuroko/contracts/personas';
import type { Database } from 'bun:sqlite';

type PersonaRow = Omit<SavedPersona, 'avatar' | 'variables'> & { avatar: string | null; variablesJson: string };
type SummaryRow = Omit<PersonaSummary, 'favorite' | 'hasAvatar'> & { favorite: number; hasAvatar: number };
const fields = 'id, revision, name, description, avatar, variables_json AS variablesJson, created_at AS createdAt, updated_at AS updatedAt';
const order = { updated: 'updated_at DESC', created: 'created_at DESC', 'name-asc': 'name_key ASC', 'name-desc': 'name_key DESC' };

function readRow({ avatar, variablesJson, ...row }: PersonaRow): SavedPersona {
  return { ...row, avatar: avatar ?? undefined, variables: JSON.parse(variablesJson) };
}

function searchKey(value: string) {
  return value.normalize('NFKC').toLowerCase();
}

function content(draft: PersonaDraft) {
  return {
    $name: draft.name, $nameKey: searchKey(draft.name), $description: draft.description, $descriptionKey: searchKey(draft.description),
    $avatar: draft.avatar ?? null, $variables: JSON.stringify(draft.variables),
  };
}

function unchanged(current: PersonaRow, draft: ReturnType<typeof content>) {
  return current.name === draft.$name && current.description === draft.$description &&
    current.avatar === draft.$avatar && current.variablesJson === draft.$variables;
}

export function createPersonaStore(db: Database) {
  const find = db.query<PersonaRow, [number, string]>(`SELECT ${fields} FROM personas WHERE user_id = ? AND id = ?`);
  const avatar = db.query<{ avatar: string | null }, [number, string]>('SELECT avatar FROM personas WHERE user_id = ? AND id = ?');
  const insert = db.query<PersonaRow, [ReturnType<typeof content> & { $userId: number; $id: string; $now: number }]>(`
    INSERT INTO personas (user_id, id, name, name_key, description, description_key, avatar, variables_json, created_at, updated_at)
    VALUES ($userId, $id, $name, $nameKey, $description, $descriptionKey, $avatar, $variables, $now, $now)
    ON CONFLICT(user_id, id) DO NOTHING RETURNING ${fields}
  `);
  const update = db.query<PersonaRow, [ReturnType<typeof content> & { $userId: number; $id: string; $now: number }]>(`
    UPDATE personas SET name = $name, name_key = $nameKey, description = $description, description_key = $descriptionKey,
      avatar = $avatar, variables_json = $variables, updated_at = $now, revision = revision + 1
    WHERE user_id = $userId AND id = $id RETURNING ${fields}
  `);
  const remove = db.query('DELETE FROM personas WHERE user_id = ? AND id = ? AND revision = ?');
  const favorite = db.query('UPDATE personas SET favorite = ? WHERE user_id = ? AND id = ?');
  const activeSource = `
    FROM active_personas AS a JOIN personas AS p ON p.user_id = a.user_id AND p.id = a.persona_id
    WHERE a.user_id = ?
  `;
  const activeIdentity = db.query<Omit<PersonaIdentity, 'hasAvatar'> & { hasAvatar: number }, [number]>(`
    SELECT p.id, p.name, p.revision, p.avatar IS NOT NULL AS hasAvatar ${activeSource}
  `);
  const activePersona = db.query<Omit<PersonaForPrompt, 'variables'> & { variablesJson: string }, [number]>(`
    SELECT p.id, p.name, p.description, p.variables_json AS variablesJson ${activeSource}
  `);
  const activate = db.query(`
    INSERT INTO active_personas (user_id, persona_id)
    SELECT user_id, id FROM personas WHERE user_id = ? AND id = ?
    ON CONFLICT(user_id) DO UPDATE SET persona_id = excluded.persona_id
  `);
  const clearActive = db.query('DELETE FROM active_personas WHERE user_id = ?');
  const where = `user_id = $userId AND ($q = '' OR instr(name_key, $q) > 0 OR instr(description_key, $q) > 0)
    AND ($favorites = 0 OR favorite = 1)
    AND ($variables = 'any' OR (variable_count > 0) = ($variables = 'with'))`;
  type Filters = { $userId: number; $q: string; $favorites: number; $variables: string };
  const count = db.query<{ total: number }, [Filters]>(`SELECT count(*) AS total FROM personas WHERE ${where}`);

  const list = db.transaction((userId: number, query: PersonaListQuery) => {
    const filters = { $userId: userId, $q: searchKey(query.q), $favorites: Number(query.favorites), $variables: query.variables };
    const { total } = count.get(filters)!;
    const offset = Math.min(query.offset, Math.floor(Math.max(0, total - 1) / personaPageSize) * personaPageSize);
    const rows = db.query<SummaryRow, [Filters & { $limit: number; $offset: number }]>(`
      SELECT id, name, revision, substr(description, 1, 200) AS excerpt, avatar IS NOT NULL AS hasAvatar,
        favorite, variable_count AS variableCount
      FROM personas WHERE ${where} ORDER BY ${order[query.sort]}, id LIMIT $limit OFFSET $offset
    `).all({ ...filters, $limit: personaPageSize, $offset: offset });
    return { total, offset, items: rows.map((row) => ({ ...row, favorite: Boolean(row.favorite), hasAvatar: Boolean(row.hasAvatar) })) };
  });

  const create = db.transaction((userId: number, id: string, draft: PersonaDraft) => {
    const data = content(draft);
    const inserted = insert.get({ ...data, $userId: userId, $id: id, $now: Date.now() });
    if (inserted) return { created: true, persona: readRow(inserted) };
    const current = find.get(userId, id)!;
    return unchanged(current, data) ? { created: false, persona: readRow(current) } : 'conflict';
  });

  const save = db.transaction((userId: number, id: string, revision: number, draft: PersonaDraft) => {
    const current = find.get(userId, id);
    if (!current) return 'missing';
    const data = content(draft);
    if (unchanged(current, data) && (revision === current.revision || revision + 1 === current.revision)) return readRow(current);
    if (revision !== current.revision) return 'conflict';
    return readRow(update.get({ ...data, $userId: userId, $id: id, $now: Date.now() })!);
  });

  const removeVersion = db.transaction((userId: number, id: string, revision: number) => {
    if (remove.run(userId, id, revision).changes) return 'deleted';
    return find.get(userId, id) ? 'conflict' : 'missing';
  });

  return {
    list,
    selection(userId: number): PersonaSelectionResult {
      const selected = activeIdentity.get(userId);
      return selected ? { ...selected, hasAvatar: Boolean(selected.hasAvatar) } : { id: null };
    },
    active(userId: number): PersonaForPrompt | undefined {
      const row = activePersona.get(userId);
      if (!row) return;
      const { variablesJson, ...persona } = row;
      return { ...persona, variables: JSON.parse(variablesJson) };
    },
    select(userId: number, id: string | null) {
      if (id !== null) return activate.run(userId, id).changes > 0;
      clearActive.run(userId);
      return true;
    },
    find(userId: number, id: string) {
      const row = find.get(userId, id);
      return row ? readRow(row) : undefined;
    },
    avatar: (userId: number, id: string) => avatar.get(userId, id)?.avatar,
    create: create.immediate,
    save: save.immediate,
    remove: removeVersion.immediate,
    setFavorite: (userId: number, id: string, value: boolean) => favorite.run(Number(value), userId, id).changes > 0,
  };
}
