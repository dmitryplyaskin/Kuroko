import { Button, Modal, TagsInput, Textarea, TextInput } from '@mantine/core';
import { readRealm, realmSpecVersion, type Realm, type RealmStart, type SavedRealm } from '@kuroko/contracts/realms';
import { useUnit } from 'effector-react';
import { ArrowLeft, Download, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ActiveSession } from '../../platform/session/model';
import { ApiError, errorCode, type ErrorCode } from '../../shared/http/api';
import { useI18n, type MessageKey } from '../../shared/i18n/i18n';
import { deleteRealmFx, newRealmId, saveRealmFx } from './model';
import { AvatarEditor, PreviewableRealmAvatar } from './RealmAvatar';
import { getRealmSection, RealmContents, realmParts, sectionPart, type RealmPart } from './RealmContents';
import { RealmFavoriteButton } from './RealmFavoriteButton';
import { EntriesEditor, RecordEditor, StartFields } from './RealmFields';
import { downloadRealmFile, type ImportedRealm } from './realmFile';

type SaveIssue = { code: ErrorCode; field?: string };

export function RealmEditor({ session, initialSaved, imported, onClose }: {
  session: ActiveSession;
  initialSaved?: SavedRealm;
  imported?: ImportedRealm;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [save, remove] = useUnit([saveRealmFx, deleteRealmFx]);
  const [saved, setSaved] = useState(initialSaved);
  const [blank] = useState<Realm>(() => imported?.realm ??
    ({ specVersion: realmSpecVersion, id: initialSaved?.realm.id ?? newRealmId(), title: '', base: '' }));
  const initial = saved?.realm ?? blank;
  const [draft, setDraft] = useState(initial);
  const [part, onPart] = useState<RealmPart>('base');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [avatarPending, setAvatarPending] = useState(false);
  const [issue, setIssue] = useState<SaveIssue | null>(null);
  const [dialog, setDialog] = useState<'discard' | 'leave' | 'delete' | null>(null);
  const [deleteError, setDeleteError] = useState<ErrorCode | null>(null);
  const [saveNotice, setSaveNotice] = useState(false);
  const [favorite, setFavorite] = useState<boolean | null>(null);
  const [favoriteError, setFavoriteError] = useState<ErrorCode | null>(null);
  const focusSection = useRef<string>(null);
  const dirty = draft !== initial;
  const unsavedImport = Boolean(imported && !saved);
  const section = getRealmSection(draft, part);
  const busy = saving || deleting || avatarPending;

  useEffect(() => {
    if (!dirty && !unsavedImport) return;
    const confirmUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', confirmUnload);
    return () => window.removeEventListener('beforeunload', confirmUnload);
  }, [dirty, unsavedImport]);

  function patch(patch: Partial<Realm>, removed?: boolean) {
    setDraft((current) => {
      const next = { ...current, ...patch };
      return removed ? pruneReferences(next) : next;
    });
    setIssue(null);
    setSaveNotice(false);
  }

  function showIssue(problem: SaveIssue) {
    setIssue(problem);
    if (!problem.field) return;
    const [, field, index] = problem.field.split('/');
    const invalidSection = field === 'sections' ? draft.sections?.[Number(index)] : undefined;
    onPart(invalidSection ? sectionPart(invalidSection.id) : realmParts.find((part) => part === field) ?? 'base');
  }

  function createSection() {
    const id = newRealmId();
    focusSection.current = id;
    patch({ sections: [...(draft.sections ?? []), { id, title: '', entries: [] }] });
    onPart(sectionPart(id));
  }

  function deleteSection(id: string) {
    patch({ sections: draft.sections?.filter((entry) => entry.id !== id) }, true);
    onPart('base');
  }

  function validateDraft() {
    const validated = readRealm({
      ...draft, title: draft.title.trim(), sections: draft.sections?.map((entry) => ({ ...entry, title: entry.title.trim() })),
    });
    if ('realm' in validated) {
      setIssue(null);
      return validated.realm;
    }
    showIssue(validated);
  }

  function exportCard() {
    const realm = validateDraft();
    if (!realm) return;
    try {
      downloadRealmFile(realm);
    } catch (error) {
      showIssue({ code: error instanceof ApiError ? error.code : 'realm_file_download_failed' });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!dirty && saved) {
      setSaveNotice(true);
      return;
    }
    const realm = validateDraft();
    if (!realm) return;
    setSaving(true);
    try {
      const updated = await save({ session, saved, realm });
      if (session.signal.aborted) return;
      setSaved(updated);
      setDraft(updated.realm);
      setSaveNotice(true);
    } catch (error) {
      if (!session.signal.aborted) showIssue({ code: errorCode(error), field: error instanceof ApiError ? error.field : undefined });
    } finally {
      if (!session.signal.aborted) setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!saved || busy) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await remove({ session, id: saved.id, revision: saved.revision });
      if (!session.signal.aborted) onClose();
    } catch (error) {
      if (session.signal.aborted) return;
      const code = errorCode(error);
      if (code === 'realm_not_found') onClose();
      else setDeleteError(code);
    } finally {
      if (!session.signal.aborted) setDeleting(false);
    }
  }

  function discardChanges() {
    if (dialog === 'leave') {
      onClose();
      return;
    }
    setDraft(initial);
    setIssue(null);
    setDialog(null);
    if (section && !getRealmSection(initial, part)) onPart('base');
  }

  const [, invalidPart, invalidRecord, , invalidEntry] = issue?.field?.split('/') ?? [];
  const invalidIndex = part === invalidPart && invalidRecord !== undefined ? Number(invalidRecord) : undefined;
  const invalidSectionEntry = section && invalidPart === 'sections' && invalidEntry !== undefined &&
    draft.sections?.[Number(invalidRecord)]?.id === section.id
    ? Number(invalidEntry) : undefined;
  return (
    <form className="realms-editor" onSubmit={(event) => void submit(event)} noValidate>
      <div className="realms-editor-nav">
        <button type="button" className="realms-back" disabled={busy} onClick={() => dirty || unsavedImport ? setDialog('leave') : onClose()}>
          <ArrowLeft size={16} aria-hidden="true" />{t('realms.back')}
        </button>
        <div className="realms-actions">
          {saved && <RealmFavoriteButton session={session} id={saved.id} title={saved.realm.title}
            favorite={favorite ?? Boolean(saved.favorite)} disabled={busy} onChanged={setFavorite} onError={setFavoriteError} />}
          <Button type="button" variant="default" disabled={busy} onClick={exportCard} leftSection={<Download size={16} aria-hidden="true" />}>
            {t('realms.export')}
          </Button>
        </div>
      </div>
      <header className="page-heading realms-heading">
        <div className="realms-title">
          {(saved || unsavedImport) && <PreviewableRealmAvatar src={draft.avatar} kind="realm" />}
          <h1 tabIndex={-1}>{saved?.realm.title ?? (unsavedImport && draft.title ? draft.title : t('realms.create'))}</h1>
        </div>
        <div className="realms-actions realms-heading-actions">
          {saveNotice && <output className="realms-muted">{t('realms.saved')}</output>}
          {saved && <Button type="button" variant="subtle" color="red" disabled={busy}
            onClick={() => { setDeleteError(null); setDialog('delete'); }} leftSection={<Trash2 size={16} aria-hidden="true" />}>
            {t('realms.deleteRealm')}
          </Button>}
          <Button type="button" variant="default" disabled={busy || !dirty} onClick={() => setDialog('discard')}>{t('common.cancel')}</Button>
          <Button type="submit" loading={saving} disabled={deleting || avatarPending}>{t('common.save')}</Button>
        </div>
      </header>
      {favoriteError && <p className="realms-error realms-save-error" role="alert">{t(`error.${favoriteError}`)}</p>}
      {issue && <p className="realms-error realms-save-error" role="alert">{t(issueMessage(issue))}</p>}
      {unsavedImport && imported?.avatarFailed && !draft.avatar && <div className="realms-save-error">
        <output className="realms-muted">{t('realms.importAvatarWarning')}</output>
      </div>}
      <fieldset className="realms-edit-fields" disabled={busy}>
        <RealmContents realm={draft} part={part} onPart={onPart} onCreateSection={createSection}>
          {part === 'base' && <div className="realms-record-fields">
            <AvatarEditor value={draft.avatar} kind="realm" onPending={setAvatarPending} onChange={(avatar) => patch({ avatar })} />
            <TextInput label={t('realms.title.realm')} required value={draft.title} error={issue?.field === '/title'}
              onChange={(event) => patch({ title: event.currentTarget.value })} />
            <div className="realms-metadata-fields">
              <TextInput label={t('realms.author')} value={draft.author ?? ''}
                onChange={(event) => patch({ author: event.currentTarget.value || undefined })} />
              <TextInput label={t('realms.version')} value={draft.version ?? ''}
                onChange={(event) => patch({ version: event.currentTarget.value || undefined })} />
            </div>
            <TagsInput label={t('realms.tags')} description={t('realms.tagsHelp')} value={draft.tags ?? []}
              onChange={(tags) => patch({ tags })} />
            <Textarea label={t('realms.shortDescription')} description={t('realms.shortDescriptionHelp')} autosize minRows={7} maxRows={20}
              value={draft.description ?? ''} onChange={(event) => patch({ description: event.currentTarget.value || undefined })} />
            <Textarea label={t('realms.baseText')} description={t('realms.baseHelp')} value={draft.base}
              required autosize minRows={16} maxRows={36} error={issue?.field === '/base'} onChange={(event) => patch({ base: event.currentTarget.value })} />
            <Textarea label={t('realms.authorNotes')} autosize minRows={6} maxRows={20} value={draft.authorNotes ?? ''}
              onChange={(event) => patch({ authorNotes: event.currentTarget.value || undefined })} />
          </div>}
          {(part === 'characters' || part === 'lorebook') && <EntriesEditor key={part} entries={draft[part] ?? []}
            kind={part === 'characters' ? 'character' : 'entry'} invalidIndex={invalidIndex} onAvatarPending={setAvatarPending}
            onChange={(entries, removed) => patch({ [part]: entries }, removed)} />}
          {part === 'starts' && <RecordEditor<RealmStart> items={draft.starts ?? []} invalidIndex={invalidIndex}
            addLabel={t('realms.add.start')} emptyLabel={t('realms.empty.starts')} makeItem={() => ({ id: newRealmId(), title: '' })}
            onChange={(starts) => patch({ starts })} fields={(start, change) => <StartFields realm={draft} start={start} onChange={change} />} />}
          {section && <div key={section.id} className="realms-section-editor">
            <div className="realms-section-settings">
              <TextInput label={t('realms.title.section')} required value={section.title}
                ref={(input) => {
                  if (input && focusSection.current === section.id) {
                    focusSection.current = null;
                    input.focus();
                  }
                }}
                onChange={(event) => {
                  const title = event.currentTarget.value;
                  patch({ sections: draft.sections?.map((entry) => entry.id === section.id ? { ...entry, title } : entry) });
                }} />
              <Button type="button" variant="subtle" color="red" onClick={() => deleteSection(section.id)}
                leftSection={<Trash2 size={16} aria-hidden="true" />}>{t('realms.deleteSection')}</Button>
            </div>
            <EntriesEditor kind="entry" entries={section.entries} invalidIndex={invalidSectionEntry}
              onChange={(entries, removed) => patch({ sections: draft.sections?.map((entry) => entry.id === section.id ? { ...entry, entries } : entry) }, removed)} />
          </div>}
        </RealmContents>
      </fieldset>
      <Modal opened={dialog !== null} onClose={() => setDialog(null)} title={t(dialog === 'delete' ? 'realms.deleteTitle' : 'realms.discardTitle')}
        closeButtonProps={{ 'aria-label': t('common.close') }} closeOnEscape={!deleting} closeOnClickOutside={!deleting} withCloseButton={!deleting}>
        <p>{dialog === 'delete' ? t('realms.deleteBody', { title: saved?.realm.title ?? '' }) : t('realms.discardBody')}</p>
        {dialog === 'delete' && deleteError && <p className="realms-error" role="alert">{t(`error.${deleteError}`)}</p>}
        <div className="realms-modal-actions">
          <Button type="button" variant="default" disabled={deleting} data-autofocus onClick={() => setDialog(null)}>
            {t(dialog === 'delete' ? 'common.cancel' : 'realms.keepEditing')}
          </Button>
          {dialog === 'delete' ? <Button type="button" color="red" loading={deleting} onClick={() => void confirmDelete()}>{t('common.delete')}</Button>
            : <Button type="button" color="red" onClick={discardChanges}>{t('realms.discard')}</Button>}
        </div>
      </Modal>
    </form>
  );
}

