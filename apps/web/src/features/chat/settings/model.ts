import { combine, createEffect, createEvent, createStore, sample } from 'effector';
import {
  defaultChatSettings, readChatSettings, sameChatSettings, type ChatColor, type ChatColorScheme,
  type ChatSettings, type ChatSettingsResponse,
} from '@kuroko/contracts/chatSettings';
import { inActiveSession, $activeSession, protectedRequestFailed, sessionEnded, sessionStarted, type ActiveSession } from '../../../platform/session/model';
import { sessionRequest } from '../../../platform/session/request';
import { readBrowserStorage } from '../../../shared/browser/storage';
import { ApiError, errorCode, type ErrorCode } from '../../../shared/http/api';
import { notify } from '../../../shared/notifications/notifications';

type LoadState = { status: 'loading' } | { status: 'error'; code: ErrorCode } | { status: 'ready'; settings: ChatSettings; fromBrowser: boolean };
type Submission = { status: 'idle' | 'saving' } | { status: 'error'; code: ErrorCode };
type DraftChange = Partial<Pick<ChatSettings, 'fontSize' | 'width' | 'userSide'>>;
type ColorChange = { scheme: ChatColorScheme; role: ChatColor; color: string };

export const chatSettingsRetryRequested = createEvent();
export const chatSettingsSaveRequested = createEvent();
export const chatSettingsChanged = createEvent<DraftChange>();
export const chatSettingsColorChanged = createEvent<ColorChange>();
export const chatSettingsResetRequested = createEvent();
export const chatSettingsInitialized = createEvent();
const $chatSettingsEnabled = createStore(false).on(chatSettingsInitialized, () => true);

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
  const { settings } = await sessionRequest<ChatSettingsResponse>(session, '/settings/chat');
  return { settings, legacy: settings === null ? readLegacySettings() : undefined };
});

export const saveChatSettingsFx = createEffect(async ({ session, draft }: { session: ActiveSession; draft: ChatSettings }) => {
  const { settings } = await sessionRequest<ChatSettingsResponse>(session, '/settings/chat', {
    method: 'PUT', body: draft,
  });
  if (!settings) throw new ApiError(200, 'invalid_response');
  return settings;
});

const loadDone = inActiveSession(loadChatSettingsFx.done, (session) => session).map(({ result }) => result);
const loadFailed = inActiveSession(loadChatSettingsFx.fail, (session) => session)
  .map(({ params, error }) => ({ session: params, error }));
const saveDone = inActiveSession(saveChatSettingsFx.done, ({ session }) => session).map(({ result }) => result);
const saveFailed = inActiveSession(saveChatSettingsFx.fail, ({ session }) => session)
  .map(({ params, error }) => ({ session: params.session, error }));

export const $chatSettingsLoad = createStore<LoadState>({ status: 'loading' })
  .on(loadChatSettingsFx, () => ({ status: 'loading' }))
  .on(loadDone, (_, { settings, legacy }) => ({ status: 'ready', settings: settings ?? defaultChatSettings, fromBrowser: Boolean(legacy) }))
  .on(loadFailed, (_, { error }) => ({ status: 'error', code: errorCode(error) }))
  .on(saveDone, (_, settings) => ({ status: 'ready', settings, fromBrowser: false }))
  .reset(sessionEnded);
export const $appliedChatSettings = $chatSettingsLoad.map((load) => load.status === 'ready' ? load.settings : defaultChatSettings);

export const $chatSettingsSubmission = createStore<Submission>({ status: 'idle' })
  .on(saveChatSettingsFx, () => ({ status: 'saving' }))
  .on(saveFailed, (_, { error }) => ({ status: 'error', code: errorCode(error) }))
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

sample({ clock: sessionStarted, filter: $chatSettingsEnabled, target: loadChatSettingsFx });
sample({
  clock: chatSettingsRetryRequested,
  source: { enabled: $chatSettingsEnabled, session: $activeSession, load: $chatSettingsLoad },
  filter: ({ enabled, session, load }) => enabled && session !== null && load.status === 'error',
  fn: ({ session }) => session!,
  target: loadChatSettingsFx,
});
sample({
  clock: chatSettingsSaveRequested,
  source: { enabled: $chatSettingsEnabled, session: $activeSession, draft: $chatSettingsDraft, dirty: $chatSettingsDirty, canChange: $canChange },
  filter: ({ enabled, session, dirty, canChange }) => enabled && session !== null && dirty && canChange,
  fn: ({ session, draft }) => ({ session: session!, draft }),
  target: saveChatSettingsFx,
});
sample({ clock: [loadFailed, saveFailed], target: protectedRequestFailed });

const notifySettingsSavedFx = createEffect(() => notify({ tone: 'success', message: 'chatSettings.saved' }));
sample({ clock: saveDone, fn: () => undefined, target: notifySettingsSavedFx });
