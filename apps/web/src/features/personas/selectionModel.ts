import type { PersonaSelection, PersonaSelectionResult } from '@kuroko/contracts/personas';
import { createEvent, createStore, sample } from 'effector';
import { $activeSession, inActiveSession, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { sessionRequest } from '../../platform/session/request';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { personaEffect, personasPath } from './requests';

const path = `${personasPath}/active`;
type SelectionState = { selected?: PersonaSelectionResult; pending?: true; savingId?: string; error?: ErrorCode };
export const personaSelectionRequested = createEvent<string>();
export const personaSelectionOpened = createEvent();

export function requestPersonaSelection(session: ActiveSession, signal?: AbortSignal) {
  return sessionRequest<PersonaSelectionResult>(session, path, { signal });
}

const readFx = personaEffect(({ session }: { session: ActiveSession }) => requestPersonaSelection(session));
const writeFx = personaEffect(({ session, id }: PersonaSelection & { session: ActiveSession; targetId: string }) =>
  sessionRequest<PersonaSelectionResult>(session, path, { method: 'PUT', body: { id } }));

export const $personaSelection = createStore<SelectionState>({})
  .on(readFx, ({ selected }) => ({ selected, pending: true }))
  .on(writeFx, ({ selected }, { targetId }) => ({ selected, pending: true, savingId: targetId }))
  .on(inActiveSession(readFx.done, ({ session }) => session), (_, { result }) => ({ selected: result }))
  .on(inActiveSession(writeFx.done, ({ session }) => session), (_, { result }) => ({ selected: result }))
  .on(inActiveSession(readFx.fail, ({ session }) => session), ({ selected }, { error }) => ({ selected, error: errorCode(error) }))
  .on(inActiveSession(writeFx.fail, ({ session }) => session), ({ selected }, { error }) => ({ selected, error: errorCode(error) }))
  .reset(sessionEnded);

export const $selectedPersona = $personaSelection.map(({ selected }) => selected && selected.id !== null ? selected : null);

const source = { session: $activeSession, selection: $personaSelection };
sample({
  clock: personaSelectionOpened,
  source,
  filter: ({ session, selection }) => session !== null && !selection.pending,
  fn: ({ session }) => ({ session: session! }),
  target: readFx,
});
sample({
  clock: personaSelectionRequested,
  source,
  filter: ({ session, selection }) => session !== null && !selection.pending && selection.selected !== undefined,
  fn: ({ session, selection }, targetId) => ({ session: session!, targetId, id: selection.selected?.id === targetId ? null : targetId }),
  target: writeFx,
});
