import type { ActiveChatInstruction } from '@kuroko/contracts/instructions';
import { createEffect, createEvent, createStore, sample } from 'effector';
import { $activeSession, inActiveSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { abortFx } from '../../shared/async/abort';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { readChatPrompt } from './chatApi';

type Request = { id: string; session: ActiveSession; controller: AbortController };
type Preview = { request: Request; data?: ActiveChatInstruction } & (
  { status: 'loading' } | { status: 'ready'; data: ActiveChatInstruction } | { status: 'error'; code: ErrorCode }
);

export const promptPreviewRequested = createEvent<string>();
export const promptPreviewHidden = createEvent();

const loadFx = createEffect(({ id, session, controller }: Request) => readChatPrompt(session, id, controller.signal));
export const $promptPreview = createStore<Preview | null>(null)
  .on(loadFx, (state, request) => ({ request, status: 'loading', data: state?.request.id === request.id ? state.data : undefined }))
  .on(inActiveSession(loadFx.done, ({ session }) => session), (state, { params, result }) =>
    state?.request === params ? { request: params, status: 'ready', data: result } : state)
  .reset(sessionEnded);

const started = sample({
  clock: promptPreviewRequested,
  source: { session: $activeSession, state: $promptPreview },
  filter: ({ session }) => session !== null,
  fn: ({ session, state }, id) => ({ previous: state?.request.controller, request: { id, session: session!, controller: new AbortController() } }),
});
sample({ clock: started.filterMap(({ previous }) => previous), target: abortFx });
sample({ clock: started.map(({ request }) => request), target: loadFx });

const cancelled = sample({ clock: promptPreviewHidden, source: $promptPreview }).filterMap((state) => state?.request.controller);
$promptPreview.reset(cancelled);
sample({ clock: cancelled, target: abortFx });

const failed = sample({
  clock: inActiveSession(loadFx.fail, ({ session }) => session), source: $promptPreview,
  filter: (state, { params }) => state?.request === params,
  fn: (_, failure) => failure,
});
$promptPreview.on(failed, (state, { params, error }) => ({ request: params, status: 'error', code: errorCode(error), data: state?.data }));
sample({ clock: failed, fn: ({ params, error }) => ({ session: params.session, error }), target: protectedRequestFailed });
