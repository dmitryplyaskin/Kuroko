import type { PersonaSelection } from '@kuroko/contracts/personas';
import { createEvent, createStore, sample } from 'effector';
import { $activeSession, inActiveSession, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { sessionRequest } from '../../platform/session/request';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { personaEffect, personasPath } from './requests';

const path = `${personasPath}/active`;
type SelectionState = { id?: string | null; pending?: true; savingId?: string; error?: ErrorCode };
export const personaSelectionRequested = createEvent<string>();
export const personaSelectionOpened = createEvent();

const readFx = personaEffect(({ session }: { session: ActiveSession }) => sessionRequest<PersonaSelection>(session, path));
const writeFx = personaEffect(({ session, id }: PersonaSelection & { session: ActiveSession; targetId: string }) =>
  sessionRequest<PersonaSelection>(session, path, { method: 'PUT', body: { id } }));

export const $personaSelection = createStore<SelectionState>({})
  .on(readFx, (current) => ({ id: current.id, pending: true }))
  .on(writeFx, (current, { targetId }) => ({ id: current.id, pending: true, savingId: targetId }))
  .on(inActiveSession(readFx.done, ({ session }) => session), (_, { result }) => result)
  .on(inActiveSession(writeFx.done, ({ session }) => session), (_, { result }) => result)
  .on(inActiveSession(readFx.fail, ({ session }) => session), (current, { error }) => ({ id: current.id, error: errorCode(error) }))
  .on(inActiveSession(writeFx.fail, ({ session }) => session), (current, { error }) => ({ id: current.id, error: errorCode(error) }))
  .reset(sessionEnded);

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
  filter: ({ session, selection }) => session !== null && !selection.pending && selection.id !== undefined,
  fn: ({ session, selection }, targetId) => ({ session: session!, targetId, id: selection.id === targetId ? null : targetId }),
  target: writeFx,
});
