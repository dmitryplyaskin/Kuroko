import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allSettled, fork, scopeBind } from 'effector';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ConnectionState } from '@kuroko/contracts/connectionSettings';
import { corePlugin } from '../core';
import { agentDraftChanged, agentEditorClosed, agentEditorOpened } from '../features/agents/model';
import { loadChatSettingsFx } from '../features/chat/settings/model';
import { $connectionLoad, loadConnectionFx } from '../features/connection/model';
import { realmEditorCreated, realmEditorDraftChanged } from '../features/realms/model';
import type { WebModule } from '../modules/contracts';
import { createModuleRegistry } from '../modules/registry';
import { $activeSession, sessionEndRequested, sessionUserReceived } from '../platform/session/model';
import { createWorkspaceModel } from './workspaceModel';

const notesScreen = {
  kind: 'workspace.screen',
  id: 'test.notes.index',
  route: '#notes',
  label: 'scenes.label',
  order: 20,
} as const;

const notesTab = {
  kind: 'settings.tab',
  id: 'test.notes.preferences',
  key: 'notes',
  label: 'scenes.label',
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

  assert.deepEqual(registry.screens.map(({ route }) => route), ['#scenes', '#realms', '#chat', '#notes', '#instructions', '#tools', '#agents', '#settings']);
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
    handlers: [
      [loadChatSettingsFx, () => ({ settings: null, legacy: undefined })],
      [loadConnectionFx, () => ({ activePresetId: null, presets: [], keys: [] })],
    ],
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
  await allSettled(workspace.workspaceHashChanged, { scope, params: '#instructions' });
  assert.equal(scope.getState(workspace.$screen).id, 'kuroko.instructions.index');
  await allSettled(workspace.workspaceHashChanged, { scope, params: '#chat' });
  await allSettled(workspace.workspaceHashChanged, { scope, params: '#settings' });
  assert.ok(scope.getState(workspace.$retainedScreens).has('kuroko.chat.index'));

  await allSettled(sessionEndRequested, { scope, params: { session: scope.getState($activeSession)! } });
  assert.equal(scope.getState(workspace.$retainedScreens).size, 0);
  assert.equal(scope.getState(workspace.$settingsTab), 'appearance');
});

test('opening settings preloads tabs and starts one connection read for the whole visit', async () => {
  let viewLoads = 0;
  let reads = 0;
  const connection = { activePresetId: null, presets: [], keys: [] } satisfies ConnectionState;
  const pending = Promise.withResolvers<ConnectionState>();
  const registry = createModuleRegistry(corePlugin, [notesModule(() => { viewLoads++; })]);
  const workspace = createWorkspaceModel(registry);
  const scope = fork({
    handlers: [[loadConnectionFx, () => ++reads === 1 ? pending.promise : connection]],
  });
  const navigate = scopeBind(workspace.workspaceHashChanged, { scope });
  const selectTab = scopeBind(workspace.settingsTabChanged, { scope });

  await allSettled(sessionUserReceived, { scope, params: { id: 1, username: 'Лина' } });
  assert.equal(reads, 0);
  assert.equal(viewLoads, 0);

  navigate('#settings');
  assert.equal(scope.getState(workspace.$settingsTab), 'appearance');
  assert.equal(reads, 1);
  selectTab('connection');
  selectTab('appearance');
  assert.equal(reads, 1);

  pending.resolve(connection);
  await allSettled(scope);
  assert.equal(viewLoads, 1);
  const notes = registry.settingsTabs.find(({ key }) => key === 'notes');
  assert.ok(notes);
  assert.equal(renderToStaticMarkup(createElement(notes.View)), '');
  await allSettled(workspace.settingsTabChanged, { scope, params: 'connection' });
  assert.deepEqual(scope.getState($connectionLoad), { status: 'ready', data: connection });
  assert.equal(reads, 1);

  await allSettled(workspace.workspaceHashChanged, { scope, params: '#scenes' });
  assert.equal(scope.getState($connectionLoad).status, 'loading');
  await allSettled(workspace.workspaceHashChanged, { scope, params: '#secrets' });
  assert.equal(reads, 2);
  assert.equal(viewLoads, 1);
});

