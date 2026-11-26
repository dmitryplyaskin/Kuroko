import { readInstructionText, type InstructionSettings } from '@kuroko/contracts/instructions';
import type { PresetAction } from '@kuroko/contracts/presets';
import { attach, createEffect, createEvent, createStore, sample } from 'effector';
import { requestPresetAction } from '../../platform/presets';
import { $activeSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { inActiveSession, sessionRequest } from '../../platform/session/request';
import { errorCode, type ErrorCode } from '../../shared/http/api';

type Change = PresetAction | { kind: 'clear' };
type Editor = { status: 'ready' | 'saving'; data: InstructionSettings; draft: string; error?: ErrorCode };
type View = Editor | { status: 'idle' | 'loading' } | { status: 'error'; code: ErrorCode };

const path = '/settings/instructions';
const presetsPath = `${path}/presets`;
export const instructionsOpened = createEvent();
export const instructionDraftChanged = createEvent<string>();

const loadFx = createEffect((session: ActiveSession) => sessionRequest<InstructionSettings>(session, path));
const saveFx = createEffect(({ session, change, text }: { session: ActiveSession; change: Change; text?: string }) => {
  switch (change.kind) {
    case 'create':
      return sessionRequest<InstructionSettings>(session, presetsPath, { method: 'POST', body: { name: change.name, text } });
    case 'update':
      return sessionRequest<InstructionSettings>(session, `${presetsPath}/${encodeURIComponent(change.id)}`, { method: 'PUT', body: { text } });
    case 'clear':
      return sessionRequest<InstructionSettings>(session, `${path}/active`, { method: 'DELETE' });
    default:
      return requestPresetAction<InstructionSettings>(session, presetsPath, change);
  }
});

function activeText({ activePresetId, presets }: InstructionSettings) {
  return presets.find(({ id }) => id === activePresetId)?.text ?? '';
}

const loaded = inActiveSession(loadFx.done, (session) => session);
const loadFailed = inActiveSession(loadFx.fail, (session) => session)
  .map(({ params: session, error }) => ({ session, error }));
const saved = inActiveSession(saveFx.done, ({ session }) => session);
const saveFailed = inActiveSession(saveFx.fail, ({ session }) => session)
  .map(({ params: { session, change }, error }) => ({ session, change, error }));

export const $instructions = createStore<View>({ status: 'idle' })
  .on(loadFx, () => ({ status: 'loading' }))
  .on(loaded, (_, { result }) => ({ status: 'ready', data: result, draft: activeText(result) }))
  .on(loadFailed, (_, { error }) => ({ status: 'error', code: errorCode(error) }))
  .on(instructionDraftChanged, (view, draft) => view.status === 'ready' ? { ...view, draft } : view)
  .on(saveFx, (view) => view.status === 'ready' ? { ...view, status: 'saving', error: undefined } : view)
  .on(saved, (view, { params: { change }, result }) => {
    const text = activeText(result);
    const keepDraft = view.status === 'saving' && (change.kind === 'rename' || change.kind === 'copy') &&
      result.activePresetId === view.data.activePresetId && text === activeText(view.data);
    return { status: 'ready', data: result, draft: keepDraft ? view.draft : text };
  })
  .on(saveFailed, (view, { change, error }) => view.status === 'saving' ? {
    ...view, status: 'ready', error: change.kind === 'clear' ? errorCode(error) : undefined,
  } : view)
  .reset(sessionEnded);

export const changeInstructionFx = attach({
  source: { session: $activeSession, view: $instructions },
  async effect({ session, view }, change: Change) {
    if (!session || view.status !== 'ready') return false;
    const text = readInstructionText(view.draft);
    if ((change.kind === 'create' || change.kind === 'update') && !text) return false;
    await saveFx({ session, change, text });
    return !session.signal.aborted;
  },
});

sample({
  clock: instructionsOpened,
  source: { session: $activeSession, view: $instructions },
  filter: ({ session, view }) => session !== null && view.status !== 'loading' && view.status !== 'saving',
  fn: ({ session }) => session!,
  target: loadFx,
});
sample({ clock: [loadFailed, saveFailed], target: protectedRequestFailed });
