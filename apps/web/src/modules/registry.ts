import { CodedError } from '@kuroko/contracts/errors';
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { scopeBind, type Scope } from 'effector';
import type { ExtensionContribution, ExtensionKind, ModuleBundle, SettingsTab, WebModule, WorkspaceScreen } from './contracts';

type RegisteredView<T> = Readonly<T & {
  moduleId: string;
  View: LazyExoticComponent<ComponentType>;
}>;

export type RegisteredScreen = RegisteredView<WorkspaceScreen>;
export type RegisteredTab = RegisteredView<SettingsTab>;

type WorkspaceRoute = Readonly<{ screen: RegisteredScreen; settingsTab?: string }>;

function addUnique<T>(entries: Map<string, T>, key: string, entry: T, kind: string) {
  if (entries.has(key)) throw new CodedError('module_key_duplicate', { kind, key });
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
  const extensions = new Map<ExtensionKind, ExtensionContribution[]>();
  const initializers: NonNullable<WebModule['initialize']>[] = [];

  for (const module of [...bundle.modules, ...additionalModules]) {
    if (moduleIds.has(module.id)) throw new CodedError('module_id_duplicate', { moduleId: module.id });
    moduleIds.add(module.id);
    if (module.initialize) initializers.push(module.initialize);

    for (const contribution of module.contributions) {
      const { id } = contribution;
      if (contributionIds.has(id)) throw new CodedError('contribution_id_duplicate', { id });
      contributionIds.add(id);

      if (contribution.kind !== 'workspace.screen' && contribution.kind !== 'settings.tab') {
        const entries = extensions.get(contribution.kind);
        if (entries) entries.push(contribution);
        else extensions.set(contribution.kind, [contribution]);
        continue;
      }

      const load = module.views && Object.hasOwn(module.views, id) ? module.views[id] : undefined;
      if (!load) throw new CodedError('module_view_loader_missing', { id, moduleId: module.id });
      const view = { moduleId: module.id, View: lazy(load) };

      if (contribution.kind === 'workspace.screen') {
        const screen = { ...contribution, ...view };
        screens.set(id, screen);
        addUnique(routes, screen.route, { screen }, 'workspace_route');
      } else {
        addUnique(tabs, contribution.key, { ...contribution, ...view }, 'settings_tab_key');
      }
    }
  }

  const defaultScreen = screens.get(bundle.defaultScreen);
  if (!defaultScreen) throw new CodedError('default_screen_unknown', { bundleId: bundle.id, screen: bundle.defaultScreen });
  if (!tabs.has(bundle.defaultSettingsTab)) {
    throw new CodedError('default_settings_tab_unknown', { bundleId: bundle.id, tab: bundle.defaultSettingsTab });
  }

  for (const alias of bundle.routeAliases) {
    const screen = screens.get(alias.screen);
    if (!screen) throw new CodedError('route_screen_unknown', { route: alias.route, screen: alias.screen });
    if (alias.settingsTab !== undefined && !tabs.has(alias.settingsTab)) {
      throw new CodedError('route_settings_tab_unknown', { route: alias.route, tab: alias.settingsTab });
    }
    addUnique(routes, alias.route, { screen, settingsTab: alias.settingsTab }, 'workspace_route');
  }

  const defaultRoute: WorkspaceRoute = { screen: defaultScreen };
  const orderedScreens: readonly RegisteredScreen[] = [...screens.values()].sort(displayOrder);
  const orderedTabs: readonly RegisteredTab[] = [...tabs.values()].sort(displayOrder);
  for (const entries of extensions.values()) entries.sort(displayOrder);
  return {
    screens: orderedScreens,
    settingsTabs: orderedTabs,
    defaultSettingsTab: bundle.defaultSettingsTab,
    resolveRoute: (hash: string) => routes.get(hash) ?? defaultRoute,
    hasSettingsTab: (key: string) => tabs.has(key),
    initialize: (scope: Scope) => {
      for (const initialize of initializers) scopeBind(initialize, { scope })();
    },
    // Contributions are grouped by their discriminant during registration.
    getExtensions: <K extends ExtensionKind>(kind: K): readonly ExtensionContribution<K>[] =>
      (extensions.get(kind) ?? []) as unknown as readonly ExtensionContribution<K>[],
  };
}

export type ModuleRegistry = ReturnType<typeof createModuleRegistry>;
