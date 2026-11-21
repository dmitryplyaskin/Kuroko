import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allSettled, createWatch, fork, scopeBind } from 'effector';
import { defaultChatSettings } from '@kuroko/contracts/chatSettings';
import { defaultConnectionSettings, type ConnectionState } from '@kuroko/contracts/connectionSettings';
import { appStarted } from '../platform/lifecycle';
import { ApiError } from '../shared/http/api';
import {
  $activeSession, $session, checkSessionFx, protectedRequestFailed, sessionEndRequested, sessionRetryRequested, sessionUserReceived,
} from '../platform/session/model';
import {
  $appliedChatSettings, $chatSettingsDirty, $chatSettingsDraft, $chatSettingsSubmission, chatSettingsChanged,
  chatSettingsInitialized, chatSettingsSaveRequested, loadChatSettingsFx, saveChatSettingsFx,
} from '../features/chat/settings/model';
import {
  $connectionLoad, $connectionSelection, connectionActionRequested, connectionClosed, connectionDraftChanged,
  connectionModelsRequested, connectionOpened, connectionProviderChanged, loadConnectionFx, mutateConnectionFx,
  presetCopyRequested, presetSelected,
} from '../features/connection/model';
import { $modelCatalog, loadModelCatalogFx } from '../features/connection/modelCatalog';
import {
  $chatAnnouncement, $chatError, $chatRows, $replyId, chatDraftChanged, chatSendRequested, chatShown, chatStopRequested,
  messageDeleteRequested, messageEditChanged, messageEditRequested, messageEditSubmitted,
} from '../features/chat/model';

const user = { id: 1, username: 'Лина' };
const noChatSettings = () => ({ settings: null, legacy: undefined });

const connection: ConnectionState = {
  activePresetId: 'one',
  presets: [{
    ...defaultConnectionSettings, id: 'one', name: 'Первый пресет', model: 'demo-model', provider: 'openai', keyId: 'key',
  }],
  keys: [
    { id: 'key', name: 'Первый ключ', provider: 'openai' },
    { id: 'other-key', name: 'Второй ключ', provider: 'anthropic' },
  ],
};

test('startup can retry after a network error and enters the workspace after restoring a session', async () => {
  let attempts = 0;
  const scope = fork({
    handlers: [
      [checkSessionFx, () => {
        if (++attempts === 1) throw new Error('Unavailable');
        return user;
      }],
    ],
  });

  await allSettled(appStarted, { scope });
  assert.equal(scope.getState($session).status, 'unavailable');
  await allSettled(sessionRetryRequested, { scope });
  assert.deepEqual(scope.getState($activeSession)?.user, user);
  await allSettled(sessionRetryRequested, { scope });
  assert.equal(attempts, 2);
});

test('a late 401 after signing in again as the same user leaves the new session intact', async () => {
  const oldSave = Promise.withResolvers<typeof defaultChatSettings>();
  const scope = fork({
    handlers: [[loadChatSettingsFx, noChatSettings], [saveChatSettingsFx, () => oldSave.promise]],
  });

  await allSettled(chatSettingsInitialized, { scope });
  await allSettled(sessionUserReceived, { scope, params: user });
  const oldSession = scope.getState($activeSession)!;
  await allSettled(chatSettingsChanged, { scope, params: { fontSize: 20 } });
  scopeBind(chatSettingsSaveRequested, { scope })();
  assert.equal(scope.getState($chatSettingsSubmission).status, 'saving');
  scopeBind(sessionEndRequested, { scope })({ session: oldSession });
  assert.equal(oldSession.signal.aborted, true);
  assert.deepEqual(scope.getState($chatSettingsDraft), defaultChatSettings);
  scopeBind(sessionUserReceived, { scope })(user);

  oldSave.reject(new ApiError(401, 'Session expired'));
  await allSettled(scope);

  assert.equal(scope.getState($session).status, 'authenticated');
  assert.notEqual(scope.getState($activeSession), oldSession);
  assert.equal(scope.getState($chatSettingsSubmission).status, 'idle');
  assert.deepEqual(scope.getState($appliedChatSettings), defaultChatSettings);

  await allSettled(protectedRequestFailed, {
    scope, params: { session: scope.getState($activeSession)!, error: new ApiError(401, 'Session expired') },
  });
  assert.equal(scope.getState($session).status, 'guest');
});

