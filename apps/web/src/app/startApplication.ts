import { scopeBind, type Scope } from 'effector';
import type { ModuleRegistry } from '../modules/registry';
import { appStarted } from '../platform/lifecycle';

export function startApplication(registry: ModuleRegistry, scope: Scope) {
  registry.initialize(scope);
  scopeBind(appStarted, { scope })();
}
