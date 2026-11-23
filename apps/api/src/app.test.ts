import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AgentDraft, SavedAgent } from '@kuroko/contracts/agents';
import type { ChatActivityTurn, ChatMessage, ChatSnapshot, ChatToolCall, SavedChat } from '@kuroko/contracts/chat';
import { defaultChatSettings } from '@kuroko/contracts/chatSettings';
import { defaultConnectionSettings, type ConnectionState, type ProviderKey } from '@kuroko/contracts/connectionSettings';
import type { LlmRequest } from '@kuroko/contracts/llm';
import type { Realm, RealmList, SavedRealm } from '@kuroko/contracts/realms';
import type { DelegateTaskResult, ToolsResponse } from '@kuroko/contracts/tools';
import { createSubagentBatch, runToolCall, toolDeclarations } from '@kuroko/tool-runtime';
import { createApp } from './app';
import { openDatabase } from './storage/database';

let db: ReturnType<typeof openDatabase>;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const vaultKey = randomBytes(32);
  db = openDatabase(':memory:', vaultKey);
  server = createApp({ db, vaultKey, secureCookie: true }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server failed to bind to a TCP port');
  }
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});

type RequestOptions = { method?: string; body?: object; cookie?: string; account?: number; withHeader?: boolean; signal?: AbortSignal };

function request(path: string, { method = 'GET', body, cookie, account, withHeader = true, signal }: RequestOptions = {}) {
  const headers = new Headers();
  if (method !== 'GET' && withHeader) headers.set('X-Kuroko-Request', '1');
  if (body) headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  if (account !== undefined) headers.set('X-Kuroko-Account', String(account));
  return fetch(`${baseUrl}${path}`, { method, headers, body: body && JSON.stringify(body), signal });
}

const password = 'example-long-passphrase';

function register(username: string) {
  return request('/auth/register', { method: 'POST', body: { username, password } });
}

function login(username: string, remember = false, cookie?: string) {
  return request('/auth/login', { method: 'POST', cookie, body: { username, password, remember } });
}

function sessionCookie(response: Response) {
  const cookie = response.headers.get('Set-Cookie');
  if (!cookie) throw new Error('Expected session cookie');
  return { header: cookie, token: cookie.split(';', 1)[0]! };
}

test('validates, searches, sorts and edits private realms without overwriting newer revisions', async () => {
  await register('realm-owner');
  await register('realm-other');
  const cookie = sessionCookie(await login('realm-owner')).token;
  const other = sessionCookie(await login('realm-other')).token;
  const path = '/realms';
  const realm: Realm = {
    specVersion: '0.1.0', id: 'последний поезд / night', title: 'Последний поезд', base: 'Ночная станция',
    characters: [{ id: 'lina', title: 'Лина', content: 'Пассажирка' }],
    lorebook: [{ id: 'delay', title: 'Задержка', content: 'Сигнал пропал на 100%' }],
    sections: [{ id: 'locations', title: 'Локации', entries: [{ id: 'pier', title: 'Причал', content: 'Старая пристань' }] }],
    starts: [{ id: 'platform', title: 'На платформе', greeting: 'Вы ждёте поезд?', characterIds: ['lina'],
      loreEntryIds: ['delay'], sectionEntries: [{ sectionId: 'locations', entryId: 'pier' }] }],
  };
  const create = (body: object, owner = cookie) => request(path, { method: 'POST', cookie: owner, body });
  const list = async (query: Record<string, string> = {}, owner = cookie) => {
    const result = await request(`${path}?${new URLSearchParams(query)}`, { cookie: owner });
    expect(result.status).toBe(200);
    return await result.json() as RealmList;
  };

  expect((await request(path)).status).toBe(401);
  expect(await (await create({ ...realm, sections: [] })).json()).toEqual({ code: 'realm_reference_missing', field: '/starts/0/sectionEntries/0' });
  expect(await (await create({ ...realm, characters: [...realm.characters!, ...realm.characters!] })).json()).toEqual({
    code: 'realm_duplicate_id', field: '/characters/1/id',
  });
  expect(await (await create({ ...realm, starts: [{ id: 'empty', title: 'Пустой старт' }] })).json()).toEqual({ code: 'realm_invalid', field: '/starts/0' });
  const created = await create(realm);
  expect(created.status).toBe(201);
  const saved = await created.json() as SavedRealm;
  const itemPath = `${path}/${saved.id}`;
  expect(created.headers.get('location')).toBe(`/api${itemPath}`);
  expect(saved.realm).toEqual(realm);
  expect(await (await create(realm)).json()).toEqual(saved);
  expect((await create({ ...realm, title: 'Повтор' })).status).toBe(409);
  expect((await create({ specVersion: '0.1.0', id: 'archive', title: 'архив', base: 'Подземелье' })).status).toBe(201);

  const page = await list({ sort: 'title-asc', limit: '1', offset: '1' });
  expect(page.total).toBe(2);
  expect(page.items).toEqual([{ id: saved.id, title: realm.title, excerpt: realm.base, starts: 1, characters: 1,
    createdAt: saved.createdAt, updatedAt: saved.updatedAt }]);
  expect((await list({ sort: 'title-desc' })).items.map(({ title }) => title)).toEqual([realm.title, 'архив']);
  expect((await list({ q: 'СТАРАЯ ПРИСТАНЬ' })).items.map(({ id }) => id)).toEqual([saved.id]);
  expect((await list({ q: '100%' })).total).toBe(1);
  expect((await list({ q: '101%' })).total).toBe(0);
  expect((await request(`${path}?sort=unknown`, { cookie })).status).toBe(400);
  expect((await request(`${path}?limit=0`, { cookie })).status).toBe(400);
  expect(await list({}, other)).toEqual({ items: [], total: 0 });
  expect((await request(itemPath, { cookie: other })).status).toBe(404);
  expect((await request(itemPath, { method: 'DELETE', cookie: other })).status).toBe(404);

  const put = (body: { revision: number; realm: Realm }, owner = cookie) => request(itemPath, { method: 'PUT', cookie: owner, body });
  const update = { revision: saved.revision, realm: { ...realm, title: 'Ночная станция', lorebook: [], starts: [] } };
  expect((await put(update, other)).status).toBe(404);
  expect((await put({ ...update, realm: { ...update.realm, id: 'new-id' } })).status).toBe(400);
  const updated = await (await put(update)).json() as SavedRealm;
  expect(updated.revision).toBe(saved.revision + 1);
  expect(await (await put(update)).json()).toEqual(updated);
  expect((await put({ ...update, realm })).status).toBe(409);
  expect(await (await request(itemPath, { cookie })).json()).toEqual(updated);
  expect((await list({ q: '100%' })).total).toBe(0);
  expect((await request(`${itemPath}?revision=${saved.revision}`, { method: 'DELETE', cookie })).status).toBe(409);
  expect((await request(`${itemPath}?revision=${updated.revision}`, { method: 'DELETE', cookie })).status).toBe(204);
  expect((await request(itemPath, { cookie })).status).toBe(404);
  expect((await list()).total).toBe(1);
});

test('stores realm metadata and avatars and serves the library image only to its owner', async () => {
  await register('avatar-owner');
  await register('avatar-other');
  const cookie = sessionCookie(await login('avatar-owner')).token;
  const other = sessionCookie(await login('avatar-other')).token;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmXsAAAAASUVORK5CYII=';
  const avatar = `data:image/png;base64,${png}`;
  const realm: Realm = {
    specVersion: '0.1.0', id: 'islands', title: 'Острова', base: 'Штормы и маяки',
    description: 'История островов', author: 'Мира', version: '2.0', authorNotes: 'Черновик путеводителя', tags: ['Навигация'], avatar,
    characters: [{ id: 'keeper', title: 'Аркадий', content: 'Работает по ночам', summary: 'Смотритель сигнальной башни', avatar }],
  };
  const create = (body: Realm) => request('/realms', { method: 'POST', cookie, body });
  const invalid = await create({ ...realm, avatar: `data:image/jpeg;base64,${png}` });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({ code: 'realm_invalid', field: '/avatar' });
  const created = await create(realm);
  expect(created.status).toBe(201);
  const saved = await created.json() as SavedRealm;
  const path = `/realms/${saved.id}`;
  expect(await (await request(path, { cookie })).json()).toEqual(saved);
  for (const q of ['НАВИГАЦИЯ', 'Сигнальной башни', 'Мира']) {
    const list = await request(`/realms?${new URLSearchParams({ q })}`, { cookie });
    expect(await list.json()).toEqual({ items: [{
      id: saved.id, title: realm.title, excerpt: realm.description, createdAt: saved.createdAt, updatedAt: saved.updatedAt,
      characters: 1, starts: 0, hasAvatar: true, tags: ['Навигация'],
    }], total: 1 });
  }
  const image = await request(`${path}/avatar`, { cookie });
  expect(image.headers.get('content-type')).toBe('image/png');
  expect(Buffer.from(await image.arrayBuffer())).toEqual(Buffer.from(png, 'base64'));
  expect((await request(`${path}/avatar`, { cookie: other })).status).toBe(404);
  const removed = await request(path, { method: 'PUT', cookie, body: { revision: saved.revision, realm: { ...realm, avatar: undefined } } });
  expect(removed.status).toBe(200);
  expect((await request(`${path}/avatar`, { cookie })).status).toBe(404);
});

test('combines realm filters and keeps favorites separate from the card revision', async () => {
  await register('filters-owner');
  await register('filters-other');
  const cookie = sessionCookie(await login('filters-owner')).token;
  const other = sessionCookie(await login('filters-other')).token;
  const create = async (card: Partial<Realm> & Pick<Realm, 'id' | 'title'>, owner = cookie) => {
    const response = await request('/realms', { method: 'POST', cookie: owner, body: { specVersion: '0.1.0', base: 'Море', ...card } });
    expect(response.status).toBe(201);
    return await response.json() as SavedRealm;
  };
  const island = await create({ id: 'island', title: 'Маяк', author: ' Лина ', tags: ['Море', 'Туман'], starts: [
    { id: 'storm', title: 'Шторм', greeting: 'Волны бьют о берег' },
  ] });
  await create({ id: 'crossing', title: 'Архипелаг', author: 'лина', tags: ['море'] });
  await create({ id: 'port', title: 'Порт', author: 'Даня', tags: ['МОРЕ', 'туман'] });
  await create({ id: 'private', title: 'Чужой мир', author: 'Другой', tags: ['Чужой тег'] }, other);

  const list = async (query: string) => await (await request(`/realms?${query}`, { cookie })).json() as RealmList;
  const titles = async (query: string) => (await list(query)).items.map(({ title }) => title);
  const query = (pairs: [string, string][]) => new URLSearchParams(pairs).toString();
  expect(await titles(query([['sort', 'title-asc'], ['tag', 'мОре']]))).toEqual(['Архипелаг', 'Маяк', 'Порт']);
  expect(await titles(query([['tag', 'МОРЕ'], ['tag', 'ТУМАН'], ['starts', 'without']]))).toEqual(['Порт']);
  expect(await titles(query([['author', 'ЛИНА'], ['tag', ' море '], ['starts', 'with'], ['q', 'шторм']]))).toEqual(['Маяк']);
  expect((await list(query([['tag', 'Туман'], ['limit', '1'], ['offset', '1']]))).total).toBe(2);
  expect((await request('/realms?starts=invalid', { cookie })).status).toBe(400);
  const filters = await (await request('/realms/filters', { cookie })).json() as { tags: { value: string }[]; authors: { value: string }[] };
  expect(filters.tags.map(({ value }) => value)).toEqual(['море', 'туман']);
  expect(filters.authors.map(({ value }) => value)).toEqual(['даня', 'лина']);

  const favorite = (value: unknown, owner = cookie) => request(`/realms/${island.id}/favorite`, {
    method: 'PUT', cookie: owner, body: { favorite: value },
  });
  expect((await favorite(true, other)).status).toBe(404);
  expect((await favorite('true')).status).toBe(400);
  expect(await titles('favorites=1')).toEqual([]);
  expect(await (await favorite(true)).json()).toEqual({ id: island.id, favorite: true });
  expect(await titles('favorites=1&starts=with')).toEqual(['Маяк']);
  expect((await list('favorites=1')).items[0]?.favorite).toBe(true);
  const saved = await (await request(`/realms/${island.id}`, { cookie })).json();
  expect(saved).toEqual({ ...island, favorite: true });
  const edited = await request(`/realms/${island.id}`, { method: 'PUT', cookie, body: {
    revision: island.revision, realm: { ...island.realm, tags: ['Ветер'] },
  } });
  expect(edited.status).toBe(200);
  expect(await edited.json()).toMatchObject({ favorite: true, revision: 1 });
  expect((await list('favorites=1')).items[0]?.tags).toEqual(['Ветер']);
  expect(await titles(query([['favorites', '1'], ['tag', 'ветер']]))).toEqual(['Маяк']);
  expect(await titles(query([['favorites', '1'], ['tag', 'море']]))).toEqual([]);
  expect(await (await favorite(false)).json()).toEqual({ id: island.id, favorite: false });
  expect(await titles('favorites=1')).toEqual([]);
});

