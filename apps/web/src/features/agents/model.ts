import type { AgentDraft, SavedAgent } from '@kuroko/contracts/agents';
import { attach, createEffect, createEvent, createStore, sample } from 'effector';
import { $activeSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { inActiveSession, sessionRequest } from '../../platform/session/request';
import { errorCode, type ErrorCode } from '../../shared/http/api';

type Library = { status: 'idle' | 'loading' | 'ready' | 'error'; agents: SavedAgent[]; error?: ErrorCode };
const path = '/agents';
const initial: Library = { status: 'idle', agents: [] };
export const agentsOpened = createEvent();

const loadFx = createEffect((session: ActiveSession) => sessionRequest<SavedAgent[]>(session, path));
const saveFx = createEffect(({ session, id, draft }: { session: ActiveSession; id?: string; draft: AgentDraft }) =>
  sessionRequest<SavedAgent>(session, id ? `${path}/${encodeURIComponent(id)}` : path, { method: id ? 'PUT' : 'POST', body: draft }));
const removeFx = createEffect(({ session, id }: { session: ActiveSession; id: string }) =>
  sessionRequest<void>(session, `${path}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
const loaded = inActiveSession(loadFx.done, (session) => session);
const failed = inActiveSession(loadFx.fail, (session) => session);
const saved = inActiveSession(saveFx.done, ({ session }) => session);
const removed = inActiveSession(removeFx.done, ({ session }) => session);

export const $agentLibrary = createStore(initial)
  .on(loadFx, (current) => ({ ...current, status: 'loading', error: undefined }))
  .on(loaded, (_, { result }) => ({ status: 'ready', agents: result }))
  .on(failed, (current, { error }) => ({ ...current, status: 'error', error: errorCode(error) }))
  .on(saved, (current, { result }) => ({ ...current, agents: [...current.agents.filter(({ id }) => id !== result.id), result] }))
  .on(removed, (current, { params }) => ({ ...current, agents: current.agents.filter(({ id }) => id !== params.id) }))
  .reset(sessionEnded);

export const saveAgentFx = attach({ effect: saveFx });
export const removeAgentFx = attach({ effect: removeFx });

sample({
  clock: agentsOpened,
  source: { session: $activeSession, library: $agentLibrary },
  filter: ({ session, library }) => session !== null && (library.status === 'idle' || library.status === 'error'),
  fn: ({ session }) => session!,
  target: loadFx,
});
sample({
  clock: [
    failed.map(({ params: session, error }) => ({ session, error })),
    inActiveSession(saveFx.fail, ({ session }) => session).map(({ params: { session }, error }) => ({ session, error })),
    inActiveSession(removeFx.fail, ({ session }) => session).map(({ params: { session }, error }) => ({ session, error })),
  ],
  target: protectedRequestFailed,
});
