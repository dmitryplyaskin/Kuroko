import { readInstructionText, type InstructionDraft, type InstructionSettings } from '@kuroko/contracts/instructions';
import type { PresetAction } from '@kuroko/contracts/presets';
import { attach, createEffect, createEvent, createStore, sample } from 'effector';
import { requestPresetAction } from '../../platform/presets';
import { $activeSession, protectedRequestFailed, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { inActiveSession, sessionRequest } from '../../platform/session/request';
import { errorCode, type ErrorCode } from '../../shared/http/api';

type Change = PresetAction | { kind: 'clear' };
type Draft = InstructionDraft & { worldTitle?: string };
type Editor = { status: 'ready' | 'saving'; data: InstructionSettings; draft: Draft; error?: ErrorCode };
type View = Editor | { status: 'idle' | 'loading' } | { status: 'error'; code: ErrorCode };

const path = '/settings/instructions';
const presetsPath = `${path}/presets`;
export const instructionsOpened = createEvent();
export const instructionDraftChanged = createEvent<Partial<Draft>>();

const loadFx = createEffect((session: ActiveSession) => sessionRequest<InstructionSettings>(session, path));
const saveFx = createEffect(({ session, change, draft }: { session: ActiveSession; change: Change; draft?: InstructionDraft }) => {
  switch (change.kind) {
    case 'create':
      return sessionRequest<InstructionSettings>(session, presetsPath, { method: 'POST', body: { name: change.name, ...draft } });
    case 'update':
      return sessionRequest<InstructionSettings>(session, `${presetsPath}/${encodeURIComponent(change.id)}`, { method: 'PUT', body: draft });
    case 'clear':
      return sessionRequest<InstructionSettings>(session, `${path}/active`, { method: 'DELETE' });
    default:
      return requestPresetAction<InstructionSettings>(session, presetsPath, change);
  }
});

function activeDraft({ activePresetId, presets }: InstructionSettings): Draft {
  const active = presets.find(({ id }) => id === activePresetId);
  return { text: active?.text ?? '', worldId: active?.worldId, worldTitle: active?.worldTitle };
}

const loaded = inActiveSession(loadFx.done, (session) => session);
const loadFailed = inActiveSession(loadFx.fail, (session) => session)
  .map(({ params: session, error }) => ({ session, error }));
const saved = inActiveSession(saveFx.done, ({ session }) => session);
const saveFailed = inActiveSession(saveFx.fail, ({ session }) => session)
  .map(({ params: { session, change }, error }) => ({ session, change, error }));

export const $instructions = createStore<View>({ status: 'idle' })
  .on(loadFx, () => ({ status: 'loading' }))
  .on(loaded, (_, { result }) => ({ status: 'ready', data: result, draft: activeDraft(result) }))
  .on(loadFailed, (_, { error }) => ({ status: 'error', code: errorCode(error) }))
  .on(instructionDraftChanged, (view, patch) => view.status === 'ready' ? { ...view, draft: { ...view.draft, ...patch } } : view)
  .on(saveFx, (view) => view.status === 'ready' ? { ...view, status: 'saving', error: undefined } : view)
  .on(saved, (view, { params: { change }, result }) => {
    const next = activeDraft(result);
    const previous = view.status === 'saving' ? activeDraft(view.data) : undefined;
    const keepDraft = view.status === 'saving' && (change.kind === 'rename' || change.kind === 'copy') &&
      result.activePresetId === view.data.activePresetId && next.text === previous?.text && next.worldId === previous.worldId;
    return { status: 'ready', data: result, draft: keepDraft ? view.draft : next };
  })
  .on(saveFailed, (view, { change, error }) => view.status === 'saving' ? {
    ...view, status: 'ready', error: change.kind === 'clear' ? errorCode(error) : undefined,
  } : view)
  .reset(sessionEnded);

export const changeInstructionFx = attach({
  source: { session: $activeSession, view: $instructions },
  async effect({ session, view }, change: Change) {
    if (!session || view.status !== 'ready') return false;
    const text = readInstructionText(view.draft.text);
    if ((change.kind === 'create' || change.kind === 'update') && !text) return false;
    await saveFx({ session, change, draft: text ? { text, worldId: view.draft.worldId } : undefined });
    return !session.signal.aborted;
  },
});

sample({
  clock: instructionsOpened,
  source: { session: $activeSession, view: $instructions },
  filter: ({ session, view }) => {
    if (!session || view.status === 'loading' || view.status === 'saving') return false;
    if (view.status !== 'ready') return true;
    const initial = activeDraft(view.data);
    return view.draft.text === initial.text && (view.draft.worldId ?? null) === (initial.worldId ?? null);
  },
  fn: ({ session }) => session!,
  target: loadFx,
});
sample({ clock: [loadFailed, saveFailed], target: protectedRequestFailed });
