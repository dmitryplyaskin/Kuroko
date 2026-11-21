import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allSettled, createWatch, fork, scopeBind } from 'effector';
import type { ChatSnapshot, SavedChat } from '@kuroko/contracts/chat';
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
  $chatAnnouncement, $chatError, $chatId, $chatRows, $replyId, chatCreateRequested, chatDraftChanged,
  chatOpenRequested, chatSendRequested, chatShown, chatStopRequested, chatTestToolsChanged,
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

  oldSave.reject(new ApiError(401, 'auth_required'));
  await allSettled(scope);

  assert.equal(scope.getState($session).status, 'authenticated');
  assert.notEqual(scope.getState($activeSession), oldSession);
  assert.equal(scope.getState($chatSettingsSubmission).status, 'idle');
  assert.deepEqual(scope.getState($appliedChatSettings), defaultChatSettings);

  await allSettled(protectedRequestFailed, {
    scope, params: { session: scope.getState($activeSession)!, error: new ApiError(401, 'auth_required') },
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

function withSavedChats(generate: typeof fetch): typeof fetch {
  const chats: SavedChat[] = [];
  return async (input, init) => {
    if (input === '/api/chats') {
      if (init?.method === 'GET') return Response.json(chats.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })));
      assert.equal(init?.method, 'POST');
      const chat = { id: String(chats.length + 1), title: '', updatedAt: Date.now(), revision: 0, messages: [] };
      chats.unshift(chat);
      return Response.json(chat, { status: 201 });
    }
    if (typeof input === 'string' && input.startsWith('/api/chats/')) {
      const index = chats.findIndex((chat) => `/api/chats/${chat.id}` === input);
      assert.ok(index >= 0);
      const chat = chats[index]!;
      if (init?.method === 'GET') return Response.json(chat);
      assert.equal(init?.method, 'PUT');
      const { revision, messages } = JSON.parse(String(init.body)) as ChatSnapshot;
      assert.equal(revision, chat.revision);
      const saved = { ...chat, revision: revision + 1, messages };
      chats[index] = saved;
      return Response.json(saved);
    }
    return generate(input, init);
  };
}

test('chat streams replies, restores separate chats, and sends the selected conversation history', async () => {
  const payloads: unknown[] = [];
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = withSavedChats(async (input, init) => {
    assert.equal(input, '/api/llm/generate');
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Accept'), 'text/event-stream');
    assert.equal(headers.get('X-Kuroko-Request'), '1');
    assert.equal(headers.get('X-Kuroko-Account'), String(user.id));
    payloads.push(JSON.parse(String(init?.body)));
    return new Response(payloads.length === 1 ? stream.readable : completed('Второй ответ.'), { headers: sseHeaders });
  });
  const scope = await openChat();
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
    const first = scope.getState($chatId);
    await allSettled(chatCreateRequested, { scope });
    const second = scope.getState($chatId);
    assert.notEqual(first, second);
    assert.deepEqual(scope.getState($chatRows), []);
    const reloaded = await openChat();
    assert.equal(reloaded.getState($chatId), second);
    await allSettled(chatOpenRequested, { scope: reloaded, params: first });
    assert.deepEqual(reloaded.getState($chatRows).map(({ text }) => text), ['Привет', 'Привет!']);
    await allSettled(chatDraftChanged, { scope: reloaded, params: 'Второй запрос' });
    await allSettled(chatSendRequested, { scope: reloaded });
    assert.deepEqual(reloaded.getState($chatRows).map(({ text }) => text), ['Привет', 'Привет!', 'Второй запрос', 'Второй ответ.']);
    assert.deepEqual(payloads, [
      { stream: true, messages: [{ role: 'user', content: 'Привет' }] },
      { stream: true, messages: [
        { role: 'user', content: 'Привет' }, { role: 'assistant', parts: [{ type: 'text', text: 'Привет!' }] },
        { role: 'user', content: 'Второй запрос' },
      ] },
    ]);
    await allSettled(chatOpenRequested, { scope: reloaded, params: second });
    assert.deepEqual(reloaded.getState($chatRows), []);
  } finally {
    unwatch();
    globalThis.fetch = originalFetch;
    void writer.abort().catch(() => undefined);
  }
});

test('chat stops the request, retains the visible answer and ignores late frames', async () => {
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  const originalFetch = globalThis.fetch;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = withSavedChats(async (_input, init) => {
    signal = init?.signal;
    return new Response(stream.readable, { headers: sseHeaders });
  });
  const scope = await openChat();
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
    assert.equal(scope.getState($chatAnnouncement), 'chat.announcementStopped');

    await writer.write(encode(sse({ type: 'text_delta', text: ' и продолжение' }) + completed('Поздний ответ')));
    void writer.close().catch(() => undefined);
    await allSettled(scope);
    assert.equal(scope.getState($chatRows).at(-1)?.text, 'Начало');
    assert.equal(scope.getState($chatError), null);
    const message = scope.getState($chatRows)[0]!;
    await allSettled(messageEditRequested, { scope, params: message.id });
    await allSettled(messageEditChanged, { scope, params: { id: message.id, text: '  Правка  ' } });
    await allSettled(messageEditSubmitted, { scope, params: message.id });
    assert.partialDeepStrictEqual(scope.getState($chatRows)[0], { text: 'Правка', edited: true });
    await allSettled(messageDeleteRequested, { scope, params: message.id });
    assert.deepEqual(scope.getState($chatRows).map(({ text }) => text), ['Начало']);
    const reloaded = await openChat();
    assert.deepEqual(reloaded.getState($chatRows).map(({ text }) => text), ['Начало']);
  } finally {
    unwatch();
    globalThis.fetch = originalFetch;
    void writer.abort().catch(() => undefined);
  }
});