test('a late successful load leaves the chat settings of a new session for the same user intact', async () => {
  const freshSettings = { ...defaultChatSettings, fontSize: 20 };
  const oldLoad = Promise.withResolvers<Awaited<ReturnType<typeof loadChatSettingsFx>>>();
  let requests = 0;
  const scope = fork({
    handlers: [[loadChatSettingsFx, () => ++requests === 1 ? oldLoad.promise : { settings: freshSettings, legacy: undefined }]],
  });

  await allSettled(chatSettingsInitialized, { scope });
  const signIn = scopeBind(sessionUserReceived, { scope });
  signIn(user);
  const oldSession = scope.getState($activeSession)!;
  scopeBind(sessionEndRequested, { scope })({ session: oldSession });
  signIn(user);
  await Promise.resolve();

  assert.equal(requests, 2);
  assert.equal(oldSession.signal.aborted, true);
  assert.deepEqual(scope.getState($appliedChatSettings), freshSettings);
  oldLoad.resolve({ settings: { ...defaultChatSettings, fontSize: 24 }, legacy: undefined });
  await allSettled(scope);

  assert.deepEqual(scope.getState($appliedChatSettings), freshSettings);
  assert.deepEqual(scope.getState($chatSettingsDraft), freshSettings);
});

test('legacy chat preferences are a draft and are applied only after a successful save', async () => {
  const legacy = { ...defaultChatSettings, fontSize: 22 };
  const saving = Promise.withResolvers<typeof defaultChatSettings>();
  const scope = fork({
    handlers: [
      [loadChatSettingsFx, () => ({ settings: null, legacy })],
      [saveChatSettingsFx, ({ draft }: Parameters<typeof saveChatSettingsFx>[0]) => {
        assert.deepEqual(draft, legacy);
        return saving.promise;
      }],
    ],
  });

  await allSettled(chatSettingsInitialized, { scope });
  await allSettled(sessionUserReceived, { scope, params: user });
  assert.deepEqual(scope.getState($chatSettingsDraft), legacy);
  assert.equal(scope.getState($chatSettingsDirty), true);
  assert.deepEqual(scope.getState($appliedChatSettings), defaultChatSettings);

  scopeBind(chatSettingsSaveRequested, { scope })();
  scopeBind(chatSettingsChanged, { scope })({ fontSize: 25 });
  assert.deepEqual(scope.getState($chatSettingsDraft), legacy);
  saving.resolve(legacy);
  await allSettled(scope);

  assert.equal(scope.getState($chatSettingsDirty), false);
  assert.deepEqual(scope.getState($appliedChatSettings), legacy);
});

test('copying a connection preset uses its latest draft and keeps the original draft', async () => {
  const scope = fork({ handlers: [[loadConnectionFx, () => connection]] });
  await allSettled(sessionUserReceived, { scope, params: user });
  await allSettled(connectionOpened, { scope });
  await allSettled(connectionDraftChanged, { scope, params: { model: 'custom-model' } });
  await allSettled(presetCopyRequested, { scope });

  const copy = scope.getState($connectionSelection);
  assert.equal(copy.presetId, '');
  assert.partialDeepStrictEqual(copy.draft, { name: '', model: 'custom-model', keyId: 'key' });

  await allSettled(presetSelected, { scope, params: 'one' });
  assert.partialDeepStrictEqual(scope.getState($connectionSelection).draft, { name: 'Первый пресет', model: 'custom-model' });
});