test('resolves only the selected context entries in global order across realm sections', async () => {
  await register('context-owner');
  const cookie = sessionCookie(await login('context-owner')).token;
  const realm: Realm = {
    specVersion: '0.1.0', id: 'context-card', title: 'Маяк', base: 'Остров',
    characters: [{ id: 'keeper', title: 'Смотритель', content: 'Смотрит на море' },
      { id: 'guest', title: 'Гость', content: 'Только что прибыл', order: 3 }],
    lorebook: [{ id: 'secret', title: 'Секрет', content: 'Закрытая комната', order: 1 },
      { id: 'bells', title: 'Звонки', content: 'Дважды в полночь', order: 3 }],
    sections: [{ id: 'locations', title: 'Локации', entries: [{ id: 'shore', title: 'Берег', content: 'Песок', order: 2 }] }],
    starts: [{ id: 'arrive', title: 'Приезд', scenario: 'Ночь', characterIds: ['guest', 'keeper'], loreEntryIds: ['bells'],
      sectionEntries: [{ sectionId: 'locations', entryId: 'shore' }] }],
  };
  const created = await request('/realms', { method: 'POST', cookie, body: realm });
  expect(created.status).toBe(201);
  const saved = await created.json() as SavedRealm;
  const path = `/realms/${saved.id}`;
  expect(await (await request(`${path}/context`, { cookie })).json()).toEqual({ base: realm.base, entries: [] });
  expect((await request(`${path}/context?start=missing`, { cookie })).status).toBe(404);

  const context = async () => (await (await request(`${path}/context?start=arrive`, { cookie })).json()) as {
    scenario: string; entries: { id: string; order: number }[];
  };
  const before = await context();
  expect(before.scenario).toBe('Ночь');
  expect(before.entries.map(({ id, order }) => [id, order])).toEqual([['keeper', 1], ['shore', 2], ['guest', 3], ['bells', 3]]);

  const updateLoreOrder = (order: number) => request(path, { method: 'PUT', cookie, body: {
    revision: saved.revision, realm: { ...realm, lorebook: realm.lorebook?.map((entry) => entry.id === 'bells' ? { ...entry, order } : entry) },
  } });
  expect((await updateLoreOrder(0)).status).toBe(400);
  expect((await updateLoreOrder(1)).status).toBe(200);
  expect((await context()).entries.map(({ id }) => id)).toEqual(['keeper', 'bells', 'shore', 'guest']);
});

test('persists independently enabled tools for the signed-in account', async () => {
  await register('tools-owner');
  await register('tools-other');
  const cookie = sessionCookie(await login('tools-owner')).token;
  const other = sessionCookie(await login('tools-other')).token;
  const path = '/settings/tools';
  const set = (id: string, enabled: unknown) => request(`${path}/${id}`, { method: 'PUT', cookie, body: { enabled } });

  expect((await request(path)).status).toBe(401);
  expect(await (await request(path, { cookie })).json()).toEqual({ enabled: [] });
  expect((await set('unknown', true)).status).toBe(400);
  expect((await set('roll_dice', 'true')).status).toBe(400);
  expect(await (await set('roll_dice', true)).json()).toEqual({ enabled: ['roll_dice'] });
  expect(await (await set('test_echo', true)).json()).toEqual({ enabled: ['roll_dice', 'test_echo'] });
  expect(await (await set('roll_dice', false)).json()).toEqual({ enabled: ['test_echo'] });
  expect(await (await request(path, { cookie })).json()).toEqual({ enabled: ['test_echo'] });
  expect(await (await set('resolveCheck', true)).json()).toEqual({ enabled: ['resolveCheck', 'test_echo'] });
  expect(await (await set('getRollDetails', true)).json()).toEqual({ enabled: ['getRollDetails', 'resolveCheck', 'test_echo'] });
  expect(await (await request(path, { cookie: other })).json()).toEqual({ enabled: [] });
});

test('manages private tool presets and applies or clears enabled tools as a whole', async () => {
  await register('presets-owner');
  await register('presets-other');
  const cookie = sessionCookie(await login('presets-owner')).token;
  const other = sessionCookie(await login('presets-other')).token;
  const path = '/settings/tools';
  const create = (name: string, enabled: unknown, owner = cookie) => request(`${path}/presets`, {
    method: 'POST', cookie: owner, body: { name, enabled },
  });
  const clear = () => request(`${path}/enabled`, { method: 'DELETE', cookie });

  expect((await create(' ', [])).status).toBe(400);
  expect((await create('Unknown', ['unknown'])).status).toBe(400);
  expect((await create('Duplicate', ['roll_dice', 'roll_dice'])).status).toBe(400);
  const result = await create('  Проверки  ', ['roll_dice', 'resolveCheck']);
  expect(result.status).toBe(201);
  const state = await result.json() as ToolsResponse;
  const preset = state.presets![0]!;
  expect(state).toEqual({ enabled: [], presets: [{ id: preset.id, name: 'Проверки', enabled: ['roll_dice', 'resolveCheck'] }] });
  expect((await create('Проверки', [])).status).toBe(409);
  expect((await create('Проверки', [], other)).status).toBe(201);
  const presetPath = `${path}/presets/${preset.id}`;
  const apply = (owner = cookie) => request(`${presetPath}/apply`, { method: 'PUT', cookie: owner });
  const rename = (name: string, owner = cookie) => request(`${presetPath}/rename`, { method: 'PUT', cookie: owner, body: { name } });
  const copy = (name: string, owner = cookie) => request(`${presetPath}/copy`, { method: 'POST', cookie: owner, body: { name } });
  const update = (enabled: string[], owner = cookie) => request(presetPath, { method: 'PUT', cookie: owner, body: { enabled } });
  expect((await apply(other)).status).toBe(404);
  expect((await rename('Подмена', other)).status).toBe(404);
  expect((await copy('Копия', other)).status).toBe(404);
  expect((await update([], other)).status).toBe(404);
  expect((await request(presetPath, { method: 'DELETE', cookie: other })).status).toBe(404);
  await request(`${path}/test_echo`, { method: 'PUT', cookie, body: { enabled: true } });
  const active = { ...state, activePresetId: preset.id };
  expect(await (await apply()).json()).toEqual({ ...active, enabled: ['resolveCheck', 'roll_dice'] });
  expect(await (await clear()).json()).toEqual(active);
  expect(await (await clear()).json()).toEqual(active);
  expect(await (await request(path, { cookie })).json()).toEqual(active);

  const copied = await copy('Копия');
  expect(copied.status).toBe(201);
  const copiedState = await copied.json() as ToolsResponse;
  const duplicate = copiedState.presets!.find(({ name }) => name === 'Копия')!;
  expect(copiedState).toMatchObject({ activePresetId: preset.id, enabled: [] });
  expect(duplicate.enabled).toEqual(preset.enabled);
  expect((await rename('Копия')).status).toBe(409);
  expect((await copy('Копия')).status).toBe(409);
  expect(await (await rename('Новые проверки')).json()).toMatchObject({
    activePresetId: preset.id, enabled: [], presets: expect.arrayContaining([{ ...preset, name: 'Новые проверки' }, duplicate]),
  });
  expect(await (await update(['test_echo'])).json()).toMatchObject({
    activePresetId: preset.id, enabled: ['test_echo'],
    presets: expect.arrayContaining([{ ...preset, name: 'Новые проверки', enabled: ['test_echo'] }, duplicate]),
  });
  expect(await (await request(presetPath, { method: 'DELETE', cookie })).json()).toEqual({ enabled: ['test_echo'], presets: [duplicate] });
  expect((await apply()).status).toBe(404);
  const createdActive = await request(`${path}/presets`, { method: 'POST', cookie, body: { name: 'Активный', enabled: [], apply: true } });
  expect(createdActive.status).toBe(201);
  const { activePresetId, presets } = await createdActive.json() as ToolsResponse;
  expect(presets?.find(({ id }) => id === activePresetId)).toMatchObject({ name: 'Активный', enabled: [] });
});

test('stores chats by account and rejects stale writes without losing the saved history', async () => {
  await register('chat-owner');
  await register('chat-other');
  const cookie = sessionCookie(await login('chat-owner')).token;
  const other = sessionCookie(await login('chat-other')).token;
  const create = await request('/chats', { method: 'POST', cookie });
  expect(create.status).toBe(201);
  const first = await create.json() as SavedChat;
  const second = await (await request('/chats', { method: 'POST', cookie })).json() as SavedChat;
  const snapshot: ChatSnapshot = { revision: 0, messages: [
    { id: 1, role: 'user', text: 'Первая строка\nвторая строка', time: 1 },
    { id: 2, role: 'assistant', text: 'Ответ', reasoning: 'Сопоставляю варианты.', time: 2 },
    { id: 3, role: 'assistant', text: '🎲', time: 3, reasoningBlocks: [
      { text: 'Выбираю проверку.', textOffset: 0 },
      { text: 'Смотрю на результат.', textOffset: 2, afterToolCallId: 'dice-1' },
    ], toolCalls: [
      { id: 'dice-1', name: 'roll_dice', arguments: { rolls: { attack: 'd20' } },
        result: { rollId: 'dice-1', values: { attack: 13 }, details: [{ dice: [{ results: [13] }] }] },
        modelResult: { rollId: 'dice-1', values: { attack: 13 } }, textOffset: 2 },
    ] },
  ] };
  const path = `/chats/${first.id}`;
  const save = (cookie: string, body = snapshot) => request(path, { method: 'PUT', cookie, body });
  expect((await request(path, { cookie: other })).status).toBe(404);
  expect((await save(other)).status).toBe(404);
  expect(await (await request('/chats', { cookie: other })).json()).toEqual([]);
  expect((await save(cookie, { ...snapshot, messages: [{ ...snapshot.messages[2]!, role: 'user' }] })).status).toBe(400);
  const splitEmoji = structuredClone(snapshot);
  splitEmoji.messages[2]!.toolCalls![0]!.textOffset = 1;
  expect((await save(cookie, splitEmoji)).status).toBe(400);
  const unknownCall = structuredClone(snapshot);
  unknownCall.messages[2]!.reasoningBlocks![1]!.afterToolCallId = 'other-call';
  expect((await save(cookie, unknownCall)).status).toBe(400);
  const stored = await (await save(cookie)).json() as SavedChat;
  expect(stored).toMatchObject({ revision: 1, title: 'Первая строка вторая строка', messages: snapshot.messages });
  expect(await (await save(cookie)).json()).toEqual(stored);
  expect((await save(cookie, { ...snapshot, messages: [] })).status).toBe(409);
  expect(await (await request(path, { cookie })).json()).toEqual(stored);
  expect(await (await request(`/chats/${second.id}`, { cookie })).json()).toEqual(second);
  expect(await (await request('/chats', { cookie })).json()).toContainEqual({ id: first.id, title: stored.title, updatedAt: stored.updatedAt });
  expect((await request('/auth/account', { method: 'DELETE', cookie, body: { username: 'chat-owner', currentPassword: password } })).status).toBe(204);
  expect(db.query('SELECT id FROM chats').all()).toEqual([]);
});

