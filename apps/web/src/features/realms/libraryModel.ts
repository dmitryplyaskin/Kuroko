import type { Realm, SavedRealm } from '@kuroko/contracts/realms';
import { createEffect, createEvent, createStore, sample } from 'effector';
import { $activeSession, inActiveSession, sessionEnded, type ActiveSession } from '../../platform/session/model';
import { ApiError, errorCode } from '../../shared/http/api';
import {
  $realmEditor, newRealmId, realmEditorCreated, realmEditorOpened, saveRealmFx, type RealmSaveIssue,
} from './model';
import { readRealmFile, type ImportedRealm } from './realmFile';

type FileImport = { file: File; labels: Parameters<typeof readRealmFile>[1] };
type ImportInput = FileImport | { copy: Realm };
type ImportResult = { saved: SavedRealm } | { draft: ImportedRealm } | { copy: Realm };
type ImportState = { pending: boolean; copy?: Realm; issue?: RealmSaveIssue };

export const realmImportPicked = createEvent<FileImport>();
export const realmImportCopyRequested = createEvent();
export const realmImportConflictClosed = createEvent();

const importFx = createEffect(async ({ input, session }: { input: ImportInput; session: ActiveSession }): Promise<ImportResult> => {
  const source = 'file' in input ? await readRealmFile(input.file, input.labels) : { source: 'copy' as const, realm: input.copy };
  session.signal.throwIfAborted();
  if (source.source === 'sillytavern') return { draft: source };
  try {
    return { saved: await saveRealmFx({ session, realm: source.realm }) };
  } catch (error) {
    if (source.source === 'kuroko' && errorCode(error) === 'realm_id_taken') {
      return { copy: { ...source.realm, id: newRealmId() } };
    }
    throw error;
  }
});

const imported = inActiveSession(importFx.done, ({ session }) => session).map(({ result }) => result);
const failed = inActiveSession(importFx.fail, ({ session }) => session);
const initial: ImportState = { pending: false };

export const $realmImport = createStore(initial)
  .on(importFx, (_, { input }) => ({ pending: true, copy: 'copy' in input ? input.copy : undefined }))
  .on(imported, (_, result) => 'copy' in result ? { pending: false, copy: result.copy } : initial)
  .on(failed, (state, { error }) => ({
    ...state, pending: false, issue: { code: errorCode(error), field: error instanceof ApiError ? error.field : undefined },
  }))
  .on(realmImportConflictClosed, (state) => state.pending ? state : initial)
  .reset(sessionEnded);

sample({
  clock: realmImportPicked,
  source: { session: $activeSession, editor: $realmEditor, importing: $realmImport },
  filter: ({ session, editor, importing }) => session !== null && editor === null && !importing.pending,
  fn: ({ session }, input) => ({ session: session!, input }),
  target: importFx,
});
sample({
  clock: realmImportCopyRequested,
  source: { session: $activeSession, importing: $realmImport },
  filter: ({ session, importing }) => session !== null && !importing.pending && importing.copy !== undefined,
  fn: ({ session, importing }) => ({ session: session!, input: { copy: importing.copy! } }),
  target: importFx,
});
sample({ clock: imported.filterMap((result) => 'draft' in result ? result.draft : undefined), target: realmEditorCreated });
sample({ clock: imported.filterMap((result) => 'saved' in result ? result.saved.id : undefined), target: realmEditorOpened });
