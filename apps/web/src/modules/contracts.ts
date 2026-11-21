import type { ComponentType } from 'react';

export type ModuleIconName = 'panels' | 'message' | 'settings' | 'palette' | 'plug';

type ViewContribution = {
  id: string;
  label: string;
  order: number;
  icon?: ModuleIconName;
  loadingLabel?: string;
};

export type WorkspaceScreen = ViewContribution & {
  kind: 'workspace.screen';
  route: `#${string}`;
  title?: string;
  layout?: 'page' | 'viewport';
  retainAfterVisit?: boolean;
};

export type SettingsTab = ViewContribution & {
  kind: 'settings.tab';
  key: string;
  description?: string;
};

export type ViewLoader = () => Promise<{ default: ComponentType }>;

export type WebModule = {
  id: string;
  contributions: readonly (WorkspaceScreen | SettingsTab)[];
  views: Readonly<Partial<Record<string, ViewLoader>>>;
};

export type ModuleBundle = {
  id: string;
  modules: readonly WebModule[];
  defaultScreen: string;
  defaultSettingsTab: string;
  routeAliases: readonly { route: `#${string}`; screen: string; settingsTab?: string }[];
};
