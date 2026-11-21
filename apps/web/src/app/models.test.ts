import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allSettled, fork, scopeBind } from 'effector';
import { defaultChatSettings } from '@kuroko/contracts/chatSettings';
import { defaultConnectionSettings, type ConnectionState } from '@kuroko/contracts/connectionSettings';
import { appStarted } from './lifecycle';
import { ApiError } from '../shared/http/api';
import {
  $activeSession, $session, checkSessionFx, protectedRequestFailed, sessionEndRequested, sessionRetryRequested, sessionUserReceived,
} from '../features/auth/sessionModel';
import {
  $appliedChatSettings, $chatSettingsDirty, $chatSettingsDraft, $chatSettingsSubmission, chatSettingsChanged,
  chatSettingsSaveRequested, loadChatSettingsFx, saveChatSettingsFx,
} from '../features/chat-settings/model';
import {
  $connectionLoad, $connectionSelection, connectionActionRequested, connectionClosed, connectionDraftChanged,
  connectionModelsRequested, connectionOpened, connectionProviderChanged, loadConnectionFx, mutateConnectionFx,
  presetCopyRequested, presetSelected,
} from '../features/connection/model';
import { $modelCatalog, loadModelCatalogFx } from '../features/connection/modelCatalog';
import {
  $chatAnnouncement, $chatAttachmentError, $chatCanSend, $chatRows, $replyId, chatAttachmentSelected,
  chatDraftChanged, chatHidden, chatSendRequested, chatShown, chatStopRequested, messageDeleteRequested, messageEditChanged,
  messageEditRequested, messageEditSubmitted, waitForReplyTickFx,
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
      [loadChatSettingsFx, noChatSettings],
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

  await allSettled(sessionUserReceived, { scope, params: user });
  const oldSession = scope.getState($activeSession)!;
  await allSettled(chatSettingsChanged, { scope, params: { fontSize: 20 } });
  scopeBind(chatSettingsSaveRequested, { scope })();
  assert.equal(scope.getState($chatSettingsSubmission).status, 'saving');
  scopeBind(sessionEndRequested, { scope })({ session: oldSession });
  assert.equal(oldSession.controller.signal.aborted, true);
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
  const scope = fork({ handlers: [[loadChatSettingsFx, noChatSettings], [loadConnectionFx, () => connection]] });
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
      [loadChatSettingsFx, noChatSettings],
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
      [loadChatSettingsFx, noChatSettings],
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

test('mock replies pause when hidden, resume from the same position and retain visible text when stopped', async () => {
  const ticks: (() => void)[] = [];
  const scope = fork({
    handlers: [
      [loadChatSettingsFx, noChatSettings],
      [waitForReplyTickFx, () => new Promise<void>((resolve) => ticks.push(resolve))],
    ],
  });
  await allSettled(sessionUserReceived, { scope, params: user });
  await allSettled(chatShown, { scope });
  await allSettled(chatDraftChanged, { scope, params: 'Привет' });

  const send = scopeBind(chatSendRequested, { scope });
  send();
  send();
  assert.equal(ticks.length, 1);
  assert.equal(scope.getState($chatRows).at(-2)?.text, 'Привет');
  const replyId = scope.getState($replyId);
  ticks.shift()!();
  await Promise.resolve();
  const visible = scope.getState($chatRows).at(-1)?.reasoning;
  assert.equal(visible?.length, 24);
  assert.equal(ticks.length, 1);

  scopeBind(chatHidden, { scope })();
  ticks.shift()!();
  await allSettled(scope);
  assert.equal(scope.getState($chatRows).at(-1)?.reasoning, visible);
  assert.equal(ticks.length, 0);

  scopeBind(chatShown, { scope })();
  assert.equal(ticks.length, 1);
  scopeBind(chatStopRequested, { scope })();
  ticks.shift()!();
  await allSettled(scope);

  assert.equal(scope.getState($replyId), null);
  assert.partialDeepStrictEqual(scope.getState($chatRows).at(-1), { id: replyId, reasoning: visible, text: '' });
  assert.equal(scope.getState($chatAnnouncement), 'Ответ модели остановлен.');
});

test('chat validates attachments and supports editing and deleting a sent message', async () => {
  const scope = fork({ handlers: [[loadChatSettingsFx, noChatSettings]] });
  await allSettled(sessionUserReceived, { scope, params: user });
  await allSettled(chatShown, { scope });

  const invalid = new File(['data'], 'example.txt', { type: 'text/plain' });
  const image = new File(['data'], 'example.png', { type: 'image/png' });
  await allSettled(chatAttachmentSelected, { scope, params: invalid });
  assert.equal(scope.getState($chatCanSend), false);
  assert.notEqual(scope.getState($chatAttachmentError), '');
  await allSettled(chatAttachmentSelected, { scope, params: image });
  assert.equal(scope.getState($chatCanSend), true);

  scopeBind(chatSendRequested, { scope })();
  scopeBind(chatStopRequested, { scope })();
  await allSettled(scope);
  const message = scope.getState($chatRows).at(-1)!;
  assert.partialDeepStrictEqual(message, { role: 'user', image: { file: image }, text: '' });

  await allSettled(messageEditRequested, { scope, params: message.id });
  await allSettled(messageEditChanged, { scope, params: { id: message.id, text: '  Подпись  ' } });
  await allSettled(messageEditSubmitted, { scope, params: message.id });
  assert.partialDeepStrictEqual(scope.getState($chatRows).at(-1), { text: 'Подпись', edited: true });
  await allSettled(messageDeleteRequested, { scope, params: message.id });
  assert.equal(scope.getState($chatRows).some(({ id }) => id === message.id), false);
});
