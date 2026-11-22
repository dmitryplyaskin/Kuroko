import { realmSearchKey } from '@kuroko/contracts/realms';

export function realmFilterKey(value: string) {
  return realmSearchKey(value.trim());
}

export function realmTagKeys(tags: readonly string[]) {
  return JSON.stringify([...new Set(tags.map(realmFilterKey).filter(Boolean))]);
}