test('changing provider cancels the old catalog and ignores its late result', async () => {
  const first = Promise.withResolvers<{ models: { id: string }[] }>();
  let firstController: AbortController | undefined;
  const scope = fork({
    handlers: [
      [loadConnectionFx, () => connection],
      [loadModelCatalogFx, ({ provider, controller }: Parameters<typeof loadModelCatalogFx>[0]) => {
        if (provider === 'anthropic') return { models: [{ id: 'current-model' }] };
        firstController = controller;
        return first.promise;
      }],
    ],
  });
  await allSettled(sessionUserReceived, { scope, params: user });
  await allSettled(connectionOpened, { scope });
  scopeBind(connectionModelsRequested, { scope })();
  assert.equal(scope.getState($modelCatalog).status, 'loading');

  scopeBind(connectionProviderChanged, { scope })('anthropic');
  assert.equal(firstController?.signal.aborted, true);
  assert.equal(scope.getState($modelCatalog).status, 'idle');
  scopeBind(connectionDraftChanged, { scope })({ keyId: 'other-key' });
  scopeBind(connectionModelsRequested, { scope })();

  first.resolve({ models: [{ id: 'stale-model' }] });
  await allSettled(scope);
  assert.deepEqual(scope.getState($modelCatalog), { status: 'ready', models: [{ id: 'current-model' }] });
});

test('re-entering the connection tab waits for a write before loading its new snapshot', async () => {
  const saved = { ...connection, presets: connection.presets.map((preset) => ({ ...preset, model: 'saved-model' })) };
  const pending = Promise.withResolvers<ConnectionState>();
  let reads = 0;
  let writes = 0;
  const scope = fork({
    handlers: [
      [loadConnectionFx, () => ++reads === 1 ? connection : saved],
      [mutateConnectionFx, async () => {
        writes++;
        return { kind: 'savePreset', id: 'one', state: await pending.promise };
      }],
    ],
  });
  await allSettled(sessionUserReceived, { scope, params: user });
  await allSettled(connectionOpened, { scope });
  const act = scopeBind(connectionActionRequested, { scope });
  act({ kind: 'savePreset' });
  act({ kind: 'deleteKey', id: 'key' });
  scopeBind(connectionClosed, { scope })();
  scopeBind(connectionOpened, { scope })();

  assert.equal(reads, 1);
  assert.equal(writes, 1);
  assert.equal(scope.getState($connectionLoad).status, 'loading');
  pending.resolve(saved);
  await allSettled(scope);

  assert.equal(reads, 2);
  assert.deepEqual(scope.getState($connectionLoad), { status: 'ready', data: saved });
  assert.equal(scope.getState($connectionSelection).draft.model, 'saved-model');
});

const sseHeaders = { 'Content-Type': 'text/event-stream' };
const encode = (text: string) => new TextEncoder().encode(text);
const sse = (value: object) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const completed = (text: string) => sse({
  type: 'done', completion: { message: { role: 'assistant', parts: [{ type: 'text', text }] }, finishReason: 'stop' },
});

async function openChat() {
  const scope = fork();
  await allSettled(sessionUserReceived, { scope, params: user });
  await allSettled(chatShown, { scope });
  return scope;
}

test('chat renders streamed text before completion and sends only the new message for the active preset', async () => {
  const scope = await openChat();
  const payloads: unknown[] = [];
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, '/api/llm/generate');
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Accept'), 'text/event-stream');
    assert.equal(headers.get('X-Kuroko-Request'), '1');
    assert.equal(headers.get('X-Kuroko-Account'), String(user.id));
    payloads.push(JSON.parse(String(init?.body)));
    return new Response(payloads.length === 1 ? stream.readable : completed('Второй ответ.'), { headers: sseHeaders });
  };
  const partial = Promise.withResolvers<void>();
  const unwatch = createWatch({
    scope, unit: $chatRows, fn: (rows) => { if (rows.at(-1)?.text === 'При') partial.resolve(); },
  });
  try {
    assert.deepEqual(scope.getState($chatRows), []);
    await allSettled(chatDraftChanged, { scope, params: '  Привет  ' });
    scopeBind(chatSendRequested, { scope })();
    const bytes = encode(': ping\r\n\r\n' + sse({ type: 'text_delta', text: 'При' }));
    const split = bytes.findIndex((byte) => byte > 127) + 1;
    await writer.write(bytes.subarray(0, split));
    await writer.write(bytes.subarray(split));
    await partial.promise;
    assert.notEqual(scope.getState($replyId), null);
    assert.deepEqual(scope.getState($chatRows).map(({ text }) => text), ['Привет', 'При']);

    await writer.write(encode(completed('Привет!')));
    void writer.close().catch(() => undefined);
    await allSettled(scope);
    assert.equal(scope.getState($replyId), null);
    await allSettled(chatDraftChanged, { scope, params: 'Второй запрос' });
    await allSettled(chatSendRequested, { scope });
    assert.deepEqual(scope.getState($chatRows).map(({ text }) => text), ['Привет', 'Привет!', 'Второй запрос', 'Второй ответ.']);
    assert.deepEqual(payloads, [
      { stream: true, messages: [{ role: 'user', content: 'Привет' }] },
      { stream: true, messages: [{ role: 'user', content: 'Второй запрос' }] },
    ]);
  } finally {
    unwatch();
    globalThis.fetch = originalFetch;
    void writer.abort().catch(() => undefined);
  }
});