test('renames an owned chat independently of history and deletes its activity with the chat', async () => {
  await register('activity-owner');
  await register('activity-other');
  const cookie = sessionCookie(await login('activity-owner')).token;
  const other = sessionCookie(await login('activity-other')).token;
  const { id } = await (await request('/chats', { method: 'POST', cookie })).json() as SavedChat;
  const path = `/chats/${id}`;
  const rename = (cookie: string, title: string) => request(`${path}/title`, { method: 'PUT', cookie, body: { title } });
  const remove = (cookie: string) => request(path, { method: 'DELETE', cookie });
  const snapshot: ChatSnapshot = {
    revision: 0, messages: [{ id: 1, role: 'user', text: 'Первое сообщение', time: 1 }],
    activity: { promptId: 1, entries: [{ id: '1', kind: 'model', time: 2, status: 'failed', details: { error: 'timeout' } }] },
  };
  const save = (body = snapshot) => request(path, { method: 'PUT', cookie, body });

  expect((await rename(other, 'Чужой чат')).status).toBe(404);
  expect((await remove(other)).status).toBe(404);
  expect((await rename(cookie, ' '.repeat(10))).status).toBe(400);
  expect(await (await rename(cookie, '  Хроника  ')).json()).toMatchObject({ id, title: 'Хроника' });
  expect((await save({ ...snapshot, activity: { ...snapshot.activity!, promptId: 99 } })).status).toBe(400);
  const committed = await (await save()).json() as SavedChat;
  expect(committed).toMatchObject({ title: 'Хроника', revision: 1 });
  expect(await (await save()).json()).toEqual(committed);
  expect(await (await request(path, { cookie })).json()).toEqual({ ...committed, activity: [snapshot.activity] });
  expect(await (await request('/chats', { cookie })).json()).toMatchObject([{ id, title: 'Хроника' }]);

  expect((await remove(cookie)).status).toBe(204);
  expect((await request(path, { cookie })).status).toBe(404);
  expect(db.query('SELECT * FROM chat_activity').all()).toEqual([]);
});

test('registers, issues a revocable session and persists it only with auto-login', async () => {
  const registration = await register('Алиса');
  expect(registration.status).toBe(201);
  expect(registration.headers.get('Set-Cookie')).toBeNull();
  const duplicate = await register('АЛИСА');
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ code: 'username_taken', field: 'username' });
  const account = db.query<{ password_hash: string }, []>('SELECT password_hash FROM users').get();
  expect(account?.password_hash).toStartWith('$argon2id$');
  const guest = await request('/auth/session');
  expect(guest.status).toBe(401);
  expect(await guest.json()).toEqual({ code: 'auth_required' });
  expect((await request('/auth/login', { method: 'POST', body: { username: 'Алиса', password: 'wrong password' } })).status).toBe(401);
  expect((await request('/auth/login', {
    method: 'POST', withHeader: false, body: { username: 'Алиса', password },
  })).status).toBe(403);

  const ordinary = sessionCookie(await login('алиса'));
  expect(ordinary.header).toContain('__Host-kuroko_session=');
  expect(ordinary.header).toContain('Secure');
  expect(ordinary.header).toContain('HttpOnly');
  expect(ordinary.header).toContain('SameSite=Strict');
  expect(ordinary.header).not.toContain('Max-Age');
  expect((await request('/auth/session', { cookie: ordinary.token })).status).toBe(200);

  const remembered = sessionCookie(await login('алиса', true, ordinary.token));
  expect(remembered.header).toContain('Max-Age=2592000');
  expect((await request('/auth/session', { cookie: ordinary.token })).status).toBe(401);
  expect((await request('/auth/session', { cookie: remembered.token })).status).toBe(200);

  const logout = await request('/auth/logout', { method: 'POST', cookie: remembered.token });
  expect(logout.status).toBe(204);
  expect(db.query('SELECT token_hash FROM sessions').all()).toEqual([]);
  expect((await request('/auth/session', { cookie: remembered.token })).status).toBe(401);
});

const connectionPath = '/settings/connection';

function addKey(cookie: string, provider: string, name: string, apiKey: string) {
  return request(`${connectionPath}/keys/${provider}`, { method: 'POST', cookie, body: { name, apiKey } });
}

test('stores provider keys encrypted and returns only metadata even to their owner', async () => {
  expect((await register('owner')).status).toBe(201);
  expect((await register('other')).status).toBe(201);
  const owner = await login('owner');
  expect(owner.status).toBe(200);
  const { id: account } = await owner.json() as { id: number };
  const ownerCookie = sessionCookie(owner).token;
  const otherCookie = sessionCookie(await login('other')).token;
  const apiKey = 'secret-api-key-for-test';
  const name = 'Основной ключ';
  const keysPath = `${connectionPath}/keys/openai`;

  expect((await request(keysPath, { method: 'POST', body: { name, apiKey } })).status).toBe(401);
  expect((await addKey(ownerCookie, 'openai', apiKey, apiKey)).status).toBe(400);
  const created = await addKey(ownerCookie, 'openai', name, apiKey);
  expect(created.status).toBe(201);
  expect(created.headers.get('Cache-Control')).toBe('no-store');
  const summary = await created.json() as ProviderKey;
  expect(summary).toEqual({ id: expect.any(String), name, provider: 'openai' });
  const stored = db.query<{ encrypted_value: Uint8Array }, []>('SELECT encrypted_value FROM secrets').get();
  expect(stored?.encrypted_value).toBeInstanceOf(Uint8Array);
  expect(Buffer.from(stored!.encrypted_value).includes(apiKey)).toBe(false);

  expect(await (await request(connectionPath, { cookie: ownerCookie })).json()).toEqual({ activePresetId: null, presets: [], keys: [summary] });
  expect(await (await request(connectionPath, { cookie: otherCookie })).json()).toEqual({ activePresetId: null, presets: [], keys: [] });
  expect((await request(connectionPath, { cookie: otherCookie, account })).status).toBe(401);
  expect((await request(`/secrets/${summary.id}`, { cookie: ownerCookie })).status).toBe(404);
  expect((await request(`${keysPath}/${summary.id}`, { cookie: ownerCookie })).status).toBe(404);
  expect((await request(`${keysPath}/${summary.id}`, { method: 'DELETE', cookie: otherCookie })).status).toBe(404);
  expect((await request(`${connectionPath}/keys/gemini/${summary.id}`, { method: 'DELETE', cookie: ownerCookie })).status).toBe(404);
  expect((await addKey(ownerCookie, 'openai', name, 'another-key')).status).toBe(409);
  expect((await addKey(ownerCookie, 'gemini', name, 'another-key')).status).toBe(201);
});

test('changes the password once, revokes all sessions and preserves the vault', async () => {
  expect((await register('owner')).status).toBe(201);
  const first = sessionCookie(await login('owner')).token;
  const second = sessionCookie(await login('owner', true)).token;
  const newPassword = 'replacement-passphrase';
  const body = { currentPassword: password, newPassword };
  const path = '/auth/password';
  expect((await addKey(first, 'openai', 'Saved key', 'test-vault-value')).status).toBe(201);
  expect((await request(path, { method: 'PUT', body })).status).toBe(401);
  expect((await request(path, { method: 'PUT', cookie: first, body: { ...body, newPassword: 'short' } })).status).toBe(400);
  const invalid = await request(path, { method: 'PUT', cookie: first, body: { ...body, currentPassword: 'wrong' } });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ field: 'currentPassword' });

  const responses = await Promise.all([first, second].map((cookie) => request(path, { method: 'PUT', cookie, body })));
  expect(responses.map(({ status }) => status).sort()).toEqual([204, 401]);
  expect(responses.find(({ status }) => status === 204)?.headers.get('set-cookie')).toContain('__Host-kuroko_session=;');
  expect((await request('/auth/session', { cookie: first })).status).toBe(401);
  expect((await request('/auth/session', { cookie: second })).status).toBe(401);
  expect((await login('owner')).status).toBe(401);

  const nextLogin = await request('/auth/login', { method: 'POST', body: { username: 'owner', password: newPassword } });
  expect(nextLogin.status).toBe(200);
  const list = await request(connectionPath, { cookie: sessionCookie(nextLogin).token });
  expect(await list.json()).toMatchObject({ keys: [{ id: expect.any(String), name: 'Saved key', provider: 'openai' }] });
});

test('validates chat settings and stores them for the signed-in account only', async () => {
  const path = '/settings/chat';
  const { id: account } = await (await register('owner')).json() as { id: number };
  expect((await register('other')).status).toBe(201);
  const owner = sessionCookie(await login('owner')).token;
  const other = sessionCookie(await login('other')).token;
  const settings = {
    fontSize: 20, width: 1088, userSide: 'left',
    colors: { light: { speech: '#891d39' }, dark: { text: '#DEDCF6', quote: '#d5abf8' } },
  };

  expect((await request(path)).status).toBe(401);
  expect((await request(path, { method: 'PUT', body: settings })).status).toBe(401);
  expect((await request(path, { method: 'PUT', cookie: owner, body: settings, withHeader: false })).status).toBe(403);
  expect((await request(path, { method: 'PUT', cookie: other, account, body: settings })).status).toBe(401);
  expect(await (await request(path, { cookie: owner })).json()).toEqual({ settings: null });

  const saved = await request(path, { method: 'PUT', cookie: owner, body: settings });
  expect(saved.status).toBe(200);
  const expected = { ...settings, colors: { ...settings.colors, dark: { ...settings.colors.dark, text: '#dedcf6' } } };
  expect(await saved.json()).toEqual({ settings: expected });

  for (const invalid of [
    { ...settings, fontSize: 27 }, { ...settings, width: 1087 }, { ...settings, userSide: 'center' },
    { ...settings, colors: { light: [], dark: {} } }, { ...settings, colors: { light: { speech: 'blue' }, dark: {} } },
  ]) {
    expect((await request(path, { method: 'PUT', cookie: owner, body: invalid })).status).toBe(400);
  }

  const secondSession = sessionCookie(await login('owner')).token;
  expect(await (await request(path, { cookie: secondSession })).json()).toEqual({ settings: expected });
  expect(await (await request(path, { cookie: other })).json()).toEqual({ settings: null });
  expect((await request(path, { method: 'PUT', cookie: secondSession, body: defaultChatSettings })).status).toBe(200);
  expect(await (await request(path, { cookie: owner })).json()).toEqual({ settings: defaultChatSettings });
});

test('manages and applies connection presets and unlinks a deleted key from all of them', async () => {
  const path = `${connectionPath}/presets`;
  await register('owner');
  await register('other');
  const cookie = sessionCookie(await login('owner')).token;
  const otherCookie = sessionCookie(await login('other')).token;
  const settings = { model: 'model-id', contextTokens: 32768, responseTokens: 2000, temperature: 0.7, topP: 0.95, topK: null };
  const apiKey = 'sk-example-key-for-test';
  const key = await (await addKey(cookie, 'openai', 'Основной', apiKey)).json() as { id: string };
  const body = { name: 'Длинная сцена', provider: 'openai', settings, keyId: key.id };
  expect((await request(path, { method: 'POST', body })).status).toBe(401);
  expect((await request(path, { method: 'POST', cookie, body: { ...body, settings: { ...settings, contextTokens: 3.5 } } })).status).toBe(400);
  expect((await request(path, { method: 'POST', cookie: otherCookie, body })).status).toBe(404);
  expect((await request(path, { method: 'POST', cookie, body: { ...body, provider: 'gemini' } })).status).toBe(404);

  const saved = await request(path, { method: 'POST', cookie, body });
  expect(saved.status).toBe(201);
  const payload = await saved.text();
  expect(payload).not.toContain(apiKey);
  const firstId = JSON.parse(payload).activePresetId as string;
  expect(JSON.parse(payload).presets).toEqual([{ ...settings, name: body.name, id: firstId, provider: 'openai', keyId: key.id }]);
  expect((await request(path, { method: 'POST', cookie, body })).status).toBe(409);

  const second = { ...body, name: 'Короткая сцена', settings: { ...settings, responseTokens: 500 } };
  const created = await request(path, { method: 'POST', cookie, body: second });
  expect(created.status).toBe(201);
  const { activePresetId: secondId } = await created.json() as { activePresetId: string };
  expect(secondId).not.toBe(firstId);
  const applyFirst = (owner = cookie) => request(`${path}/${firstId}/apply`, { method: 'PUT', cookie: owner });
  const renameFirst = (name: string, owner = cookie) =>
    request(`${path}/${firstId}/rename`, { method: 'PUT', cookie: owner, body: { name } });
  const copyFirst = (name: string, owner = cookie) =>
    request(`${path}/${firstId}/copy`, { method: 'POST', cookie: owner, body: { name } });
  expect((await applyFirst(otherCookie)).status).toBe(404);
  expect((await renameFirst('Подмена', otherCookie)).status).toBe(404);
  expect((await copyFirst('Копия', otherCookie)).status).toBe(404);
  expect((await renameFirst(second.name)).status).toBe(409);
  expect(await (await renameFirst('Переименованная сцена')).json()).toMatchObject({
    activePresetId: secondId, presets: expect.arrayContaining([
      expect.objectContaining({ id: firstId, name: 'Переименованная сцена', responseTokens: 2000 }),
    ]),
  });
  const copied = await copyFirst('Копия');
  expect(copied.status).toBe(201);
  const copiedState = await copied.json() as ConnectionState;
  expect(copiedState.activePresetId).toBe(secondId);
  expect(copiedState.presets.find(({ name }) => name === 'Копия')).toMatchObject({ ...settings, provider: 'openai', keyId: key.id });
  expect((await copyFirst('Копия')).status).toBe(409);
  expect(await (await applyFirst()).json()).toMatchObject({ activePresetId: firstId });
  expect(await (await request(connectionPath, { cookie })).json()).toMatchObject({ activePresetId: firstId });
  expect((await request(`${path}/${firstId}`, { method: 'PUT', cookie: otherCookie, body })).status).toBe(404);
  expect((await request(`${path}/${firstId}`, { method: 'DELETE', cookie: otherCookie })).status).toBe(404);
  const updated = await request(`${path}/${firstId}`, { method: 'PUT', cookie, body: { ...body, name: 'Обновлённая сцена' } });
  expect(await updated.json()).toMatchObject({ activePresetId: firstId, presets: expect.arrayContaining([
    expect.objectContaining({ id: firstId, name: 'Обновлённая сцена', responseTokens: 2000 }),
    expect.objectContaining({ id: secondId, name: second.name, responseTokens: 500 }),
  ]) });

  const unlinked = await request(`${connectionPath}/keys/openai/${key.id}`, { method: 'DELETE', cookie });
  expect(await unlinked.json()).toMatchObject({ activePresetId: firstId, keys: [], presets: expect.arrayContaining([
    expect.objectContaining({ id: firstId, keyId: null }), expect.objectContaining({ id: secondId, keyId: null }),
  ]) });
  expect(db.query('SELECT id FROM secrets').all()).toEqual([]);
  expect(await (await request(`${path}/${firstId}`, { method: 'DELETE', cookie })).json()).toMatchObject({
    activePresetId: null, presets: expect.arrayContaining([expect.objectContaining({ id: secondId })]),
  });
});

