import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { defaultChatSettings } from '@kuroko/contracts/chatSettings';
import { defaultConnectionSettings, type ProviderKey } from '@kuroko/contracts/connectionSettings';
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

test('registers, issues a revocable session and persists it only with auto-login', async () => {
  const registration = await register('Алиса');
  expect(registration.status).toBe(201);
  expect(registration.headers.get('Set-Cookie')).toBeNull();
  expect((await register('АЛИСА')).status).toBe(409);
  const account = db.query<{ password_hash: string }, []>('SELECT password_hash FROM users').get();
  expect(account?.password_hash).toStartWith('$argon2id$');
  expect((await request('/auth/session')).status).toBe(401);
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