test('chat displays connection and stream errors and keeps partial text', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = withSavedChats(async () => {
    if (++requests === 1) return Response.json({ code: 'missing_preset' }, { status: 404 });
    return new Response(sse({ type: 'text_delta', text: 'Начало' }) +
      sse({ type: 'error', code: 'provider_unavailable' }), { headers: sseHeaders });
  });
  const scope = await openChat();
  try {
    await allSettled(chatDraftChanged, { scope, params: 'Первое сообщение' });
    await allSettled(chatSendRequested, { scope });
    assert.equal(scope.getState($chatError), 'missing_preset');
    assert.deepEqual(scope.getState($chatRows).map(({ text }) => text), ['Первое сообщение']);
    await allSettled(chatDraftChanged, { scope, params: 'Второе сообщение' });
    await allSettled(chatSendRequested, { scope });
    assert.equal(scope.getState($chatError), 'provider_unavailable');
    assert.equal(scope.getState($chatRows).at(-1)?.text, 'Начало');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('test tools return their results to the model and keep every invocation in order after reopening', async () => {
  const originalFetch = globalThis.fetch;
  const presetId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const echoArgs = { text: 'Проверка 🐸' };
  const echo = { type: 'toolCall', id: 'echo-1', name: 'test_echo', arguments: echoArgs };
  const dice = { type: 'toolCall', id: 'dice-1', name: 'roll_dice', arguments: { sides: 20 } };
  const invalid = { ...dice, id: 'dice-2', arguments: { sides: 0 } };
  const defaultDice = { ...dice, id: 'dice-3', arguments: {} };
  const toolRequest = { role: 'assistant', parts: [echo, dice, invalid, defaultDice], openrouterReasoning: [{ type: 'reasoning.encrypted', data: 'signed-data' }] };
  const prompt = { role: 'user', content: 'Вызови test_echo и брось кубики' };
  const followUp = { role: 'user', content: 'Что выпало на d20?' };
  let roll = 0;
  let defaultRoll = 0;
  let requests = 0;
  globalThis.fetch = withSavedChats(async (input, init) => {
    assert.equal(input, '/api/llm/generate');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, true);
    requests++;
    if (requests === 3) {
      assert.equal(body.tools, undefined);
      assert.deepEqual(body.messages[0], prompt);
      assert.ok(body.messages[1].parts[0].text.includes(`roll_dice({"sides":20}) returned {"sides":20,"roll":${roll}}`));
      assert.deepEqual(body.messages[2], followUp);
      return new Response(completed(`${roll}`), { headers: sseHeaders });
    }
    assert.deepEqual(body.tools.map(({ name }: { name: string }) => name), ['test_echo', 'roll_dice']);
    if (requests === 1) {
      assert.deepEqual(body.messages, [prompt]);
      assert.equal(body.presetId, undefined);
      return new Response(sse({ type: 'tool_call', call: echo }) + sse({
        type: 'done', completion: { presetId, message: toolRequest, finishReason: 'tool_calls' },
      }), { headers: sseHeaders });
    }
    assert.equal(body.presetId, presetId);
    assert.equal(body.toolChoice, 'none');
    const [, , echoResult, diceResult, invalidResult, defaultResult] = body.messages;
    roll = diceResult.content.roll;
    defaultRoll = defaultResult.content.roll;
    assert.ok(Number.isInteger(roll) && roll >= 1 && roll <= 20);
    assert.ok(Number.isInteger(defaultRoll) && defaultRoll >= 1 && defaultRoll <= 6);
    assert.deepEqual(body.messages.slice(0, 2), [prompt, toolRequest]);
    assert.deepEqual(echoResult, { role: 'tool', callId: echo.id, content: echoArgs });
    assert.deepEqual(diceResult, { role: 'tool', callId: dice.id, content: { sides: 20, roll } });
    assert.deepEqual(invalidResult, { role: 'tool', callId: invalid.id, content: 'Set sides to an integer between 2 and 1000.', isError: true });
    assert.deepEqual(defaultResult, { role: 'tool', callId: defaultDice.id, content: { sides: 6, roll: defaultRoll } });
    return new Response(completed('Готово'), { headers: sseHeaders });
  });
  try {
    const scope = await openChat();
    await allSettled(chatTestToolsChanged, { scope, params: true });
    await allSettled(chatDraftChanged, { scope, params: prompt.content });
    await allSettled(chatSendRequested, { scope });
    assert.equal(requests, 2);
    assert.deepEqual(scope.getState($chatRows).map(({ text }) => text), [prompt.content, 'Готово']);
    const reloaded = await openChat();
    assert.deepEqual(reloaded.getState($chatRows).at(-1)?.toolCalls, [
      { id: echo.id, name: echo.name, arguments: echo.arguments, result: echoArgs },
      { id: dice.id, name: dice.name, arguments: dice.arguments, result: { sides: 20, roll } },
      { id: invalid.id, name: invalid.name, arguments: invalid.arguments, result: 'Set sides to an integer between 2 and 1000.', isError: true },
      { id: defaultDice.id, name: defaultDice.name, arguments: {}, result: { sides: 6, roll: defaultRoll } },
    ]);
    await allSettled(chatDraftChanged, { scope: reloaded, params: followUp.content });
    await allSettled(chatSendRequested, { scope: reloaded });
    assert.equal(requests, 3);
    assert.equal(reloaded.getState($chatRows).at(-1)?.text, `${roll}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