test('loads models with the selected provider’s stored key without echoing provider data that contains its value', async () => {
  await register('model-tester');
  const cookie = sessionCookie(await login('model-tester')).token;
  const modelsPath = '/settings/connection/models';
  const apiKey = 'api-key-for-catalog-test';
  const keyIds = new Map<string, string>();
  for (const provider of ['openai', 'openrouter', 'anthropic', 'gemini']) {
    const reply = await addKey(cookie, provider, 'Key for catalog', apiKey);
    expect(reply.status).toBe(201);
    const { id } = await reply.json() as ProviderKey;
    keyIds.set(provider, id);
  }
  const genuineFetch = fetch;
  const upstream: { url: URL; init?: RequestInit }[] = [];
  const mockFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    if (typeof input === 'string' && input.startsWith(baseUrl)) return genuineFetch(input, init);
    const url = new URL(String(input));
    upstream.push({ url, init });
    if (url.host === 'generativelanguage.googleapis.com') {
      const name = url.searchParams.has('pageToken') ? 'models/gemini-second' : 'models/gemini-first';
      const nextPageToken = url.searchParams.has('pageToken') ? undefined : 'page-2';
      return Promise.resolve(Response.json({ nextPageToken, models: [
        { name, supportedGenerationMethods: ['generateContent'], inputTokenLimit: 8192, outputTokenLimit: 2048 },
        { name: 'models/embedding-only', supportedGenerationMethods: ['embedContent'] },
      ] }));
    }
    if (url.host === 'api.anthropic.com') {
      const firstPage = !url.searchParams.has('after_id');
      const id = firstPage ? 'claude-first' : 'claude-second';
      return Promise.resolve(Response.json({
        data: [{ id, max_input_tokens: 8192, max_tokens: 2048 }], has_more: firstPage, last_id: id,
      }));
    }
    if (url.host === 'openrouter.ai') {
      return Promise.resolve(Response.json({ data: [{ id: 'author/model:free', context_length: 8192 }, { id: `echo-${apiKey}` }] }));
    }
    return Promise.resolve(Response.json({ error: `Provider included ${apiKey} in its error` }, { status: 401 }));
  };
  const mocked = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(mockFetch, { preconnect: genuineFetch.preconnect }));

  try {
    const catalog = (provider: string, keyId = keyIds.get(provider)) => request(modelsPath, { method: 'POST', cookie, body: { provider, keyId } });
    expect((await catalog('https://example.com')).status).toBe(400);
    expect((await catalog('openai', keyIds.get('gemini'))).status).toBe(404);
    expect((await request(modelsPath, { method: 'POST', cookie, body: { provider: 'openai', credential: { apiKey } } })).status).toBe(400);
    expect(await (await catalog('gemini')).json()).toEqual({ models: [
      { id: 'gemini-first', inputLimit: 8192, outputLimit: 2048 }, { id: 'gemini-second', inputLimit: 8192, outputLimit: 2048 },
    ] });
    expect(upstream[0]?.url.searchParams.has('key')).toBe(false);
    expect(new Headers(upstream[0]?.init?.headers).get('x-goog-api-key')).toBe(apiKey);
    expect(upstream[1]?.url.searchParams.get('pageToken')).toBe('page-2');
    expect(await (await catalog('anthropic')).json()).toEqual({ models: [
      { id: 'claude-first', inputLimit: 8192, outputLimit: 2048 }, { id: 'claude-second', inputLimit: 8192, outputLimit: 2048 },
    ] });
    expect(new Headers(upstream[2]?.init?.headers).get('x-api-key')).toBe(apiKey);
    expect(upstream[3]?.url.searchParams.get('after_id')).toBe('claude-first');
    expect(await (await catalog('openrouter')).json()).toEqual({ models: [{ id: 'author/model:free', contextLimit: 8192 }] });
    expect(upstream[4]?.url.pathname).toBe('/api/v1/models/user');
    expect(new Headers(upstream[4]?.init?.headers).get('Authorization')).toBe(`Bearer ${apiKey}`);
    const rejected = await catalog('openai');
    expect(rejected.status).toBe(422);
    expect(await rejected.text()).not.toContain(apiKey);
    expect(upstream.every(({ init }) => init?.redirect === 'error')).toBe(true);
    expect(db.query('SELECT id FROM secrets').all()).toHaveLength(4);
  } finally {
    mocked.mockRestore();
  }
});

const generatePath = '/llm/generate';
const greeting = [{ role: 'user', content: 'Привет' }] satisfies LlmRequest['messages'];

async function saveGenerationPreset(cookie: string, provider: string, apiKey: string, model = 'test-model') {
  const key = await (await addKey(cookie, provider, 'Generation key', apiKey)).json() as ProviderKey;
  const saved = await request(`${connectionPath}/presets`, { method: 'POST', cookie, body: {
    name: provider, provider, keyId: key.id,
    settings: { ...defaultConnectionSettings, model, responseTokens: 100, contextTokens: 12, temperature: 0.5 },
  } });
  expect(saved.status).toBe(201);
  const { activePresetId } = await saved.json() as { activePresetId: string };
  return activePresetId;
}

function mockGeneration(respond: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const genuineFetch = fetch;
  return spyOn(globalThis, 'fetch').mockImplementation(Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      return typeof input === 'string' && input.startsWith(baseUrl)
        ? genuineFetch(input, init)
        : Promise.resolve(respond(new URL(String(input)), init));
    },
    { preconnect: genuineFetch.preconnect },
  ));
}

