import { Button, Modal, TagsInput, TextInput } from '@mantine/core';
import { type Realm, type RealmStart } from '@kuroko/contracts/realms';
import { useUnit } from 'effector-react';
import { ArrowLeft, Download, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DiscardChangesDialog } from '../../shared/dialogs/DiscardChangesDialog';
import { useI18n, type MessageKey } from '../../shared/i18n/i18n';
import { PromptTextarea } from '../../shared/prompt-templates/TemplateHelp';
import {
  $realmEditorDirty, $realmFavoriteError, newRealmId, realmEditorActionRequested, realmEditorClosed, realmEditorDeleteErrorCleared,
  realmEditorDeleteRequested, realmEditorDraftChanged, realmEditorDraftDiscarded, realmEditorVariablesChanged,
  type RealmEditorState, type RealmSaveIssue,
} from './model';
import { AvatarEditor, PreviewableRealmAvatar } from './RealmAvatar';
import { getRealmSection, RealmContents, realmParts, sectionPart, type RealmPart } from './RealmContents';
import { RealmFavoriteButton } from './RealmFavoriteButton';
import { EntriesEditor, RecordEditor, StartFields } from './RealmFields';
import { RealmVariables } from './RealmVariables';
import classes from './Realms.module.css';

export function RealmEditor({ editor }: { editor: RealmEditorState }) {
  const { t } = useI18n();
  const { dirty, close, change, changeVariables, action, discard, remove, clearDeleteError, favoriteError } = useUnit({
    dirty: $realmEditorDirty, close: realmEditorClosed, change: realmEditorDraftChanged, changeVariables: realmEditorVariablesChanged,
    action: realmEditorActionRequested, discard: realmEditorDraftDiscarded, remove: realmEditorDeleteRequested,
    clearDeleteError: realmEditorDeleteErrorCleared, favoriteError: $realmFavoriteError,
  });
  const { saved, baseline, draft, imported, variables, issue, saving, deleting, deleteError, saveNotice } = editor;
  const [part, onPart] = useState<RealmPart>('base');
  const avatarPending = editor.avatarOperation?.status === 'processing';
  const [dialog, setDialog] = useState<'discard' | 'leave' | 'delete' | null>(null);
  const focusSection = useRef<string>(null);
  const unsavedImport = Boolean(imported && !saved);
  const section = getRealmSection(draft, part);
  const busy = saving || deleting || avatarPending;

  useEffect(() => {
    if (!issue?.field) return;
    const [, field, index] = issue.field.split('/');
    const invalidSection = field === 'sections' ? draft.sections?.[Number(index)] : undefined;
    onPart(invalidSection ? sectionPart(invalidSection.id) : realmParts.find((part) => part === field) ?? 'base');
  }, [issue, draft.sections]);

  function patch(patch: Partial<Realm>, removed?: boolean) {
    change({ patch, removed });
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

  function discardChanges() {
    if (dialog === 'leave') {
      close();
      return;
    }
    discard();
    setDialog(null);
    if (section && !getRealmSection(baseline, part)) onPart('base');
  }

  const [, invalidPart, invalidRecord, , invalidEntry] = issue?.field?.split('/') ?? [];
  const invalidIndex = part === invalidPart && invalidRecord !== undefined ? Number(invalidRecord) : undefined;
  const invalidSectionEntry = section && invalidPart === 'sections' && invalidEntry !== undefined &&
    draft.sections?.[Number(invalidRecord)]?.id === section.id
    ? Number(invalidEntry) : undefined;
  return (
    <form className={classes['realms-editor']} onSubmit={(event) => {
      event.preventDefault();
      if (!busy && !dialog) action('save');
    }} noValidate>
      <div className={classes['realms-editor-nav']}>
        <button type="button" className={classes['realms-back']} disabled={busy} onClick={() => dirty || unsavedImport ? setDialog('leave') : close()}>
          <ArrowLeft size={16} aria-hidden="true" />{t('realms.back')}
        </button>
        <div className={classes['realms-actions']}>
          {saved && <RealmFavoriteButton id={saved.id} title={saved.realm.title} favorite={Boolean(saved.favorite)} disabled={busy} />}
          <Button type="button" variant="default" disabled={busy} onClick={() => action('export')} leftSection={<Download size={16} aria-hidden="true" />}>
            {t('realms.export')}
          </Button>
        </div>
      </div>
      <header className={['page-heading', classes['realms-heading']].join(' ')}>
        <div className={classes['realms-title']}>
          {(saved || unsavedImport) && <PreviewableRealmAvatar src={draft.avatar} kind="realm" />}
          <h1 tabIndex={-1}>{saved?.realm.title ?? (unsavedImport && draft.title ? draft.title : t('realms.create'))}</h1>
        </div>
        <div className={[classes['realms-actions'], classes['realms-heading-actions']].join(' ')}>
          {saveNotice && <output className={classes['realms-muted']}>{t('realms.saved')}</output>}
          {saved && <Button type="button" variant="subtle" color="red" disabled={busy}
            onClick={() => { clearDeleteError(); setDialog('delete'); }} leftSection={<Trash2 size={16} aria-hidden="true" />}>
            {t('realms.deleteRealm')}
          </Button>}
          <Button type="button" variant="default" disabled={busy || !dirty} onClick={() => setDialog('discard')}>{t('common.cancel')}</Button>
          <Button type="submit" loading={saving} disabled={deleting || avatarPending}>{t('common.save')}</Button>
        </div>
      </header>
      {favoriteError && favoriteError.id === saved?.id && <p className={[classes['realms-error'], classes['realms-save-error']].join(' ')} role="alert">{t(`error.${favoriteError.code}`)}</p>}
      {issue && <p className={[classes['realms-error'], classes['realms-save-error']].join(' ')} role="alert">{t(issueMessage(issue))}</p>}
      {unsavedImport && imported?.avatarFailed && !draft.avatar && <div className={classes['realms-save-error']}>
        <output className={classes['realms-muted']}>{t('realms.importAvatarWarning')}</output>
      </div>}
      <fieldset className={classes['realms-edit-fields']} disabled={busy}>
        <RealmContents realm={draft} variableCount={variables.length} part={part} onPart={onPart} onCreateSection={createSection}>
          {part === 'base' && <div className={classes['realms-record-fields']}>
            <AvatarEditor value={draft.avatar} />
            <TextInput label={t('realms.title.realm')} required value={draft.title} error={issue?.field === '/title'}
              onChange={(event) => patch({ title: event.currentTarget.value })} />
            <div className={classes['realms-metadata-fields']}>
              <TextInput label={t('realms.author')} value={draft.author ?? ''}
                onChange={(event) => patch({ author: event.currentTarget.value || undefined })} />
              <TextInput label={t('realms.version')} value={draft.version ?? ''}
                onChange={(event) => patch({ version: event.currentTarget.value || undefined })} />
            </div>
            <TagsInput label={t('realms.tags')} description={t('realms.tagsHelp')} value={draft.tags ?? []}
              onChange={(tags) => patch({ tags })} />
            <PromptTextarea scope="world" label={t('realms.shortDescription')} description={t('realms.shortDescriptionHelp')} autosize minRows={7} maxRows={20}
              value={draft.description ?? ''} onChange={(event) => patch({ description: event.currentTarget.value || undefined })} />
            <PromptTextarea scope="world" label={t('realms.baseText')} description={t('realms.baseHelp')} value={draft.base}
              required autosize minRows={16} maxRows={36} error={issue?.field === '/base'} onChange={(event) => patch({ base: event.currentTarget.value })} />
            <PromptTextarea scope="world" label={t('realms.authorNotes')} autosize minRows={6} maxRows={20} value={draft.authorNotes ?? ''}
              onChange={(event) => patch({ authorNotes: event.currentTarget.value || undefined })} />
          </div>}
          {(part === 'characters' || part === 'lorebook') && <EntriesEditor key={part} entries={draft[part] ?? []}
            kind={part === 'characters' ? 'character' : 'entry'} invalidIndex={invalidIndex}
            onChange={(entries, removed) => patch({ [part]: entries }, removed)} />}
          {part === 'starts' && <RecordEditor<RealmStart> items={draft.starts ?? []} invalidIndex={invalidIndex}
            addLabel={t('realms.add.start')} emptyLabel={t('realms.empty.starts')} makeItem={() => ({ id: newRealmId(), title: '' })}
            onChange={(starts) => patch({ starts })} fields={(start, change) => <StartFields realm={draft} start={start} onChange={change} />} />}
          {part === 'variables' && <RealmVariables variables={variables} issue={issue?.field}
            onChange={changeVariables} />}
          {section && <div key={section.id} className={classes['realms-section-editor']}>
            <div className={classes['realms-section-settings']}>
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
      <DiscardChangesDialog opened={dialog === 'discard' || dialog === 'leave'} onClose={() => setDialog(null)} onDiscard={discardChanges} />
      <Modal opened={dialog === 'delete'} onClose={() => setDialog(null)} title={t('realms.deleteTitle')}
        closeButtonProps={{ 'aria-label': t('common.close') }} closeOnEscape={!deleting} closeOnClickOutside={!deleting} withCloseButton={!deleting}>
        <p>{t('realms.deleteBody', { title: saved?.realm.title ?? '' })}</p>
        {deleteError && <p className={classes['realms-error']} role="alert">{t(`error.${deleteError}`)}</p>}
        <div className={classes['realms-modal-actions']}>
          <Button type="button" variant="default" disabled={deleting} data-autofocus onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button type="button" color="red" loading={deleting} onClick={remove}>{t('common.delete')}</Button>
        </div>
      </Modal>
    </form>
  );
}

function issueMessage({ code, field }: RealmSaveIssue): MessageKey {
  if (code !== 'realm_invalid') return `error.${code}`;
  if (field === '/title') return 'realms.required.title';
  if (field === '/base') return 'realms.required.base';
  if (field?.startsWith('/starts/')) return 'realms.required.start';
  if (field?.startsWith('/sections/') && !field.includes('/entries')) return 'realms.required.section';
  if (field?.startsWith('/characters/') || field?.startsWith('/lorebook/') || field?.includes('/entries/')) return 'realms.required.entry';
  return 'error.realm_invalid';
}
