import { combine, createEffect, createEvent, createStore, sample } from 'effector';
import {
  defaultChatSettings, readChatSettings, sameChatSettings, type ChatColor, type ChatColorScheme,
  type ChatSettings, type ChatSettingsResponse,
} from '@kuroko/contracts/chatSettings';
import { $activeSession, protectedRequestFailed, sessionEnded, sessionStarted, type ActiveSession } from '../../../platform/session/model';
import { readBrowserStorage } from '../../../shared/browser/storage';
import { api, errorMessage } from '../../../shared/http/api';
import { notify } from '../../../shared/notifications/notifications';

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; settings: ChatSettings; fromBrowser: boolean };
type Submission = { status: 'idle' | 'saving' } | { status: 'error'; message: string };
type DraftChange = Partial<Pick<ChatSettings, 'fontSize' | 'width' | 'userSide'>>;
type ColorChange = { scheme: ChatColorScheme; role: ChatColor; color: string };

export const chatSettingsRetryRequested = createEvent();
export const chatSettingsSaveRequested = createEvent();
export const chatSettingsChanged = createEvent<DraftChange>();
export const chatSettingsColorChanged = createEvent<ColorChange>();
export const chatSettingsResetRequested = createEvent();

function readLegacySettings() {
  const stored = readBrowserStorage('kuroko-chat-settings-v1');
  if (!stored) return;
  try {
    return readChatSettings(JSON.parse(stored));
  } catch {
    return undefined;
  }
}

export const loadChatSettingsFx = createEffect(async (session: ActiveSession) => {
  const { settings } = await api<ChatSettingsResponse>('/settings/chat', {
    account: session.user.id, signal: session.signal,
  });
  return { settings, legacy: settings === null ? readLegacySettings() : undefined };
});

export const saveChatSettingsFx = createEffect(async ({ session, draft }: { session: ActiveSession; draft: ChatSettings }) => {
  const { settings } = await api<ChatSettingsResponse>('/settings/chat', {
    method: 'PUT', account: session.user.id, body: draft, signal: session.signal,
  });
  if (!settings) throw new Error('The server did not return the saved chat settings');
  return settings;
});

const loadDone = sample({
  clock: loadChatSettingsFx.done,
  source: $activeSession,
  filter: (current, { params }) => current === params,
  fn: (_, { result }) => result,
});
const loadFailed = sample({
  clock: loadChatSettingsFx.fail,
  source: $activeSession,
  filter: (current, { params }) => current === params,
  fn: (_, { params, error }) => ({ session: params, error }),
});
const saveDone = sample({
  clock: saveChatSettingsFx.done,
  source: $activeSession,
  filter: (current, { params }) => current === params.session,
  fn: (_, { result }) => result,
});
const saveFailed = sample({
  clock: saveChatSettingsFx.fail,
  source: $activeSession,
  filter: (current, { params }) => current === params.session,
  fn: (_, { params, error }) => ({ session: params.session, error }),
});

export const $chatSettingsLoad = createStore<LoadState>({ status: 'loading' })
  .on(loadChatSettingsFx, () => ({ status: 'loading' }))
  .on(loadDone, (_, { settings, legacy }) => ({ status: 'ready', settings: settings ?? defaultChatSettings, fromBrowser: Boolean(legacy) }))
  .on(loadFailed, (_, { error }) => ({ status: 'error', message: errorMessage(error) }))
  .on(saveDone, (_, settings) => ({ status: 'ready', settings, fromBrowser: false }))
  .reset(sessionEnded);
export const $appliedChatSettings = $chatSettingsLoad.map((load) => load.status === 'ready' ? load.settings : defaultChatSettings);

export const $chatSettingsSubmission = createStore<Submission>({ status: 'idle' })
  .on(saveChatSettingsFx, () => ({ status: 'saving' }))
  .on(saveFailed, (_, { error }) => ({ status: 'error', message: errorMessage(error) }))
  .reset(saveDone, sessionEnded);
const $canChange = combine($chatSettingsLoad, $chatSettingsSubmission,
  (load, submission) => load.status === 'ready' && submission.status !== 'saving');
const draftChanged = sample({ clock: chatSettingsChanged, filter: $canChange });
const colorChanged = sample({ clock: chatSettingsColorChanged, filter: $canChange });
const draftReset = sample({ clock: chatSettingsResetRequested, filter: $canChange });
$chatSettingsSubmission.reset(draftChanged, colorChanged, draftReset);

export const $chatSettingsDraft = createStore(defaultChatSettings)
  .on(loadDone, (_, { settings, legacy }) => settings ?? legacy ?? defaultChatSettings)
  .on(saveDone, (_, settings) => settings)
  .on(draftChanged, (draft, change) => ({ ...draft, ...change }))
  .on(colorChanged, (draft, { scheme, role, color }) => ({
    ...draft, colors: { ...draft.colors, [scheme]: { ...draft.colors[scheme], [role]: color.toLowerCase() } },
  }))
  .reset(draftReset, sessionEnded);
export const $chatSettingsDirty = combine($chatSettingsLoad, $chatSettingsDraft,
  (load, draft) => load.status === 'ready' && !sameChatSettings(draft, load.settings));

sample({ clock: sessionStarted, target: loadChatSettingsFx });
sample({
  clock: chatSettingsRetryRequested,
  source: { session: $activeSession, load: $chatSettingsLoad },
  filter: ({ session, load }) => session !== null && load.status === 'error',
  fn: ({ session }) => session!,
  target: loadChatSettingsFx,
});
sample({
  clock: chatSettingsSaveRequested,
  source: { session: $activeSession, draft: $chatSettingsDraft, dirty: $chatSettingsDirty, canChange: $canChange },
  filter: ({ session, dirty, canChange }) => session !== null && dirty && canChange,
  fn: ({ session, draft }) => ({ session: session!, draft }),
  target: saveChatSettingsFx,
});
sample({ clock: [loadFailed, saveFailed], target: protectedRequestFailed });

const notifySettingsSavedFx = createEffect(() => notify({ tone: 'success', message: 'Настройки чата сохранены' }));
sample({ clock: saveDone, fn: () => undefined, target: notifySettingsSavedFx });