function gmProviderStream(content: string, calls: { name: string; arguments: object }[] = []) {
  const tool_calls = calls.map((call, index) => ({
    index, id: `call_${index}`, function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }));
  const frame = { choices: [{ delta: { content, tool_calls }, finish_reason: calls.length ? 'tool_calls' : 'stop' }] };
  return new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

test('discovers account-owned agents and runs saved instructions with only the selected tools', async () => {
  await register('saved-agent-owner');
  await register('saved-agent-other');
  const cookie = sessionCookie(await login('saved-agent-owner')).token;
  const other = sessionCookie(await login('saved-agent-other')).token;
  const draft: AgentDraft = {
    name: 'Кубики', description: 'Бросает кубики атаки.', instructions: 'Отвечай результатом атаки.', tools: ['roll_dice'],
  };
  const create = (body: object, actor = cookie) => request('/agents', { method: 'POST', cookie: actor, body });
  const created = await create(draft);
  expect(created.status).toBe(201);
  const agent = await created.json() as SavedAgent;
  expect(agent).toEqual({ ...draft, id: expect.any(String) });
  const defense = await create({ ...draft, description: 'Бросает кубики защиты.', instructions: 'Отвечай результатом защиты.' });
  expect(defense.status).toBe(201);
  const secondAgent = await defense.json() as SavedAgent;
  expect(secondAgent).toMatchObject({ name: draft.name, tools: ['roll_dice'] });
  expect(secondAgent.id).not.toBe(agent.id);
  expect(await (await create({ ...draft, tools: ['subagent'] })).json()).toEqual({ code: 'agent_invalid', field: 'tools' });
  const path = `/agents/${agent.id}`;
  const rename = (actor: string) => request(path, { method: 'PUT', cookie: actor, body: { ...draft, name: 'Летописец' } });
  expect((await rename(other)).status).toBe(404);
  expect((await request(path, { method: 'DELETE', cookie: other })).status).toBe(404);
  expect(await (await request('/agents', { cookie: other })).json()).toEqual([]);

  const presetId = await saveGenerationPreset(cookie, 'openai', 'saved-agent-key');
  for (const actor of [cookie, other]) await request('/settings/tools/subagent', { method: 'PUT', cookie: actor, body: { enabled: true } });
  await request('/settings/tools/test_echo', { method: 'PUT', cookie, body: { enabled: true } });
  await request('/settings/tools/subagent-connection', { method: 'PUT', cookie, body: { presetId } });
  const delegate = (body: object, actor = cookie) => request('/llm/delegate', { method: 'POST', cookie: actor, body });
  const task = 'Проверь атаку.';
  expect(await (await delegate({ task, agentId: agent.id }, other)).json()).toMatchObject({ isError: true });
  expect((await delegate({ task, agentId: 'roll_dice' })).status).toBe(400);
  const upstream: { messages: { role: string; content: string }[]; tools: { function: { name: string; description: string } }[] }[] = [];
  const mock = mockGeneration((_url, init) => {
    upstream.push(JSON.parse(String(init?.body)));
    if (upstream.length === 2) return Response.json({ choices: [{
      message: { tool_calls: [{ id: 'forbidden', function: { name: 'test_echo', arguments: '{"text":"ping"}' } }] },
      finish_reason: 'tool_calls',
    }] });
    return Response.json({ choices: [{ message: { content: 'Выпало 3.' }, finish_reason: 'stop' }] });
  });
  const signal = new AbortController().signal;
  const call = (id: string, text: string, agentId = agent.id, name?: string) => ({
    type: 'toolCall' as const, id, name: 'subagent', arguments: { agentId, task: text, ...(name && { name }) },
  });
  const execute = async (input: object) => (await delegate(input)).json() as Promise<DelegateTaskResult>;
  try {
    expect((await request(generatePath, { method: 'POST', cookie, body: { messages: greeting, tools: toolDeclarations(['subagent']) } })).status).toBe(200);
    const description = upstream[0]!.tools[0]!.function.description;
    for (const field of [agent.id, draft.name, draft.description, secondAgent.id, secondAgent.description]) expect(description).toContain(field);
    expect(description).not.toContain(draft.instructions);

    const { entry } = await runToolCall(call('first', task), ['subagent'], {
      signal, id: 'first', history: [], delegateTask: createSubagentBatch([], execute),
    });
    expect(entry.result).toMatchObject({ answer: 'Выпало 3.', name: draft.name, toolCalls: [{ name: 'test_echo', isError: true }] });
    expect(upstream[1]!.messages[0]!.content).toContain(draft.instructions);
    expect(upstream[1]!.tools.map(({ function: tool }) => tool.name)).toEqual(['roll_dice']);

    expect((await rename(cookie)).status).toBe(200);
    const batch = createSubagentBatch([entry], execute);
    const followUp = 'Проверь ещё раз.';
    const result = await runToolCall(call('second', followUp), ['subagent'], { signal, id: 'second', history: [entry], delegateTask: batch });
    expect(result.entry.result).toEqual({ answer: 'Выпало 3.', name: 'Летописец' });
    expect(upstream[3]!.messages.slice(1)).toEqual([
      { role: 'user', content: task }, { role: 'assistant', content: 'Выпало 3.' }, { role: 'user', content: followUp },
    ]);
    const defenseTask = 'Проверь защиту.';
    const otherRun = await runToolCall(call('defense', defenseTask, secondAgent.id), ['subagent'], {
      signal, id: 'defense', history: [entry], delegateTask: batch,
    });
    expect(otherRun.entry.result).toEqual({ answer: 'Выпало 3.', name: secondAgent.name });
    expect(upstream[4]!.messages[0]!.content).toContain(secondAgent.instructions);
    expect(upstream[4]!.messages.slice(1)).toEqual([{ role: 'user', content: defenseTask }]);

    const names = ['Первая атака', 'Вторая атака'];
    const instances = await Promise.all(names.map((name) => runToolCall(call(name, 'Брось кубик.', agent.id, name), ['subagent'], {
      signal, id: name, history: [entry], delegateTask: batch,
    })));
    expect(instances.map(({ entry }) => entry.result)).toEqual(names.map((name) => ({ answer: 'Выпало 3.', name })));
    expect(upstream.slice(5).map(({ messages }) => messages.slice(1))).toEqual(names.map(() => [{ role: 'user', content: 'Брось кубик.' }]));
    const instanceHistory = [entry, ...instances.map(({ entry }) => entry)];
    await runToolCall(call('instance follow-up', followUp, agent.id, names[0]), ['subagent'], {
      signal, id: 'instance follow-up', history: instanceHistory, delegateTask: createSubagentBatch(instanceHistory, execute),
    });
    expect(upstream.at(-1)!.messages.slice(1)).toEqual([
      { role: 'user', content: 'Брось кубик.' }, { role: 'assistant', content: 'Выпало 3.' }, { role: 'user', content: followUp },
    ]);
    expect((await request(path, { method: 'DELETE', cookie })).status).toBe(204);
    expect(await (await request('/agents', { cookie })).json()).toEqual([secondAgent]);
    expect(await (await delegate({ task, agentId: agent.id })).json()).toMatchObject({ isError: true });
  } finally {
    mock.mockRestore();
  }
});

test('delegates a task using the active connection preset when it is selected for the subagent', async () => {
  await register('subagent-owner');
  await register('subagent-other');
  const cookie = sessionCookie(await login('subagent-owner')).token;
  const other = sessionCookie(await login('subagent-other')).token;
  const otherPresetId = await saveGenerationPreset(cookie, 'openai', 'other-preset-test-key', 'other-model');
  const presetId = await saveGenerationPreset(cookie, 'openrouter', 'worker-test-key', 'author/worker');
  const foreignPresetId = await saveGenerationPreset(other, 'openai', 'other-test-key');
  const select = (presetId: string) => request('/settings/tools/subagent-connection', { method: 'PUT', cookie, body: { presetId } });
  const task = 'Проверь, согласуются ли две даты.';
  const delegate = (input: object = { task }) => request('/llm/delegate', {
    method: 'POST', cookie, body: input,
  });
  const history = [{ task: 'Найди даты.', answer: '3 и 4 марта.' }];

  expect((await delegate({ task: ' ' })).status).toBe(400);
  expect((await delegate({ task, name: '\nХронолог' })).status).toBe(400);
  expect((await delegate({ task, history })).status).toBe(400);
  expect(await (await delegate()).json()).toEqual({ isError: true, result: 'Tool is not enabled.' });
  await request('/settings/tools/subagent', { method: 'PUT', cookie, body: { enabled: true } });
  expect(await (await delegate()).json()).toMatchObject({ isError: true, result: expect.stringContaining('Tools settings') });
  const selected = await (await select(presetId)).json() as ToolsResponse;
  expect(selected).toEqual({
    enabled: ['subagent'], subagent: { presetId, presets: [
      { id: otherPresetId, name: 'openai', model: 'other-model', provider: 'openai' },
      { id: presetId, name: 'openrouter', model: 'author/worker', provider: 'openrouter' },
    ] },
  });
  expect((await select(foreignPresetId)).status).toBe(404);
  expect(await (await request(connectionPath, { cookie })).json()).toMatchObject({ activePresetId: presetId });

  let calls = 0;
  const mock = mockGeneration((_url, init) => {
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer worker-test-key');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: 'author/worker', stream: false });
    expect(body.tools).toBeUndefined();
    const previous = ++calls === 3 ? [
      { role: 'user', content: history[0]!.task }, { role: 'assistant', content: history[0]!.answer },
    ] : [];
    expect(body.messages).toEqual([{ role: 'system', content: expect.any(String) }, ...previous, { role: 'user', content: task }]);
    if (calls === 2) return new Response(null, { status: 429 });
    return Response.json({ choices: [{ message: { content: 'Вторая дата на день раньше.' }, finish_reason: 'stop' }] });
  });
  try {
    expect(await (await delegate()).json()).toEqual({ result: { answer: 'Вторая дата на день раньше.' } });
    expect(await (await delegate()).json()).toMatchObject({ isError: true, result: expect.stringContaining('provider_rate_limit') });
    expect(await (await delegate({ task, name: 'Хронолог', history })).json()).toEqual({ result: {
      answer: 'Вторая дата на день раньше.', name: 'Хронолог',
    } });
    expect(calls).toBe(3);
    expect((await request(`${connectionPath}/presets/${presetId}`, { method: 'DELETE', cookie })).status).toBe(200);
    expect(await (await request('/settings/tools', { cookie })).json()).toMatchObject({ subagent: { presetId: null } });
  } finally {
    mock.mockRestore();
  }
});

test('configures tools for temporary agents independently from the chat', async () => {
  await register('temporary-agent-owner');
  const cookie = sessionCookie(await login('temporary-agent-owner')).token;
  const presetId = await saveGenerationPreset(cookie, 'openai', 'temporary-agent-key');
  await request('/settings/tools/subagent-connection', { method: 'PUT', cookie, body: { presetId } });
  await request('/settings/tools/subagent', { method: 'PUT', cookie, body: { enabled: true } });
  await request('/settings/tools/test_echo', { method: 'PUT', cookie, body: { enabled: true } });
  const settings = (tools: string[] | null) => request('/settings/tools/temporary-agent-tools', {
    method: 'PUT', cookie, body: { tools },
  });
  expect((await settings(['subagent'])).status).toBe(400);
  expect((await settings(['roll_dice', 'roll_dice'])).status).toBe(400);
  expect(await (await settings(['roll_dice'])).json()).toMatchObject({
    enabled: ['subagent', 'test_echo'], temporaryAgentTools: ['roll_dice'],
  });

  const received: { name: string; description: string }[][] = [];
  const mock = mockGeneration((_url, init) => {
    const body = JSON.parse(String(init?.body));
    received.push(body.tools?.map(({ function: tool }: { function: { name: string; description: string } }) => tool) ?? []);
    return Response.json({ choices: [{ message: { content: 'Готово.' }, finish_reason: 'stop' }] });
  });
  const delegate = (name?: string) => request('/llm/delegate', { method: 'POST', cookie, body: { task: 'Брось кубики.', name } });
  try {
    expect((await request(generatePath, { method: 'POST', cookie, body: { messages: greeting, tools: toolDeclarations(['subagent', 'test_echo']) } })).status).toBe(200);
    expect(received[0]!.map(({ name }) => name)).toEqual(['test_echo', 'subagent']);
    expect(received[0]![1]!.description).toContain('Tools for temporary agents: roll_dice.');
    expect(await (await delegate()).json()).toEqual({ result: { answer: 'Готово.' } });
    expect(received[1]!.map(({ name }) => name)).toEqual(['roll_dice']);

    expect(await (await settings([])).json()).toMatchObject({ temporaryAgentTools: [] });
    expect(await (await delegate('Тест')).json()).toEqual({ result: { answer: 'Готово.', name: 'Тест' } });
    expect(received[2]).toEqual([]);
    expect(await (await settings(null)).json()).not.toHaveProperty('temporaryAgentTools');
    expect((await delegate()).status).toBe(200);
    expect(received[3]!.map(({ name }) => name)).toEqual(['test_echo']);
  } finally {
    mock.mockRestore();
  }
});

test('cancels subagent generation when the calling chat disconnects', async () => {
  await register('subagent-cancel');
  const cookie = sessionCookie(await login('subagent-cancel')).token;
  const presetId = await saveGenerationPreset(cookie, 'openrouter', 'worker-test-key');
  await request('/settings/tools/subagent-connection', { method: 'PUT', cookie, body: { presetId } });
  await request('/settings/tools/subagent', { method: 'PUT', cookie, body: { enabled: true } });

  const started = Promise.withResolvers<AbortSignal>();
  const upstream = Promise.withResolvers<Response>();
  const mock = mockGeneration((_url, init) => {
    started.resolve(init!.signal!);
    return upstream.promise;
  });
  const client = new AbortController();
  try {
    const reply = request('/llm/delegate', {
      method: 'POST', cookie, signal: client.signal, body: { task: 'Проверь расчёт.' },
    });
    const signal = await Promise.race([started.promise, reply.then(() => { throw new Error('Expected a subagent request'); })]);
    const cancelled = once(signal, 'abort', { signal: AbortSignal.timeout(2_000) });
    client.abort();
    await expect(reply).rejects.toHaveProperty('name', 'AbortError');
    await cancelled;
    expect(signal.aborted).toBe(true);
  } finally {
    client.abort();
    upstream.resolve(new Response(null, { status: 502 }));
    mock.mockRestore();
  }
});

test('a subagent can roll dice, read the actual faces and save the trace for the calling model', async () => {
  await register('subagent-dice');
  const cookie = sessionCookie(await login('subagent-dice')).token;
  const presetId = await saveGenerationPreset(cookie, 'openai', 'worker-test-key');
  await request('/settings/tools/subagent-connection', { method: 'PUT', cookie, body: { presetId } });
  for (const tool of ['subagent', 'roll_dice', 'getRollDetails']) {
    await request(`/settings/tools/${tool}`, { method: 'PUT', cookie, body: { enabled: true } });
  }

  let round = 0;
  let rollId = '';
  let answer = '';
  const toolResponse = (...calls: { id: string; name: string; arguments: object }[]) => Response.json({ choices: [{
    message: { tool_calls: calls.map(({ id, name, arguments: args }) => ({ id, function: { name, arguments: JSON.stringify(args) } })) },
    finish_reason: 'tool_calls',
  }] });
  const mock = mockGeneration((_url, init) => {
    const { tools, messages } = JSON.parse(String(init?.body));
    expect(tools.map(({ function: { name } }: { function: { name: string } }) => name)).toEqual(['roll_dice', 'getRollDetails']);
    switch (++round) {
      case 1:
        return toolResponse(
          { id: 'dice', name: 'roll_dice', arguments: { rolls: { d20: '1d20', d8x3: '3d8', d12: '1d12' } } },
          { id: 'disabled', name: 'test_echo', arguments: { text: 'disabled' } },
          { id: 'nested', name: 'subagent', arguments: { task: 'Nested delegation' } },
        );
      case 2: {
        const [dice, disabled, nested] = messages.slice(-3);
        expect(disabled).toMatchObject({ role: 'tool', tool_call_id: 'disabled', content: '{"error":"Tool is not enabled."}' });
        expect(nested).toMatchObject({ role: 'tool', tool_call_id: 'nested', content: '{"error":"Tool is not enabled."}' });
        const { rollId: id } = JSON.parse(dice.content);
        rollId = id;
        expect(rollId).toMatch(/^sub_/);
        return toolResponse({ id: 'details', name: 'getRollDetails', arguments: { rollIds: [rollId] } });
      }
      case 3: {
        const { rolls } = JSON.parse(messages.at(-1).content);
        const faces = rolls[0].result.details.find(({ path }: { path: string[] }) => path[0] === 'd8x3').dice[0].results as number[];
        expect(faces).toHaveLength(3);
        expect(faces.every((value) => value >= 1 && value <= 8)).toBe(true);
        const { d20, d8x3, d12 } = rolls[0].result.values;
        expect(d20).toBeGreaterThanOrEqual(1);
        expect(d20).toBeLessThanOrEqual(20);
        expect(d12).toBeGreaterThanOrEqual(1);
        expect(d12).toBeLessThanOrEqual(12);
        expect(faces.reduce((sum, value) => sum + value, 0)).toBe(d8x3);
        answer = `d20: ${d20}; 3d8: ${faces.join(' + ')} = ${d8x3}; d12: ${d12}`;
        return Response.json({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] });
      }
      default:
        throw new Error('Unexpected subagent generation round');
    }
  });

  try {
    const signal = new AbortController().signal;
    const { entry, message } = await runToolCall({
      type: 'toolCall', id: 'delegate', name: 'subagent', arguments: { name: 'Subagent-B', task: 'Брось d20, 3d8 и d12.' },
    }, ['subagent'], {
      signal, id: 'delegate', history: [],
      delegateTask: async (body) => (await request('/llm/delegate', { method: 'POST', cookie, body })).json() as Promise<DelegateTaskResult>,
    });
    expect(round).toBe(3);
    expect(message.content).toEqual({ answer, name: 'Subagent-B', rollIds: [rollId] });
    const stored = JSON.parse(JSON.stringify(entry)) as ChatToolCall;
    const lookup = await runToolCall({ type: 'toolCall', id: 'lookup', name: 'getRollDetails', arguments: { rollIds: [rollId] } },
      ['getRollDetails'], { signal, id: 'lookup', history: [stored] });
    expect(lookup.message.content).toMatchObject({ rolls: [{ rollId, tool: 'roll_dice', result: { details: expect.any(Array) } }] });
    expect(entry.result).toMatchObject({ answer, toolCalls: expect.arrayContaining([{ id: rollId, name: 'roll_dice',
      arguments: expect.any(Object), result: expect.objectContaining({ details: expect.any(Array) }), modelResult: expect.any(Object),
    }]) });
  } finally {
    mock.mockRestore();
  }
});