test('chat stops the request, retains the visible answer and ignores late frames', async () => {
  const scope = await openChat();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const originalFetch = globalThis.fetch;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_input, init) => {
    signal = init?.signal;
    return new Response(stream.readable, { headers: sseHeaders });
  };
  const partial = Promise.withResolvers<void>();
  const unwatch = createWatch({
    scope, unit: $chatRows, fn: (rows) => { if (rows.at(-1)?.text === 'Начало') partial.resolve(); },
  });
  try {
    await allSettled(chatDraftChanged, { scope, params: 'Привет' });
    scopeBind(chatSendRequested, { scope })();
    await writer.write(encode(sse({ type: 'text_delta', text: 'Начало' })));
    await partial.promise;
    scopeBind(chatStopRequested, { scope })();
    assert.equal(signal?.aborted, true);
    assert.equal(scope.getState($replyId), null);
    assert.equal(scope.getState($chatAnnouncement), 'Ответ модели остановлен.');

    await writer.write(encode(sse({ type: 'text_delta', text: ' и продолжение' }) + completed('Поздний ответ')));
    void writer.close().catch(() => undefined);
    await allSettled(scope);
    assert.equal(scope.getState($chatRows).at(-1)?.text, 'Начало');
    assert.equal(scope.getState($chatError), '');
    const message = scope.getState($chatRows)[0]!;
    await allSettled(messageEditRequested, { scope, params: message.id });
    await allSettled(messageEditChanged, { scope, params: { id: message.id, text: '  Правка  ' } });
    await allSettled(messageEditSubmitted, { scope, params: message.id });
    assert.partialDeepStrictEqual(scope.getState($chatRows)[0], { text: 'Правка', edited: true });
    await allSettled(messageDeleteRequested, { scope, params: message.id });
    assert.deepEqual(scope.getState($chatRows).map(({ text }) => text), ['Начало']);
  } finally {
    unwatch();
    globalThis.fetch = originalFetch;
    void writer.abort().catch(() => undefined);
  }
});

test('chat displays connection and stream errors and keeps partial text', async () => {
  const scope = await openChat();
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    if (++requests === 1) return Response.json({ error: 'Пресет подключения не найден.' }, { status: 404 });
    return new Response(sse({ type: 'text_delta', text: 'Начало' }) +
      sse({ type: 'error', code: 'provider_unavailable', error: 'Провайдер прервал ответ.' }), { headers: sseHeaders });
  };
  try {
    await allSettled(chatDraftChanged, { scope, params: 'Первое сообщение' });
    await allSettled(chatSendRequested, { scope });
    assert.equal(scope.getState($chatError), 'Пресет подключения не найден.');
    assert.deepEqual(scope.getState($chatRows).map(({ text }) => text), ['Первое сообщение']);
    await allSettled(chatDraftChanged, { scope, params: 'Второе сообщение' });
    await allSettled(chatSendRequested, { scope });
    assert.equal(scope.getState($chatError), 'Провайдер прервал ответ.');
    assert.equal(scope.getState($chatRows).at(-1)?.text, 'Начало');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
