import { createContext, useContext, type ReactNode } from 'react';
import type { ExtensionKind } from './contracts';
import type { ModuleRegistry } from './registry';

const ExtensionsContext = createContext<ModuleRegistry['getExtensions'] | null>(null);

export function ModuleExtensionsProvider({ registry, children }: { registry: ModuleRegistry; children: ReactNode }) {
  return <ExtensionsContext value={registry.getExtensions}>{children}</ExtensionsContext>;
}

export function useModuleExtensions<K extends ExtensionKind>(kind: K) {
  return useContext(ExtensionsContext)?.(kind) ?? [];
}
