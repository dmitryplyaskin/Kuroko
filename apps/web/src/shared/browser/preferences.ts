import { createEffect, createEvent, createStore, sample } from 'effector';
import { appStarted } from '../../app/lifecycle';
import { readBrowserStorage, writeBrowserStorageFx } from './storage';

export const browserStorageChanged = createEvent<{ key: string | null; value: string | null }>();

export function createBrowserPreference<Value>(
  key: string,
  fallback: Value,
  parse: (value: string | null) => Value,
  serialize: (value: Value) => string,
) {
  const changed = createEvent<Value>();
  const readFx = createEffect(() => parse(readBrowserStorage(key)));
  const changedInAnotherTab = sample({
    clock: browserStorageChanged,
    filter: (change) => change.key === key || change.key === null,
    fn: ({ value }) => parse(value),
  });
  const $value = createStore(fallback)
    .on(readFx.doneData, (_, value) => value)
    .on(changedInAnotherTab, (_, value) => value)
    .on(changed, (_, value) => value);

  sample({ clock: appStarted, target: readFx });
  sample({ clock: changed, fn: (value) => ({ key, value: serialize(value) }), target: writeBrowserStorageFx });

  return { $value, changed };
}
