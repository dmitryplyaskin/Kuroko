import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ModuleBundle, SettingsTab, WebModule, WorkspaceScreen } from './contracts';

type RegisteredView<T> = Readonly<T & {
  moduleId: string;
  View: LazyExoticComponent<ComponentType>;
}>;

export type RegisteredScreen = RegisteredView<WorkspaceScreen>;
export type RegisteredTab = RegisteredView<SettingsTab>;

type WorkspaceRoute = Readonly<{ screen: RegisteredScreen; settingsTab?: string }>;

function addUnique<T>(entries: Map<string, T>, key: string, entry: T, kind: string) {
  if (entries.has(key)) throw new Error(`Duplicate ${kind}: ${key}`);
  entries.set(key, entry);
}

function displayOrder(a: { id: string; order: number }, b: { id: string; order: number }) {
  return a.order - b.order || a.id.localeCompare(b.id, 'en');
}

export function createModuleRegistry(bundle: ModuleBundle, additionalModules: readonly WebModule[] = []) {
  const moduleIds = new Set<string>();
  const contributionIds = new Set<string>();
  const screens = new Map<string, RegisteredScreen>();
  const tabs = new Map<string, RegisteredTab>();
  const routes = new Map<string, WorkspaceRoute>();

  for (const module of [...bundle.modules, ...additionalModules]) {
    if (moduleIds.has(module.id)) throw new Error(`Duplicate module ID: ${module.id}`);
    moduleIds.add(module.id);

    for (const contribution of module.contributions) {
      const { id } = contribution;
      if (contributionIds.has(id)) throw new Error(`Duplicate contribution ID: ${id}`);
      contributionIds.add(id);

      const load = Object.hasOwn(module.views, id) ? module.views[id] : undefined;
      if (!load) throw new Error(`Missing view loader for ${id} in ${module.id}`);
      const view = { moduleId: module.id, View: lazy(load) };

      if (contribution.kind === 'workspace.screen') {
        const screen = { ...contribution, ...view };
        screens.set(id, screen);
        addUnique(routes, screen.route, { screen }, 'workspace route');
      } else {
        addUnique(tabs, contribution.key, { ...contribution, ...view }, 'settings tab key');
      }
    }
  }

  const defaultScreen = screens.get(bundle.defaultScreen);
  if (!defaultScreen) throw new Error(`Unknown default screen in ${bundle.id}: ${bundle.defaultScreen}`);
  if (!tabs.has(bundle.defaultSettingsTab)) {
    throw new Error(`Unknown default settings tab in ${bundle.id}: ${bundle.defaultSettingsTab}`);
  }

  for (const alias of bundle.routeAliases) {
    const screen = screens.get(alias.screen);
    if (!screen) throw new Error(`Unknown screen for ${alias.route}: ${alias.screen}`);
    if (alias.settingsTab !== undefined && !tabs.has(alias.settingsTab)) {
      throw new Error(`Unknown settings tab for ${alias.route}: ${alias.settingsTab}`);
    }
    addUnique(routes, alias.route, { screen, settingsTab: alias.settingsTab }, 'workspace route');
  }

  const defaultRoute: WorkspaceRoute = { screen: defaultScreen };
  const orderedScreens: readonly RegisteredScreen[] = [...screens.values()].sort(displayOrder);
  const orderedTabs: readonly RegisteredTab[] = [...tabs.values()].sort(displayOrder);
  return {
    screens: orderedScreens,
    settingsTabs: orderedTabs,
    defaultSettingsTab: bundle.defaultSettingsTab,
    resolveRoute: (hash: string) => routes.get(hash) ?? defaultRoute,
    hasSettingsTab: (key: string) => tabs.has(key),
  };
}

export type ModuleRegistry = ReturnType<typeof createModuleRegistry>;
