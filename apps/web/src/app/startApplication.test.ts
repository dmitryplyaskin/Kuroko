import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allSettled, fork } from 'effector';
import { defaultChatSettings } from '@kuroko/contracts/chatSettings';
import { corePlugin } from '../core';
import { chatModule } from '../features/chat/module';
import { $appliedChatSettings, loadChatSettingsFx } from '../features/chat/settings/model';
import { loadToolSettingsFx } from '../features/tools/model';
import { createModuleRegistry } from '../modules/registry';
import { $activeSession, checkSessionFx, type ActiveSession } from '../platform/session/model';
import { startApplication } from './startApplication';

test('restoring a session loads chat settings once and only in an application with chat', async () => {
  const user = { id: 1, username: 'Лина' };
  const settings = { ...defaultChatSettings, fontSize: 22 };
  const requests: ActiveSession[] = [];
  const createScope = () => fork({
    handlers: [
      [checkSessionFx, () => user],
      [loadToolSettingsFx, () => ({ enabled: [] })],
      [loadChatSettingsFx, (session: ActiveSession) => {
        requests.push(session);
        return { settings, legacy: undefined };
      }],
    ],
  });
  const base = { ...corePlugin, modules: corePlugin.modules.filter((module) => module !== chatModule) };
  const withChat = createScope();
  const withoutChat = createScope();
  const chatRegistry = createModuleRegistry(base, [chatModule]);

  startApplication(chatRegistry, withChat);
  startApplication(chatRegistry, withChat);
  await allSettled(withChat);
  startApplication(chatRegistry, withChat);
  await allSettled(withChat);

  startApplication(createModuleRegistry(base), withoutChat);
  await allSettled(withoutChat);

  const session = withChat.getState($activeSession);
  assert.deepEqual(session?.user, user);
  assert.deepEqual(withoutChat.getState($activeSession)?.user, user);
  assert.notEqual(withoutChat.getState($activeSession), session);
  assert.deepEqual(requests, [session]);
  assert.deepEqual(withChat.getState($appliedChatSettings), settings);
  assert.deepEqual(withoutChat.getState($appliedChatSettings), defaultChatSettings);

  const secondChatScope = createScope();
  startApplication(chatRegistry, secondChatScope);
  await allSettled(secondChatScope);

  const secondSession = secondChatScope.getState($activeSession);
  assert.deepEqual(secondSession?.user, user);
  assert.notEqual(secondSession, session);
  assert.deepEqual(requests, [session, secondSession]);
  assert.deepEqual(secondChatScope.getState($appliedChatSettings), settings);
});
