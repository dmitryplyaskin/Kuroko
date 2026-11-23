import type { MessageKey } from '../shared/i18n/i18n';
import type { ComponentType } from 'react';
import type { EventCallable } from 'effector';

export type ModuleIconName = 'panels' | 'globe' | 'message' | 'settings' | 'palette' | 'plug' | 'tools' | 'agents';

type ViewContribution = {
  id: string;
  label: MessageKey;
  order: number;
  icon?: ModuleIconName;
  loadingLabel?: MessageKey;
};

export type WorkspaceScreen = ViewContribution & {
  kind: 'workspace.screen';
  route: `#${string}`;
  title?: MessageKey;
  layout?: 'page' | 'viewport';
  retainAfterVisit?: boolean;
};

export type SettingsTab = ViewContribution & {
  kind: 'settings.tab';
  key: string;
  description?: MessageKey;
  settingsLifecycle?: { opened: EventCallable<void>; closed: EventCallable<void> };
};

export type ViewLoader = () => Promise<{ default: ComponentType }>;

export interface ExtensionContributions {}

export type ExtensionKind = keyof ExtensionContributions;

export type ExtensionContribution<K extends ExtensionKind = ExtensionKind> = {
  [Kind in K]: ExtensionContributions[Kind] & { kind: Kind; id: string; order: number };
}[K];

export type WebModule = {
  id: string;
  contributions: readonly (WorkspaceScreen | SettingsTab | ExtensionContribution)[];
  views?: Readonly<Partial<Record<string, ViewLoader>>>;
  initialize?: EventCallable<void>;
};

export type ModuleBundle = {
  id: string;
  modules: readonly WebModule[];
  defaultScreen: string;
  defaultSettingsTab: string;
  routeAliases: readonly { route: `#${string}`; screen: string; settingsTab?: string }[];
};
