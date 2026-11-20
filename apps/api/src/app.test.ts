import { afterEach, beforeEach, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { defaultChatSettings } from '../../shared/chatSettings';
import { createApp } from './app';
import { openDatabase } from './database';

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
  return { header: cookie, token: cookie.split(';', 1)[0] };
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

test('encrypts values and scopes every secret operation to the authenticated owner', async () => {
  expect((await register('owner')).status).toBe(201);
  expect((await register('other')).status).toBe(201);
  const owner = await login('owner');
  expect(owner.status).toBe(200);
  const { id: account } = await owner.json() as { id: number };
  const ownerCookie = sessionCookie(owner).token;
  const otherCookie = sessionCookie(await login('other')).token;
  const value = '  confidential\nсекрет  ';
  const fields = { name: 'SSH key', value };

  expect((await request('/secrets')).status).toBe(401);
  const created = await request('/secrets', { method: 'POST', cookie: ownerCookie, body: fields });
  expect(created.status).toBe(201);
  const summary = await created.json() as { id: string; name: string };
  expect(summary).toEqual({ id: expect.any(String), name: fields.name });
  const path = `/secrets/${summary.id}`;
  const stored = db.query<{ encrypted_value: Uint8Array }, []>('SELECT encrypted_value FROM secrets').get();
  expect(stored?.encrypted_value).toBeInstanceOf(Uint8Array);
  expect(Buffer.from(stored!.encrypted_value).includes(value)).toBe(false);

  const ownerList = await request('/secrets', { cookie: ownerCookie });
  expect(ownerList.headers.get('Cache-Control')).toBe('no-store');
  expect(await ownerList.json()).toEqual([summary]);
  expect(await (await request('/secrets', { cookie: otherCookie })).json()).toEqual([]);
  expect((await request('/secrets', { cookie: otherCookie, account })).status).toBe(401);
  expect((await request(path, { cookie: otherCookie })).status).toBe(404);
  expect((await request(path, { method: 'PUT', cookie: otherCookie, body: fields })).status).toBe(404);
  expect((await request(path, { method: 'DELETE', cookie: otherCookie })).status).toBe(404);
  expect(await (await request(path, { cookie: ownerCookie })).json()).toEqual({ ...summary, value });

  const updated = { name: 'Updated key', value: 'new value' };
  expect((await request(path, { method: 'PUT', cookie: ownerCookie, body: updated })).status).toBe(200);
  expect(await (await request(path, { cookie: ownerCookie })).json()).toEqual({ id: summary.id, ...updated });
  expect((await request(path, { method: 'DELETE', cookie: ownerCookie })).status).toBe(204);
  expect((await request(path, { cookie: ownerCookie })).status).toBe(404);
});

test('changes the password once, revokes all sessions and preserves the vault', async () => {
  expect((await register('owner')).status).toBe(201);
  const first = sessionCookie(await login('owner')).token;
  const second = sessionCookie(await login('owner', true)).token;
  const newPassword = 'replacement-passphrase';
  const body = { currentPassword: password, newPassword };
  const path = '/auth/password';
  const secret = { name: 'Saved key', value: 'test vault value' };
  expect((await request('/secrets', { method: 'POST', cookie: first, body: secret })).status).toBe(201);
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
  const list = await request('/secrets', { cookie: sessionCookie(nextLogin).token });
  expect(await list.json()).toEqual([{ id: expect.any(String), name: secret.name }]);
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

test('deletes only the confirmed account and cascades to its sessions and secrets', async () => {
  const other = await register('other');
  const { id: otherId } = await other.json() as { id: number };
  expect((await register('owner')).status).toBe(201);
  const first = sessionCookie(await login('owner')).token;
  const second = sessionCookie(await login('owner', true)).token;
  const otherCookie = sessionCookie(await login('other')).token;
  const path = '/auth/account';
  const body = { username: 'owner', currentPassword: password };
  for (const [cookie, name] of [[first, 'Owner secret'], [otherCookie, 'Other secret']]) {
    expect((await request('/secrets', { method: 'POST', cookie, body: { name, value: 'test value' } })).status).toBe(201);
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
  expect((await request('/secrets', { cookie: second })).status).toBe(401);
  expect((await login('owner')).status).toBe(401);
  expect(db.query('SELECT name FROM secrets').all()).toEqual([{ name: 'Other secret' }]);
  expect(db.query('SELECT user_id FROM chat_settings').all()).toEqual([{ user_id: otherId }]);
  expect((await request('/auth/session', { cookie: otherCookie })).status).toBe(200);

  expect((await register('owner')).status).toBe(201);
  const fresh = sessionCookie(await login('owner')).token;
  expect(await (await request('/secrets', { cookie: fresh })).json()).toEqual([]);
});
