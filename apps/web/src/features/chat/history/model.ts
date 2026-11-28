import type { ChatListItem } from '@kuroko/contracts/chat';
import { combine, createEffect, createEvent, createStore, sample, type EventPayload } from 'effector';
import { $activeSession, inActiveSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../../../platform/session/model';
import { abortFx } from '../../../shared/async/abort';
import { errorCode, type ErrorCode } from '../../../shared/http/api';
import { $locale, i18n } from '../../../shared/i18n/i18n';
import { chatApi } from '../chatApi';
import { $chatManager, chatListChanged, chatManagementDialogClosed } from '../model';

export const historySorts = ['updated', 'oldest', 'created', 'name-asc', 'name-desc'] as const;
export const historyPageSize = 16;
export const historyWithoutRealm = ':unlinked';

type Criteria = { q: string; sort: (typeof historySorts)[number]; realm: string };
type Visit = { session: ActiveSession; controller: AbortController };
type HistoryState = { status: 'loading' } | { status: 'ready'; chats: ChatListItem[] } | { status: 'error'; code: ErrorCode };

function applyListChange(chats: ChatListItem[], { summary, copied, deleted }: EventPayload<typeof chatListChanged>) {
  if (copied) return [copied, ...chats.filter(({ id }) => id !== copied.id)];
  if (deleted) return chats.filter(({ id }) => id !== deleted);
  return chats.map((chat) => chat.id === summary?.id ? { ...chat, ...summary } : chat);
}

const defaultCriteria: Criteria = { q: '', sort: 'updated', realm: '' };
export const historyOpened = createEvent();
export const historyClosed = createEvent();
export const historyRetryRequested = createEvent();
export const historyCriteriaChanged = createEvent<Partial<Criteria>>();
export const historyFiltersReset = createEvent();
export const historyPageChanged = createEvent<number>();

const visitStarted = sample({
  clock: historyOpened,
  source: $activeSession,
  filter: (session) => session !== null,
  fn: (session): Visit => ({ session: session!, controller: new AbortController() }),
});
const $visit = createStore<Visit | null>(null).on(visitStarted, (_, visit) => visit);
const visitEnded = sample({ clock: [historyClosed, sessionEnded], source: $visit });
$visit.reset(visitEnded);
sample({ clock: visitEnded.filterMap((visit) => visit?.controller), target: abortFx });

const loadFx = createEffect(({ session, controller }: Visit) => chatApi.list(session, controller.signal));
const finished = inActiveSession(loadFx.finally, ({ session }) => session);
const currentResult = sample({
  clock: finished,
  source: $visit,
  filter: (visit, { params }) => visit === params && !params.controller.signal.aborted,
  fn: (_, result) => result,
});
const response = currentResult.filterMap((result) => result.status === 'done' ? result.result : undefined);
const listChangedDuringLoad = sample({
  clock: chatListChanged, source: loadFx.pending, filter: (loading) => loading, fn: (_, change) => change,
});
const $changesDuringLoad = createStore<EventPayload<typeof chatListChanged>[]>([])
  .on(listChangedDuringLoad, (changes, change) => [...changes, change]).reset(loadFx, visitEnded);
const chatsLoaded = sample({ clock: response, source: $changesDuringLoad, fn: (changes, chats) => changes.reduce(applyListChange, chats) });
$changesDuringLoad.reset(chatsLoaded);
const loadFailed = currentResult.filterMap((result) => result.status === 'fail'
  ? { session: result.params.session, error: result.error } : undefined);

export const $historyState = createStore<HistoryState>({ status: 'loading' })
  .on(loadFx, () => ({ status: 'loading' }))
  .on(chatsLoaded, (_, chats) => ({ status: 'ready', chats }))
  .on(chatListChanged, (state, change) => state.status === 'ready' ? { status: 'ready', chats: applyListChange(state.chats, change) } : state)
  .on(loadFailed, (_, { error }) => ({ status: 'error', code: errorCode(error) }))
  .reset(visitEnded);

sample({ clock: visitStarted, target: loadFx });
sample({
  clock: historyRetryRequested,
  source: { visit: $visit, state: $historyState },
  filter: ({ visit, state }) => visit !== null && state.status === 'error',
  fn: ({ visit }) => visit!,
  target: loadFx,
});
sample({ clock: loadFailed, target: protectedRequestFailed });
sample({
  clock: historyClosed,
  source: $chatManager,
  filter: ({ dialog }) => Boolean(dialog && dialog.kind !== 'list' && dialog.surface === 'history'),
  fn: () => undefined,
  target: chatManagementDialogClosed,
});

export const $historyCriteria = createStore(defaultCriteria)
  .on(historyCriteriaChanged, (criteria, change) => ({ ...criteria, ...change }))
  .on(historyFiltersReset, (criteria) => ({ ...criteria, q: '', realm: '' }))
  .on($historyState.updates, (criteria, state) => state.status === 'ready' && criteria.realm && criteria.realm !== historyWithoutRealm &&
    !state.chats.some(({ realmId }) => realmId === criteria.realm) ? { ...criteria, realm: '' } : criteria)
  .reset(sessionEnded);

const $offset = createStore(0)
  .on(historyPageChanged, (_, offset) => offset)
  .reset($historyCriteria.updates, sessionEnded);

const $historyResults = combine($historyState, $historyCriteria, $locale, (state, { q, sort, realm }, locale) => {
  if (state.status !== 'ready') return null;
  const { t } = i18n[locale];
  const untitled = t('chat.untitled');
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase(locale);
  const needle = normalize(q.trim());
  const worlds = new Map<string, string>();
  for (const { realmId, realmTitle } of state.chats) {
    if (realmId && realmTitle) worlds.set(realmId, realmTitle);
  }
  const chats = state.chats.filter(({ title, realmId, realmTitle }) => {
    const matchesRealm = !realm || (realm === historyWithoutRealm ? !realmId : realmId === realm);
    return matchesRealm && (!needle || normalize(title || untitled).includes(needle) || normalize(realmTitle ?? '').includes(needle));
  });
  const byUpdated = (a: ChatListItem, b: ChatListItem) => b.updatedAt - a.updatedAt;
  const byTitle = (a: ChatListItem, b: ChatListItem) => collator.compare(a.title || untitled, b.title || untitled);
  const compare = {
    updated: byUpdated,
    oldest: (a: ChatListItem, b: ChatListItem) => byUpdated(b, a),
    created: (a: ChatListItem, b: ChatListItem) => b.createdAt - a.createdAt,
    'name-asc': byTitle,
    'name-desc': (a: ChatListItem, b: ChatListItem) => byTitle(b, a),
  }[sort];
  chats.sort((a, b) => compare(a, b) || byUpdated(a, b) || a.id.localeCompare(b.id));
  return {
    chats,
    narrowed: Boolean(needle || realm),
    worlds: Array.from(worlds, ([value, label]) => ({ value, label })).sort((a, b) => collator.compare(a.label, b.label)),
  };
});

export const $historyPage = combine($historyResults, $offset, (results, requestedOffset) => {
  if (!results) return null;
  const total = results.chats.length;
  const offset = Math.min(requestedOffset, Math.floor(Math.max(0, total - 1) / historyPageSize) * historyPageSize);
  return { worlds: results.worlds, narrowed: results.narrowed, total, offset, items: results.chats.slice(offset, offset + historyPageSize) };
});