test('registration rejects conflicting contributions and incomplete view bindings', () => {
  const module = notesModule();
  assert.throws(() => createModuleRegistry(corePlugin, [module, module]), { code: 'module_id_duplicate' });
  assert.throws(() => createModuleRegistry(corePlugin, [module, { ...module, id: 'test.other' }]), { code: 'contribution_id_duplicate' });
  assert.throws(() => createModuleRegistry(corePlugin, [{ ...module, views: {} }]), { code: 'module_view_loader_missing' });
  assert.throws(() => createModuleRegistry(corePlugin, [{
    ...module, contributions: [{ ...notesScreen, route: '#secrets' }],
  }]), { code: 'module_key_duplicate', details: { kind: 'workspace_route', key: '#secrets' } });
  assert.throws(() => createModuleRegistry(corePlugin, [{
    ...module, contributions: [{ ...notesTab, key: 'chat' }],
  }]), { code: 'module_key_duplicate', details: { kind: 'settings_tab_key', key: 'chat' } });
});

test('settings retries failed preloads on re-entry and keeps successful views cached', async () => {
  let attempts = 0;
  const registry = createModuleRegistry(corePlugin, [notesModule(() => {
    if (++attempts === 1) throw new Error('Unavailable');
  })]);
  const workspace = createWorkspaceModel(registry);
  const scope = fork({ handlers: [[loadConnectionFx, () => ({ activePresetId: null, presets: [], keys: [] })]] });
  const tab = registry.settingsTabs.find(({ key }) => key === 'notes');
  assert.ok(tab);

  await allSettled(sessionUserReceived, { scope, params: { id: 1, username: 'Лина' } });
  await allSettled(workspace.workspaceHashChanged, { scope, params: '#settings' });
  await assert.rejects(tab.preload(), /Unavailable/);
  assert.equal(attempts, 1);

  await allSettled(workspace.workspaceHashChanged, { scope, params: '#scenes' });
  await allSettled(workspace.workspaceHashChanged, { scope, params: '#settings' });
  assert.equal(renderToStaticMarkup(createElement((await tab.preload()).default)), '');
  assert.equal(attempts, 2);
});

test('workspace keeps its unsaved changes flag when either editor is hidden', async () => {
  const workspace = createWorkspaceModel(createModuleRegistry(corePlugin));
  const scope = fork();
  await allSettled(sessionUserReceived, { scope, params: { id: 1, username: 'Лина' } });
  await allSettled(workspace.workspaceHashChanged, { scope, params: '#agents' });
  await allSettled(agentEditorOpened, { scope, params: undefined });
  await allSettled(agentDraftChanged, { scope, params: { name: 'Летописец' } });
  await allSettled(workspace.workspaceHashChanged, { scope, params: '#tools' });
  assert.equal(scope.getState(workspace.$hasUnsavedChanges), true);

  await allSettled(workspace.workspaceHashChanged, { scope, params: '#realms' });
  await allSettled(realmEditorCreated, { scope, params: undefined });
  await allSettled(realmEditorDraftChanged, { scope, params: { patch: { title: 'Станция' } } });
  await allSettled(workspace.workspaceHashChanged, { scope, params: '#scenes' });
  await allSettled(agentEditorClosed, { scope });
  assert.equal(scope.getState(workspace.$hasUnsavedChanges), true);

  await allSettled(realmEditorDraftChanged, { scope, params: { patch: { title: '' } } });
  assert.equal(scope.getState(workspace.$hasUnsavedChanges), false);
});

test('a failed workspace screen load can be reset and retried', async () => {
  let attempts = 0;
  const registry = createModuleRegistry(corePlugin, [notesModule(() => {
    if (++attempts === 1) throw new Error('Unavailable');
  })]);
  const screen = registry.resolveRoute('#notes').screen;
  await assert.rejects(screen.preload(), /Unavailable/);
  screen.resetFailedLoad();
  assert.equal(renderToStaticMarkup(createElement((await screen.preload()).default)), '');
  assert.equal(attempts, 2);
});
