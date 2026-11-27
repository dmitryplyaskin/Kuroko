import { createBrowserPreference } from '../browser/preferences';

export type LibraryView = 'list' | 'grid';

export function createLibraryViewPreference(key: string) {
  return createBrowserPreference<LibraryView>(key, 'list', (value) => value === 'grid' ? 'grid' : 'list', String);
}
