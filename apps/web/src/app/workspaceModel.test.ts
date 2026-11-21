import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allSettled, fork } from 'effector';
import { corePlugin } from '../core';
import { loadChatSettingsFx } from '../features/chat/settings/model';
import type { WebModule } from '../modules/contracts';
import { createModuleRegistry } from '../modules/registry';
import { $activeSession, sessionEndRequested, sessionUserReceived } from '../platform/session/model';
import { createWorkspaceModel } from './workspaceModel';

const notesScreen = {
  kind: 'workspace.screen',
  id: 'test.notes.index',
  route: '#notes',
  label: 'Заметки',
  order: 20,
} as const;

const notesTab = {
  kind: 'settings.tab',
  id: 'test.notes.preferences',
  key: 'notes',
  label: 'Заметки',
  order: 20,
} as const;

function notesModule(onLoad = () => {}) {
  const load = async () => {
    onLoad();
    return { default: () => null };
  };
  return {
    id: 'test.notes',
    contributions: [notesScreen, notesTab],
    views: { [notesScreen.id]: load, [notesTab.id]: load },
  } satisfies WebModule;
}

test('a module outside the core bundle adds a lazy screen and a selectable settings tab', async () => {
  let loads = 0;
  const registry = createModuleRegistry(corePlugin, [notesModule(() => { loads += 1; })]);
  const workspace = createWorkspaceModel(registry);
  const scope = fork();

  assert.deepEqual(registry.screens.map(({ route }) => route), ['#scenes', '#chat', '#notes', '#settings']);
  assert.deepEqual(registry.settingsTabs.map(({ key }) => key), ['appearance', 'chat', 'notes', 'connection']);

  await allSettled(workspace.workspaceHashChanged, { scope, params: '#notes' });
  assert.equal(scope.getState(workspace.$screen).moduleId, 'test.notes');
  await allSettled(workspace.settingsTabChanged, { scope, params: 'notes' });
  await allSettled(workspace.settingsTabChanged, { scope, params: 'unregistered' });
  assert.equal(scope.getState(workspace.$settingsTab), 'notes');
  assert.equal(loads, 0);
});

test('unknown addresses fall back and legacy aliases retain their existing settings behavior', async () => {
  const workspace = createWorkspaceModel(createModuleRegistry(corePlugin));
  const scope = fork({
    handlers: [[loadChatSettingsFx, () => ({ settings: null, legacy: undefined })]],
  });

  await allSettled(workspace.workspaceHashChanged, { scope, params: '#secrets' });
  await allSettled(sessionUserReceived, { scope, params: { id: 1, username: 'Лина' } });
  assert.equal(scope.getState(workspace.$screen).route, '#settings');
  assert.equal(scope.getState(workspace.$settingsTab), 'connection');

  await allSettled(workspace.settingsTabChanged, { scope, params: 'chat' });
  await allSettled(workspace.workspaceHashChanged, { scope, params: '#appearance' });
  assert.equal(scope.getState(workspace.$screen).route, '#settings');
  assert.equal(scope.getState(workspace.$settingsTab), 'chat');

  await allSettled(workspace.workspaceHashChanged, { scope, params: '#unknown' });
  assert.equal(scope.getState(workspace.$screen).route, '#scenes');
  await allSettled(workspace.workspaceHashChanged, { scope, params: '#chat' });
  await allSettled(workspace.workspaceHashChanged, { scope, params: '#settings' });
  assert.ok(scope.getState(workspace.$retainedScreens).has('kuroko.chat.index'));

  await allSettled(sessionEndRequested, { scope, params: { session: scope.getState($activeSession)! } });
  assert.equal(scope.getState(workspace.$retainedScreens).size, 0);
  assert.equal(scope.getState(workspace.$settingsTab), 'appearance');
});

test('registration rejects conflicting contributions and incomplete view bindings', () => {
  const module = notesModule();
  assert.throws(() => createModuleRegistry(corePlugin, [module, module]), /Duplicate module ID/);
  assert.throws(() => createModuleRegistry(corePlugin, [module, { ...module, id: 'test.other' }]), /Duplicate contribution ID/);
  assert.throws(() => createModuleRegistry(corePlugin, [{ ...module, views: {} }]), /Missing view loader/);
  assert.throws(() => createModuleRegistry(corePlugin, [{
    ...module, contributions: [{ ...notesScreen, route: '#secrets' }],
  }]), /Duplicate workspace route/);
  assert.throws(() => createModuleRegistry(corePlugin, [{
    ...module, contributions: [{ ...notesTab, key: 'chat' }],
  }]), /Duplicate settings tab key/);
});
