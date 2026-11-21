import { createEffect } from 'effector';

export function readBrowserStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const writeBrowserStorageFx = createEffect(({ key, value }: { key: string; value: string }) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences still work for this visit when storage is unavailable.
  }
});