test('restores a named GM subagent’s private history across published scenes', async () => {
  await register('gm-subagent-owner');
  const cookie = sessionCookie(await login('gm-subagent-owner')).token;
  const presetId = await saveGenerationPreset(cookie, 'openrouter', 'gm-worker-test-key', 'author/worker');
  await saveGenerationPreset(cookie, 'openai', 'gm-main-test-key', 'main-model');
  expect((await request('/settings/tools/subagent-connection', { method: 'PUT', cookie, body: { presetId } })).status).toBe(200);
  expect((await request('/settings/tools/subagent', { method: 'PUT', cookie, body: { enabled: true } })).status).toBe(200);
  const chat = await (await request('/chats', { method: 'POST', cookie })).json() as SavedChat;
  const path = `/chats/${chat.id}`;
  const saved = await (await request(path, { method: 'PUT', cookie, body: {
    revision: chat.revision, gmMode: true, messages: [{ id: 1, role: 'user', text: 'Открываю дверь', time: 1 }],
  } })).json() as SavedChat;

  const task = 'Предложи тайную причину потухшего света.';
  const answer = 'Хозяин дома спрятался в подвале.';
  const name = 'Автор тайн';
  const followUp = 'Развей тайну короткой подсказкой.';
  const secondAnswer = 'Из подвала слышен кашель.';
  const models: string[] = [];
  const mock = mockGeneration((_url, init) => {
    const body = JSON.parse(String(init?.body));
    models.push(body.model);
    const round = models.length;
    if (round === 1 || round === 4) {
      expect(body.tools.map(({ function: { name } }: { function: { name: string } }) => name)).toEqual(['subagent', 'publishScene']);
      if (round === 4) expect(body.messages[0].content).toContain(name);
      return gmProviderStream('', [{ name: 'subagent', arguments: { name, task: round === 1 ? task : followUp } }]);
    }
    if (round === 2 || round === 5) {
      const expected = [{ role: 'user', content: task }];
      if (round === 5) expected.push({ role: 'assistant', content: answer }, { role: 'user', content: followUp });
      expect(body.messages[0].content).toContain(name);
      expect(body.messages.slice(1)).toEqual(expected);
      expect(body.tools).toBeUndefined();
      return Response.json({ choices: [{ message: { content: round === 2 ? answer : secondAnswer }, finish_reason: 'stop' }] });
    }
    expect(body.messages.at(-1)).toEqual({
      role: 'tool', tool_call_id: 'call_0', content: JSON.stringify({ answer: round === 3 ? answer : secondAnswer, name }),
    });
    return gmProviderStream('', [{ name: 'publishScene', arguments: { text: 'В коридоре темно.' } }]);
  });
  try {
    const reply = await request(`${path}/gm-reply`, { method: 'POST', cookie, body: { revision: saved.revision } });
    expect(reply.status).toBe(200);
    const scene = await reply.json() as SavedChat;
    expect(scene.messages.at(-1)).toEqual({ id: 2, role: 'assistant', text: 'В коридоре темно.', time: expect.any(Number) });
    expect(db.query<{ turn_json: string }, []>('SELECT turn_json FROM chat_private_turns').get()?.turn_json).toContain(answer);
    const next = await (await request(path, { method: 'PUT', cookie, body: {
      revision: scene.revision, messages: [...scene.messages, { id: 3, role: 'user', text: 'Прислушиваюсь.', time: 3 }],
    } })).json() as SavedChat;
    const second = await request(`${path}/gm-reply`, { method: 'POST', cookie, body: { revision: next.revision } });
    expect(second.status).toBe(200);
    const published = await second.text();
    for (const secret of [answer, secondAnswer, name]) expect(published).not.toContain(secret);
    expect(models).toEqual(['main-model', 'author/worker', 'main-model', 'main-model', 'author/worker', 'main-model']);
  } finally {
    mock.mockRestore();
  }
});

test('publishes only the player scene and can retrieve a private roll in a later GM turn', async () => {
  await register('gm-owner');
  await register('gm-other');
  const cookie = sessionCookie(await login('gm-owner')).token;
  const other = sessionCookie(await login('gm-other')).token;
  await saveGenerationPreset(cookie, 'openai', 'gm-test-key');
  for (const tool of ['roll_dice', 'getRollDetails']) {
    expect((await request(`/settings/tools/${tool}`, { method: 'PUT', cookie, body: { enabled: true } })).status).toBe(200);
  }
  const created = await (await request('/chats', { method: 'POST', cookie })).json() as SavedChat;
  const path = `/chats/${created.id}`;
  const save = async (body: ChatSnapshot) => {
    const response = await request(path, { method: 'PUT', cookie, body });
    expect(response.status).toBe(200);
    return await response.json() as SavedChat;
  };
  const reply = (chat: SavedChat, owner = cookie) =>
    request(`${path}/gm-reply`, { method: 'POST', cookie: owner, body: { revision: chat.revision } });
  expect(created.gmMode).toBe(false);
  expect((await reply(created)).status).toBe(409);
  const ready = await save({ revision: created.revision, gmMode: true, messages: [
    { id: 1, role: 'user', text: 'Осматриваю ворота', time: 1 },
  ] });
  expect((await reply(ready, other)).status).toBe(404);

  let round = 0;
  let rollId = '';
  let providerAssertion: unknown;
  function respond(init?: RequestInit) {
    const body = JSON.parse(String(init?.body));
    expect(body.stream).toBe(true);
    expect(body.tools.map(({ function: { name } }: { function: { name: string } }) => name))
      .toEqual(['roll_dice', 'getRollDetails', 'publishScene']);
    const last = body.messages.at(-1);
    switch (round++) {
      case 0:
        return gmProviderStream('Закрытая подготовка', [
          { name: 'roll_dice', arguments: { rolls: { hiddenGateCheck: 'd6' }, purpose: 'Стражник подкуплен' } },
          { name: 'publishScene', arguments: { text: 'Преждевременная сцена' } },
        ]);
      case 1: {
        expect(last).toMatchObject({ role: 'tool', tool_call_id: 'call_1', content: expect.stringContaining('by itself') });
        const result = JSON.parse(body.messages.at(-2).content);
        rollId = result.rollId;
        expect(rollId).toMatch(/^gm_/);
        expect(typeof result.values.hiddenGateCheck).toBe('number');
        expect(result.details).toBeUndefined();
        return gmProviderStream('Закрытая оценка', [{ name: 'publishScene', arguments: {
          text: 'Ворота приоткрыты.', notes: `Засада у ворот. Проверка ${rollId}.`,
        } }]);
      }
      case 2:
        expect(JSON.stringify(body.messages)).toContain(`Засада у ворот. Проверка ${rollId}.`);
        expect(JSON.stringify(body.messages)).not.toContain('Закрытая подготовка');
        expect(last).toEqual({ role: 'user', content: 'Заглядываю внутрь' });
        return gmProviderStream('', [{ name: 'getRollDetails', arguments: { rollIds: [rollId] } }]);
      case 3:
        expect(JSON.parse(last.content)).toMatchObject({ rolls: [
          { rollId, tool: 'roll_dice', result: { values: { hiddenGateCheck: expect.any(Number) }, details: expect.any(Array) } },
        ] });
        return gmProviderStream('', [{ name: 'publishScene', arguments: { text: 'Внутри темно.' } }]);
      default:
        throw new Error('Unexpected model request');
    }
  }
  const mock = mockGeneration((_url, init) => {
    try {
      return respond(init);
    } catch (error) {
      providerAssertion = error;
      throw error;
    }
  });
  try {
    const result = await reply(ready);
    if (providerAssertion) throw providerAssertion;
    expect(result.status).toBe(200);
    expect(result.headers.get('Content-Type')).toContain('application/json');
    const scene = await result.json() as SavedChat;
    expect(scene).toEqual({
      ...ready, revision: ready.revision + 1, updatedAt: expect.any(Number), messages: [
        ...ready.messages, { id: 2, role: 'assistant', text: 'Ворота приоткрыты.', time: expect.any(Number) },
      ],
    });
    expect(await (await request(path, { cookie })).json()).toEqual(scene);
    const privateLog = db.query<{ turn_json: string }, []>('SELECT turn_json FROM chat_private_turns').get()!.turn_json;
    for (const secret of ['Закрытая подготовка', 'Закрытая оценка', 'Стражник подкуплен', 'hiddenGateCheck', 'Засада у ворот']) {
      expect(privateLog).toContain(secret);
      expect(JSON.stringify(scene)).not.toContain(secret);
    }
    expect((await reply(ready)).status).toBe(409);

    const off = await save({ revision: scene.revision, messages: scene.messages, gmMode: false });
    expect(await (await request(path, { cookie })).json()).toEqual(off);
    expect((await reply(off)).status).toBe(409);
    const next = await save({ revision: off.revision, gmMode: true, messages: [
      ...off.messages, { id: 3, role: 'user', text: 'Заглядываю внутрь', time: 3 },
    ] });
    const followUp = await reply(next);
    if (providerAssertion) throw providerAssertion;
    expect(followUp.status).toBe(200);
    const secondScene = await followUp.json() as SavedChat;
    expect(secondScene.messages.at(-1)).toEqual({ id: 4, role: 'assistant', text: 'Внутри темно.', time: expect.any(Number) });
    expect(await (await request(path, { cookie })).json()).toEqual(secondScene);
    expect(round).toBe(4);
  } finally {
    mock.mockRestore();
  }
});

