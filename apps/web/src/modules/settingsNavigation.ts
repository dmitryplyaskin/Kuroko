import { createContext, useContext } from 'react';
import type { RegisteredTab } from './registry';

type SettingsNavigation = {
  tabs: readonly RegisteredTab[];
  selectedKey: string;
  selectTab: (key: string) => void;
};

const context = createContext<SettingsNavigation | null>(null);

export const SettingsNavigationProvider = context.Provider;

export function useSettingsNavigation() {
  const navigation = useContext(context);
  if (!navigation) throw new Error('Settings navigation is unavailable');
  return navigation;
}
