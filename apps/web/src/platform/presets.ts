import { readPresetName, type Preset, type PresetAction, type PresetManagementAction } from '@kuroko/contracts/presets';
import { createEffect, createEvent, createStore, sample, type Event } from 'effector';
import { ApiError, errorCode, type ErrorCode } from '../shared/http/api';
import { $activeSession, inActiveSession, sessionEnded, type ActiveSession } from './session/model';
import { sessionRequest } from './session/request';

export function requestPresetAction<State>(session: ActiveSession, path: string, action: PresetManagementAction) {
  const presetPath = `${path}/${encodeURIComponent(action.id)}`;
  switch (action.kind) {
    case 'apply':
      return sessionRequest<State>(session, `${presetPath}/apply`, { method: 'PUT' });
    case 'delete':
      return sessionRequest<State>(session, presetPath, { method: 'DELETE' });
    case 'rename':
    case 'copy':
      return sessionRequest<State>(session, `${presetPath}/${action.kind}`, {
        method: action.kind === 'copy' ? 'POST' : 'PUT', body: { name: action.name },
      });
  }
}

type PresetDialog = { kind: 'create' } | { kind: 'rename' | 'copy' | 'delete'; preset: Preset };
type Submission = { status: 'idle' } | { status: 'pending'; request: PresetRequest }
  | { status: 'done'; action: PresetAction['kind'] } | { status: 'error'; code: ErrorCode };
type PresetRequest = { session: ActiveSession; action: PresetAction };
type PresetControlsState = { dialog: PresetDialog | null; name: string; submission: Submission };

export type PresetControlsModel = ReturnType<typeof createPresetControlsModel>;

export function createPresetControlsModel(run: (action: PresetAction) => Promise<unknown>, reset?: Event<void>) {
  const opened = createEvent<PresetDialog>();
  const closed = createEvent();
  const nameChanged = createEvent<string>();
  const requested = createEvent<PresetAction>();
  const submitted = createEvent();
  const submitFx = createEffect(async ({ action }: PresetRequest) => {
    if ('name' in action) {
      const name = readPresetName(action.name);
      if (!name) throw new ApiError(400, 'preset_name_invalid');
      return Boolean(await run({ ...action, name }));
    }
    return Boolean(await run(action));
  });

  const initial: PresetControlsState = { dialog: null, name: '', submission: { status: 'idle' } };
  const $state = createStore(initial)
    .on(opened, (state, dialog) => state.submission.status === 'pending' ? state : {
      ...initial, dialog, name: dialog.kind === 'rename' ? dialog.preset.name : '',
    })
    .on(closed, (state) => state.submission.status === 'pending' ? state : initial)
    .on(nameChanged, (state, name) => state.dialog && state.submission.status !== 'pending'
      ? { ...state, name, submission: { status: 'idle' } } : state)
    .on(submitFx, (state, request) => ({ ...state, submission: { status: 'pending', request } }))
    .on(inActiveSession(submitFx.done, ({ session }) => session), (state, { params, result }) => {
      if (state.submission.status !== 'pending' || state.submission.request !== params) return state;
      return result ? { ...initial, submission: { status: 'done', action: params.action.kind } }
        : { ...state, submission: { status: 'idle' } };
    })
    .on(inActiveSession(submitFx.fail, ({ session }) => session), (state, { params, error }) =>
      state.submission.status === 'pending' && state.submission.request === params
        ? { ...state, submission: { status: 'error', code: errorCode(error) } } : state)
    .reset(sessionEnded);
  if (reset) $state.reset(reset);

  const dialogAction = sample({ clock: submitted, source: $state, fn: ({ dialog, name }): PresetAction | undefined => {
    if (!dialog) return;
    if (dialog.kind === 'create') return { kind: 'create', name };
    if (dialog.kind === 'delete') return { kind: 'delete', id: dialog.preset.id };
    return { kind: dialog.kind, id: dialog.preset.id, name };
  } }).filterMap((action) => action);

  sample({
    clock: [requested, dialogAction],
    source: { session: $activeSession, state: $state },
    filter: ({ session, state }) => session !== null && state.submission.status !== 'pending',
    fn: ({ session }, action) => ({ session: session!, action }),
    target: submitFx,
  });

  return { $state, opened, closed, nameChanged, requested, submitted };
}