test('keeps chat reply variants in order and restores their tools and activity', async () => {
  await register('variants-owner');
  await register('variants-other');
  const cookie = sessionCookie(await login('variants-owner')).token;
  const other = sessionCookie(await login('variants-other')).token;
  const created = await (await request('/chats', { method: 'POST', cookie })).json() as SavedChat;
  const path = `/chats/${created.id}`;
  const prompt: ChatMessage = { id: 1, role: 'user', text: 'Что у двери?', time: 1 };
  const original: ChatMessage = { id: 2, role: 'assistant', text: 'Горит лампа.', time: 2, edited: true,
    toolCalls: [{ id: 'original_call', name: 'test_echo', arguments: { message: 'лампа' }, result: 'лампа' }] };
  const second: ChatMessage = { id: 2, role: 'assistant', text: 'Висит фонарь.', time: 3 };
  const third: ChatMessage = { id: 2, role: 'assistant', text: 'Стоит свеча.', time: 4 };
  const activity = (message: ChatMessage): ChatActivityTurn => ({
    promptId: prompt.id,
    entries: [{ id: '1', kind: 'model', status: 'completed', time: message.time, details: { text: message.text } }],
  });
  const save = (chat: SavedChat, messages: ChatMessage[], extra?: Partial<Pick<ChatSnapshot, 'activity' | 'replaceId'>>) =>
    request(path, { method: 'PUT', cookie, body: { revision: chat.revision, messages, ...extra } });
  const select = (chat: SavedChat, index: number, owner = cookie) => request(`${path}/reply-variant`, {
    method: 'PUT', cookie: owner, body: { revision: chat.revision, replyId: original.id, index },
  });
  const ok = async (response: Response) => {
    expect(response.status).toBe(200);
    return await response.json() as SavedChat;
  };

  const initial = await ok(await save(created, [prompt, original], { activity: activity(original) }));
  const replacement = { replaceId: original.id, activity: activity(second) };
  const regenerated = await ok(await save(initial, [prompt, second], replacement));
  expect(regenerated.replyVariants).toEqual({ 2: { index: 1, total: 2 } });
  expect(await ok(await save(initial, [prompt, second], replacement))).toEqual(regenerated);
  expect((await select(regenerated, 0, other)).status).toBe(404);
  expect((await select(regenerated, 2)).status).toBe(409);
  const restored = await ok(await select(regenerated, 0));
  expect(restored.messages).toEqual([prompt, original]);
  expect(restored.activity).toEqual([activity(original)]);
  expect(restored.replyVariants).toEqual({ 2: { index: 0, total: 2 } });
  expect(await ok(await select(regenerated, 0))).toEqual(restored);

  const regeneratedAgain = await ok(await save(restored, [prompt, third], { replaceId: original.id, activity: activity(third) }));
  expect(regeneratedAgain.replyVariants).toEqual({ 2: { index: 2, total: 3 } });
  const followUp: ChatMessage = { id: 3, role: 'user', text: 'Захожу.', time: 5 };
  const continued = await ok(await save(regeneratedAgain, [...regeneratedAgain.messages, followUp]));
  expect((await save(continued, [prompt, third, followUp], { replaceId: original.id })).status).toBe(409);
  const middle = await ok(await select(continued, 1));
  expect(middle.messages).toEqual([prompt, second, followUp]);
  expect(middle.activity).toEqual([activity(second)]);
  expect(middle.replyVariants).toEqual({ 2: { index: 1, total: 3 } });
  expect(await ok(await request(path, { cookie }))).toEqual(middle);

  const orphan = await ok(await save(middle, [second, followUp]));
  const selectedOrphan = await ok(await select(orphan, 0));
  expect(selectedOrphan.messages).toEqual([original, followUp]);
  expect(selectedOrphan.activity).toBeUndefined();
  const deleted = await ok(await save(selectedOrphan, [followUp]));
  expect(deleted.replyVariants).toBeUndefined();
  expect((await select(deleted, 1)).status).toBe(409);
});

test('regenerates only the latest GM reply and restores its private notes when switching variants', async () => {
  await register('gm-regenerate-owner');
  const cookie = sessionCookie(await login('gm-regenerate-owner')).token;
  await saveGenerationPreset(cookie, 'openai', 'gm-regenerate-test-key');
  const created = await (await request('/chats', { method: 'POST', cookie })).json() as SavedChat;
  const path = `/chats/${created.id}`;
  const save = async (chat: SavedChat, messages: SavedChat['messages']) => {
    const response = await request(path, { method: 'PUT', cookie, body: { revision: chat.revision, gmMode: true, messages } });
    expect(response.status).toBe(200);
    return await response.json() as SavedChat;
  };
  const reply = (chat: SavedChat, replaceId?: number) =>
    request(`${path}/gm-reply`, { method: 'POST', cookie, body: { revision: chat.revision, replaceId } });
  const readNotes = () => db.query<{ turn_json: string }, []>('SELECT turn_json FROM chat_private_turns ORDER BY reply_id').all()
    .map(({ turn_json }) => JSON.parse(turn_json).notes);
  let scene: { text: string; notes: string } | undefined = { text: 'Видна дверь.', notes: 'Ключ лежит в кармане.' };
  const histories: string[] = [];
  const mock = mockGeneration((_url, init) => {
    histories.push(JSON.stringify(JSON.parse(String(init?.body)).messages));
    return scene ? gmProviderStream('', [{ name: 'publishScene', arguments: scene }]) : gmProviderStream('Неопубликованная сцена');
  });
  try {
    const firstPrompt = await save(created, [{ id: 1, role: 'user', text: 'Осматриваюсь.', time: 1 }]);
    const first = await reply(firstPrompt);
    expect(first.status).toBe(200);
    const firstScene = await first.json() as SavedChat;
    const nextPrompt = await save(firstScene, [...firstScene.messages, { id: 3, role: 'user', text: 'Прислушиваюсь.', time: 3 }]);
    scene = { text: 'Слышны шаги.', notes: 'По коридору идёт сторож.' };
    const next = await reply(nextPrompt);
    expect(next.status).toBe(200);
    const saved = await next.json() as SavedChat;
    expect((await reply(saved, 2)).status).toBe(409);
    expect((await reply(nextPrompt, 4)).status).toBe(409);
    expect(histories).toHaveLength(2);

    scene = undefined;
    expect((await reply(saved, 4)).status).toBe(422);
    expect(await (await request(path, { cookie })).json()).toEqual(saved);
    expect(readNotes()).toEqual(['Ключ лежит в кармане.', 'По коридору идёт сторож.']);

    scene = { text: 'Слышен скрип.', notes: 'Окно открыто.' };
    const replacement = await reply(saved, 4);
    expect(replacement.status).toBe(200);
    const regenerated = await replacement.json() as SavedChat;
    expect(regenerated.revision).toBe(saved.revision + 1);
    expect(regenerated.messages).toEqual([...saved.messages.slice(0, -1), {
      id: 4, role: 'assistant', text: 'Слышен скрип.', time: expect.any(Number),
    }]);
    expect(histories.at(-1)).toContain('Ключ лежит в кармане.');
    expect(histories.at(-1)).toContain('Прислушиваюсь.');
    expect(histories.at(-1)).not.toContain('Слышны шаги.');
    expect(histories.at(-1)).not.toContain('По коридору идёт сторож.');
    expect(readNotes()).toEqual(['Ключ лежит в кармане.', 'Окно открыто.']);
    expect(await (await request(path, { cookie })).json()).toEqual(regenerated);
    expect(regenerated.replyVariants).toEqual({ 4: { index: 1, total: 2 } });

    const restored = await request(`${path}/reply-variant`, {
      method: 'PUT', cookie, body: { revision: regenerated.revision, replyId: 4, index: 0 },
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ messages: saved.messages, replyVariants: { 4: { index: 0, total: 2 } } });
    expect(readNotes()).toEqual(['Ключ лежит в кармане.', 'По коридору идёт сторож.']);
  } finally {
    mock.mockRestore();
  }
});

test('never falls back to unpublished GM text when the model ignores publication', async () => {
  await register('gm-no-scene');
  const cookie = sessionCookie(await login('gm-no-scene')).token;
  await saveGenerationPreset(cookie, 'openai', 'gm-test-key');
  const chat = await (await request('/chats', { method: 'POST', cookie })).json() as SavedChat;
  const path = `/chats/${chat.id}`;
  const saved = await (await request(path, { method: 'PUT', cookie, body: {
    revision: chat.revision, gmMode: true, messages: [{ id: 1, role: 'user', text: 'Открываю дверь', time: 1 }],
  } })).json() as SavedChat;
  const choices: unknown[] = [];
  const mock = mockGeneration((_url, init) => {
    choices.push(JSON.parse(String(init?.body)).tool_choice);
    return gmProviderStream('Тайный текст, который нельзя показать.');
  });
  try {
    const reply = await request(`${path}/gm-reply`, { method: 'POST', cookie, body: { revision: saved.revision } });
    expect(reply.status).toBe(422);
    expect(await reply.json()).toEqual({ code: 'gm_scene_unpublished' });
    expect(choices).toEqual(['auto', { type: 'function', function: { name: 'publishScene' } }]);
    expect(await (await request(path, { cookie })).json()).toEqual(saved);
    expect(db.query('SELECT * FROM chat_private_turns').all()).toEqual([]);
  } finally {
    mock.mockRestore();
  }
});

test('uses the selected OpenRouter model endpoint without provider fallbacks', async () => {
  await register('route-owner');
  const cookie = sessionCookie(await login('route-owner')).token;
  const { id: keyId } = await (await addKey(cookie, 'openrouter', 'Routing key', 'route-test-key')).json() as ProviderKey;
  const model = 'author/selected:free';
  const tag = 'provider/turbo';
  const paths: string[] = [];
  const mock = mockGeneration((url, init) => {
    paths.push(url.pathname);
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer route-test-key');
    if (init?.method !== 'POST') return Response.json({ data: { endpoints: [
      { tag, provider_name: 'Provider' }, { tag, provider_name: 'Provider' }, { tag: '../invalid', provider_name: 'Invalid' },
    ] } });
    expect(JSON.parse(String(init.body))).toMatchObject({ model, provider: { only: [tag], allow_fallbacks: false } });
    return Response.json({ choices: [{ message: { content: 'Ответ' }, finish_reason: 'stop' }] });
  });
  try {
    const catalog = await request(`${connectionPath}/openrouter/endpoints`, { method: 'POST', cookie, body: { model, keyId } });
    expect(await catalog.json()).toEqual({ endpoints: [{ tag, name: 'Provider' }] });
    expect((await request(`${connectionPath}/presets`, { method: 'POST', cookie, body: {
      name: 'OpenRouter', provider: 'openrouter', keyId, settings: { ...defaultConnectionSettings, model, openrouterProvider: tag },
    } })).status).toBe(201);
    expect((await request(generatePath, { method: 'POST', cookie, body: { messages: greeting } })).status).toBe(200);
    expect(paths).toEqual(['/api/v1/models/author/selected%3Afree/endpoints', '/api/v1/chat/completions']);
  } finally {
    mock.mockRestore();
  }
});

