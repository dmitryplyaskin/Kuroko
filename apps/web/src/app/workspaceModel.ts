import { createEvent, createStore, sample } from 'effector';
import type { ModuleRegistry, RegisteredScreen } from '../modules/registry';
import { sessionEnded, sessionStarted } from '../platform/session/model';
import { createBrowserPreference } from '../shared/browser/preferences';

function visitScreen(visited: ReadonlySet<string>, screen: RegisteredScreen): ReadonlySet<string> {
  return screen.retainAfterVisit && !visited.has(screen.id) ? new Set([...visited, screen.id]) : visited;
}

export function createWorkspaceModel(registry: ModuleRegistry) {
  const workspaceHashChanged = createEvent<string>();
  const settingsTabChanged = createEvent<string>();
  const routeChanged = workspaceHashChanged.map(registry.resolveRoute);
  const $route = createStore(registry.resolveRoute('')).on(routeChanged, (_, route) => route);
  const $screen = $route.map(({ screen }) => screen);
  const workspaceOpened = sample({ clock: sessionStarted, source: $route });

  const $retainedScreens = createStore<ReadonlySet<string>>(new Set())
    .on(workspaceOpened, (_, { screen }) => visitScreen(new Set(), screen))
    .on(routeChanged, (visited, { screen }) => visitScreen(visited, screen))
    .reset(sessionEnded);

  const $settingsTab = createStore(registry.defaultSettingsTab)
    .on(workspaceOpened, (_, route) => route.settingsTab ?? registry.defaultSettingsTab)
    .on(routeChanged, (key, route) => route.settingsTab ?? key)
    .on(settingsTabChanged, (key, next) => registry.hasSettingsTab(next) ? next : key)
    .reset(sessionEnded);

  return { workspaceHashChanged, settingsTabChanged, $screen, $retainedScreens, $settingsTab };
}

export type WorkspaceModel = ReturnType<typeof createWorkspaceModel>;

export const menuToggled = createEvent();
const menu = createBrowserPreference('kuroko-menu-collapsed', false, (value) => value === 'true', String);
export const $menuCollapsed = menu.$value;
sample({ clock: menuToggled, source: $menuCollapsed, fn: (collapsed) => !collapsed, target: menu.changed });
