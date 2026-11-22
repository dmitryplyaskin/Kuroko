import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { ChatSnapshot, SavedChat } from '@kuroko/contracts/chat';
import { defaultChatSettings } from '@kuroko/contracts/chatSettings';
import { defaultConnectionSettings, type ConnectionState, type ProviderKey } from '@kuroko/contracts/connectionSettings';
import type { LlmRequest } from '@kuroko/contracts/llm';
import type { Realm, RealmList, SavedRealm } from '@kuroko/contracts/realms';
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

type RequestOptions = { method?: string; body?: object; cookie?: string; account?: number; withHeader?: boolean };

function request(path: string, { method = 'GET', body, cookie, account, withHeader = true }: RequestOptions = {}) {
  const headers = new Headers();
  if (method !== 'GET' && withHeader) headers.set('X-Kuroko-Request', '1');
  if (body) headers.set('Content-Type', 'application/json');
  if (cookie) headers.set('Cookie', cookie);
  if (account !== undefined) headers.set('X-Kuroko-Account', String(account));
  return fetch(`${baseUrl}${path}`, { method, headers, body: body && JSON.stringify(body) });
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
      characters: 1, starts: 0, hasAvatar: true,
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
    { id: 2, role: 'assistant', text: 'Ответ', time: 2 },
    { id: 3, role: 'assistant', text: '🎲', time: 3, toolCalls: [
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

test('saves multiple named presets for one provider and unlinks a deleted key from all of them', async () => {
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
    activePresetId: null, presets: [expect.objectContaining({ id: secondId })],
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

async function saveGenerationPreset(cookie: string, provider: string, apiKey: string) {
  const key = await (await addKey(cookie, provider, 'Generation key', apiKey)).json() as ProviderKey;
  const saved = await request(`${connectionPath}/presets`, { method: 'POST', cookie, body: {
    name: provider, provider, keyId: key.id,
    settings: { ...defaultConnectionSettings, model: 'test-model', responseTokens: 100, contextTokens: 12, temperature: 0.5 },
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

test('streams text before completion and assembles and replays OpenRouter tool calls', async () => {
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
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'weather', arguments: '{"city":' } }],
        reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'a' }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Москва"}' } }],
        reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'b', signature: 'opaque' }] }, finish_reason: 'tool_calls' }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } },
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
    expect(events.map(({ type }) => type)).toEqual(['tool_call', 'done']);
    expect(events[0]?.call).toEqual({ type: 'toolCall', id: 'call_1', name: 'weather', arguments: { city: 'Москва' } });
    expect(events[1]?.completion).toMatchObject({ finishReason: 'tool_calls', usage: { totalTokens: 12 } });

    const followUp = await request(generatePath, { method: 'POST', cookie, body: {
      messages: [...greeting, events[1]?.completion.message, { role: 'tool', callId: 'call_1', content: { temperature: 18 } }], tools,
    } });
    expect(followUp.status).toBe(200);
    expect(continuation).toEqual([
      ...greeting,
      { role: 'assistant', content: 'Привет', tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'weather', arguments: '{"city":"Москва"}' } },
      ], reasoning_details: [{ type: 'reasoning.text', index: 0, text: 'ab', signature: 'opaque' }] },
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