test('supports an OpenAI-compatible custom base URL without a key and blocks unapproved private addresses', async () => {
  await register('custom-owner');
  const cookie = sessionCookie(await login('custom-owner')).token;
  const preset = (baseUrl: string) => request(`${connectionPath}/presets`, { method: 'POST', cookie, body: {
    name: baseUrl, provider: 'custom', keyId: null,
    settings: { ...defaultConnectionSettings, model: 'local-model', responseTokens: 256, baseUrl },
  } });
  const generate = () => request(generatePath, { method: 'POST', cookie, body: { messages: greeting, stream: true } });
  const models = (baseUrl: string) => request(`${connectionPath}/models`, { method: 'POST', cookie, body: { provider: 'custom', keyId: '', baseUrl } });
  expect((await preset('file:///model')).status).toBe(400);
  for (const url of ['http://127.0.0.1:1234/v1', 'http://[::ffff:127.0.0.1]:1234/v1']) {
    expect((await preset(url)).status).toBe(201);
    expect(await (await generate()).json()).toEqual({ code: 'custom_api_address_blocked' });
    expect(await (await models(url)).json()).toEqual({ code: 'custom_api_address_blocked' });
  }

  const url = 'https://8.8.8.8/v1/chat/completions';
  const stored = await preset(url);
  expect((await stored.json() as ConnectionState).presets).toContainEqual(expect.objectContaining({
    baseUrl: 'https://8.8.8.8/v1/', provider: 'custom', keyId: null,
  }));
  const paths: string[] = [];
  const mocked = mockGeneration((url, init) => {
    paths.push(url.pathname);
    expect(new Headers(init?.headers).get('Authorization')).toBeNull();
    expect(init?.redirect).toBe('error');
    if (init?.method !== 'POST') return Response.json({ data: [{ id: 'local-model' }] });
    expect(JSON.parse(String(init.body))).toEqual({ model: 'local-model', messages: greeting, stream: true, max_tokens: 256 });
    return new Response('data: {"choices":[{"delta":{"content":"Ответ"},"finish_reason":"stop"}]}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
  try {
    expect(await (await models(url)).json()).toEqual({ models: [{ id: 'local-model' }] });
    expect(await (await generate()).text()).toContain('"type":"done"');
    expect(paths).toEqual(['/v1/models', '/v1/chat/completions']);
  } finally {
    mocked.mockRestore();
  }
});

test('generates JSON with the active or selected owned preset and applies per-request parameters', async () => {
  await register('llm-owner');
  await register('llm-other');
  const cookie = sessionCookie(await login('llm-owner')).token;
  const other = sessionCookie(await login('llm-other')).token;
  const body: LlmRequest = { messages: greeting, parameters: { temperature: null, responseTokens: 80, topP: 0 } };
  const post = (cookie?: string, content = body) => request(generatePath, { method: 'POST', cookie, body: content });
  expect((await post()).status).toBe(401);
  expect(await (await post(cookie)).json()).toMatchObject({ code: 'missing_preset' });

  const apiKey = 'key-for-generation-test';
  const openai = await saveGenerationPreset(cookie, 'openai', apiKey);
  const openrouter = await saveGenerationPreset(cookie, 'openrouter', apiKey);
  const upstream: { url: string; authorization: string | null; body: object; redirect?: RequestInit['redirect'] }[] = [];
  const mock = mockGeneration((url, init) => {
    upstream.push({
      url: url.href, authorization: new Headers(init?.headers).get('Authorization'),
      body: JSON.parse(String(init?.body)), redirect: init?.redirect,
    });
    return Response.json({
      choices: [{ message: { role: 'assistant', content: 'Привет!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 15, completion_tokens: 4, total_tokens: 19 },
    });
  });
  try {
    expect(await (await post(other, { ...body, presetId: openai })).json()).toMatchObject({ code: 'missing_preset' });
    expect((await post(cookie, { ...body, presetId: openai, parameters: { topK: 2 } })).status).toBe(400);
    expect((await post(cookie, { ...body, messages: [...greeting, { role: 'tool', callId: 'unmatched', content: 'bad' }] })).status).toBe(400);
    const invalidUrl = { ...body, baseUrl: 'http://127.0.0.1' };
    expect((await post(cookie, invalidUrl)).status).toBe(400);
    expect(upstream).toHaveLength(0);

    const active = await post(cookie);
    expect(active.status).toBe(200);
    expect(await active.json()).toEqual({
      presetId: openrouter, provider: 'openrouter', model: 'test-model',
      message: { role: 'assistant', parts: [{ type: 'text', text: 'Привет!' }] },
      finishReason: 'stop', providerFinishReason: 'stop', usage: { inputTokens: 15, outputTokens: 4, totalTokens: 19 },
      contextTokens: 12, contextLimitExceeded: true,
    });
    expect(await (await post(cookie, { ...body, presetId: openai })).json()).toMatchObject({ presetId: openai, provider: 'openai' });
    expect(upstream.map(({ url }) => url)).toEqual(['https://openrouter.ai/api/v1/chat/completions', 'https://api.openai.com/v1/chat/completions']);
    for (const call of upstream) {
      expect(call.authorization).toBe(`Bearer ${apiKey}`);
      expect(call.redirect).toBe('error');
      expect(call.body).toEqual({ model: 'test-model', messages: greeting, stream: false, max_completion_tokens: 80, top_p: 0 });
    }
  } finally {
    mock.mockRestore();
  }
});

test('streams OpenRouter text and reasoning separately and replays tool calls', async () => {
  await register('stream-owner');
  const cookie = sessionCookie(await login('stream-owner')).token;
  await saveGenerationPreset(cookie, 'openrouter', 'stream-key');
  const tools = [{ name: 'weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }];
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const downstream = new AbortController();
  let continuation: unknown;
  const mock = mockGeneration((_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.stream) {
      expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'weather' } });
      return new Response(readable, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    continuation = body.messages;
    return Response.json({ choices: [{ message: { content: '18 °C' }, finish_reason: 'stop' }] });
  });
  try {
    const response = fetch(`${baseUrl}${generatePath}`, {
      method: 'POST', signal: downstream.signal,
      headers: { Cookie: cookie, 'X-Kuroko-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: greeting, tools, toolChoice: { name: 'weather' }, stream: true }),
    });
    const first = encoder.encode(': ping\r\ndata: {"choices":[\r\ndata: {"delta":{"content":"Привет"}}]}\r\n\r\n');
    const firstText = first.findIndex((byte) => byte > 127);
    const firstWrites = (async () => {
      await writer.write(first.subarray(0, firstText + 1));
      await writer.write(first.subarray(firstText + 1, -1));
      await writer.write(first.subarray(-1));
    })();
    const streamed = await response;
    expect(streamed.headers.get('Content-Type')).toContain('text/event-stream');
    const reader = streamed.body!.getReader();
    const firstEvent = new TextDecoder().decode((await reader.read()).value);
    expect(firstEvent).toContain('event: text_delta');
    expect(firstEvent).toContain('Привет');
    await firstWrites;
    const chunks = [
      { choices: [{ delta: { reasoning: 'a', tool_calls: [{ index: 0, id: 'call_1', function: { name: 'weather', arguments: '{"city":' } }],
        reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'a' }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Москва"}' } }],
        reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'b', signature: 'opaque' }] }, finish_reason: 'tool_calls' }] },
      { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.encrypted', index: 1, data: 'private' }] },
        finish_reason: 'tool_calls' }], usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } },
    ];
    await writer.write(encoder.encode(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'));
    void writer.close().catch(() => undefined);
    const tail = await new Response(new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
    })).text();
    const events = tail.split('\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)));
    expect(events.slice(0, 2)).toEqual([{ type: 'reasoning_delta', text: 'a' }, { type: 'reasoning_delta', text: 'b' }]);
    expect(events.map(({ type }) => type)).toEqual(['reasoning_delta', 'reasoning_delta', 'tool_call', 'done']);
    expect(events[2]?.call).toEqual({ type: 'toolCall', id: 'call_1', name: 'weather', arguments: { city: 'Москва' } });
    const { completion } = events[3]!;
    expect(completion).toMatchObject({ reasoning: 'ab', finishReason: 'tool_calls', usage: { totalTokens: 12 } });

    const followUp = await request(generatePath, { method: 'POST', cookie, body: {
      messages: [...greeting, completion.message, { role: 'tool', callId: 'call_1', content: { temperature: 18 } }], tools,
    } });
    expect(followUp.status).toBe(200);
    expect(continuation).toEqual([
      ...greeting,
      { role: 'assistant', content: 'Привет', tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'weather', arguments: '{"city":"Москва"}' } },
      ], reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'ab', signature: 'opaque' },
        { type: 'reasoning.encrypted', index: 1, data: 'private' }] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"temperature":18}' },
    ]);
  } finally {
    downstream.abort();
    void writer.abort().catch(() => undefined);
    mock.mockRestore();
  }
});

test('maps upstream HTTP and streaming failures without exposing provider payloads', async () => {
  await register('error-owner');
  const cookie = sessionCookie(await login('error-owner')).token;
  const key = 'do-not-echo-this-key';
  await saveGenerationPreset(cookie, 'openai', key);
  const mock = mockGeneration((_url, init) => {
    const input = JSON.parse(String(init?.body));
    if (!input.stream) return Response.json({ error: { message: key } }, { status: 429 });
    const content = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
    const errorEvent = `event: error\ndata: ${JSON.stringify({ error: { message: key } })}\n\n`;
    return new Response(input.top_p ? content : content + errorEvent, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  try {
    const post = (extra: Partial<LlmRequest>) => request(generatePath, { method: 'POST', cookie, body: { messages: greeting, ...extra } });
    const beforeStream = await post({});
    expect(beforeStream.status).toBe(429);
    expect(await beforeStream.json()).toEqual({ code: 'provider_rate_limit' });
    const afterStart = await (await post({ stream: true })).text();
    expect(afterStart).toContain('event: text_delta');
    expect(afterStart).toContain('event: error');
    expect(afterStart).toContain('data: {"type":"error","code":"provider_unavailable"}');
    expect(afterStart).not.toContain(key);
    expect(afterStart).not.toContain('event: done');
    const truncated = await (await post({ stream: true, parameters: { topP: 0.5 } })).text();
    expect(truncated).toContain('"code":"provider_protocol"');
    expect(truncated).not.toContain('event: done');
  } finally {
    mock.mockRestore();
  }
});

test('cancels the upstream stream when the client disconnects', async () => {
  await register('cancel-owner');
  const cookie = sessionCookie(await login('cancel-owner')).token;
  await saveGenerationPreset(cookie, 'openai', 'key-for-cancellation');
  const cancelled = Promise.withResolvers<void>();
  const release = new AbortController();
  let upstreamSignal: AbortSignal | null | undefined;
  const mock = mockGeneration((_url, init) => {
    upstreamSignal = init?.signal;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'));
        release.signal.addEventListener('abort', () => {
          if (!upstreamSignal?.aborted) controller.close();
        }, { once: true });
      },
      cancel() { cancelled.resolve(); },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const client = new AbortController();
  try {
    const reply = await fetch(`${baseUrl}${generatePath}`, {
      method: 'POST', signal: client.signal,
      headers: { Cookie: cookie, 'X-Kuroko-Request': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: greeting, stream: true }),
    });
    const event = await reply.body!.getReader().read();
    expect(new TextDecoder().decode(event.value)).toContain('event: text_delta');
    client.abort();
    const timeout = AbortSignal.timeout(2000);
    await Promise.race([
      cancelled.promise,
      new Promise<never>((_, reject) => timeout.addEventListener('abort', () => reject(timeout.reason), { once: true })),
    ]);
    expect(upstreamSignal?.aborted).toBe(true);
  } finally {
    client.abort();
    release.abort();
    mock.mockRestore();
  }
});

test('deletes only the confirmed account and cascades to its sessions and secrets', async () => {
  const other = await register('other');
  const { id: otherId } = await other.json() as { id: number };
  expect((await register('owner')).status).toBe(201);
  const first = sessionCookie(await login('owner')).token;
  const second = sessionCookie(await login('owner', true)).token;
  const otherCookie = sessionCookie(await login('other')).token;
  const path = '/auth/account';
  const body = { username: 'owner', currentPassword: password };
  for (const [cookie, name] of [[first, 'Owner secret'], [otherCookie, 'Other secret']] as const) {
    const created = await addKey(cookie, 'openai', name, 'test-key-value');
    expect(created.status).toBe(201);
    const { id } = await created.json() as ProviderKey;
    expect((await request(`${connectionPath}/presets`, { method: 'POST', cookie, body: {
      name: 'Default preset', provider: 'openai', keyId: id, settings: { ...defaultConnectionSettings, model: 'test-model' },
    } })).status).toBe(201);
    expect((await request('/settings/chat', { method: 'PUT', cookie, body: defaultChatSettings })).status).toBe(200);
  }

  expect((await request(path, { method: 'DELETE', cookie: first, body, withHeader: false })).status).toBe(403);
  expect((await request(path, { method: 'DELETE', cookie: first, account: otherId, body })).status).toBe(401);
  expect((await request(path, { method: 'DELETE', cookie: first, body: { ...body, username: 'other' } })).status).toBe(400);
  expect((await request(path, { method: 'DELETE', cookie: first, body: { ...body, currentPassword: 'wrong' } })).status).toBe(400);
  expect((await request('/auth/session', { cookie: first })).status).toBe(200);

  const deleted = await request(path, { method: 'DELETE', cookie: first, body });
  expect(deleted.status).toBe(204);
  expect(deleted.headers.get('set-cookie')).toContain('__Host-kuroko_session=;');
  expect((await request('/auth/session', { cookie: first })).status).toBe(401);
  expect((await request(connectionPath, { cookie: second })).status).toBe(401);
  expect((await login('owner')).status).toBe(401);
  expect(db.query('SELECT name FROM secrets').all()).toEqual([{ name: 'Other secret' }]);
  expect(db.query('SELECT user_id FROM connection_presets').all()).toEqual([{ user_id: otherId }]);
  expect(db.query('SELECT user_id FROM chat_settings').all()).toEqual([{ user_id: otherId }]);
  expect((await request('/auth/session', { cookie: otherCookie })).status).toBe(200);

  expect((await register('owner')).status).toBe(201);
  const fresh = sessionCookie(await login('owner')).token;
  expect(await (await request(connectionPath, { cookie: fresh })).json()).toEqual({ activePresetId: null, presets: [], keys: [] });
});