function issueMessage({ code, field }: SaveIssue): MessageKey {
  if (code !== 'realm_invalid') return `error.${code}`;
  if (field === '/title') return 'realms.required.title';
  if (field === '/base') return 'realms.required.base';
  if (field?.startsWith('/starts/')) return 'realms.required.start';
  if (field?.startsWith('/sections/') && !field.includes('/entries')) return 'realms.required.section';
  if (field?.startsWith('/characters/') || field?.startsWith('/lorebook/') || field?.includes('/entries/')) return 'realms.required.entry';
  return 'error.realm_invalid';
}

function pruneReferences(realm: Realm): Realm {
  const characterIds = new Set(realm.characters?.map(({ id }) => id));
  const loreIds = new Set(realm.lorebook?.map(({ id }) => id));
  const sectionIds = new Map(realm.sections?.map(({ id, entries }) => [id, new Set(entries.map((entry) => entry.id))]));
  return {
    ...realm,
    starts: realm.starts?.map((start) => ({
      ...start,
      characterIds: start.characterIds?.filter((id) => characterIds.has(id)),
      loreEntryIds: start.loreEntryIds?.filter((id) => loreIds.has(id)),
      sectionEntries: start.sectionEntries?.filter(({ sectionId, entryId }) => sectionIds.get(sectionId)?.has(entryId)),
    })),
  };
}
