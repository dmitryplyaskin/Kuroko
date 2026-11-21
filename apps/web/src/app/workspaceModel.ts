import { createEvent, createStore, sample } from 'effector';
import { sessionEnded, sessionStarted } from '../features/auth/sessionModel';
import { createBrowserPreference } from '../shared/browser/preferences';

export type WorkspaceView = 'scenes' | 'chat' | 'settings';
export type SettingsTab = 'appearance' | 'chat' | 'connection';

function readView(hash: string): WorkspaceView {
  switch (hash) {
    case '#chat':
      return 'chat';
    case '#settings':
    case '#appearance':
    case '#secrets':
      return 'settings';
    default:
      return 'scenes';
  }
}

export const workspaceHashChanged = createEvent<string>();
export const settingsTabChanged = createEvent<SettingsTab>();
export const menuToggled = createEvent();

const $hash = createStore('').on(workspaceHashChanged, (_, hash) => hash);
export const $workspaceView = $hash.map(readView);
const workspaceOpened = sample({ clock: sessionStarted, source: $hash });

export const $chatVisited = createStore(false)
  .on(workspaceOpened, (_, hash) => readView(hash) === 'chat')
  .on(workspaceHashChanged, (visited, hash) => visited || readView(hash) === 'chat')
  .reset(sessionEnded);

export const $settingsTab = createStore<SettingsTab>('appearance')
  .on(workspaceOpened, (_, hash) => hash === '#secrets' ? 'connection' : 'appearance')
  .on(workspaceHashChanged, (tab, hash) => hash === '#secrets' ? 'connection' : tab)
  .on(settingsTabChanged, (_, tab) => tab)
  .reset(sessionEnded);

const menu = createBrowserPreference('kuroko-menu-collapsed', false, (value) => value === 'true', String);
export const $menuCollapsed = menu.$value;
sample({ clock: menuToggled, source: $menuCollapsed, fn: (collapsed) => !collapsed, target: menu.changed });
