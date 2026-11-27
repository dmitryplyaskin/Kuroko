import { Button, FileButton, Group, Modal, TextInput } from '@mantine/core';
import { personaDescriptionLimit, personaNameLimit } from '@kuroko/contracts/personas';
import { useUnit } from 'effector-react';
import { ArrowLeft, ChevronDown, ImagePlus, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { avatarFormats } from '../../shared/avatar/avatarFile';
import { DiscardChangesDialog } from '../../shared/dialogs/DiscardChangesDialog';
import { useI18n, type MessageKey } from '../../shared/i18n/i18n';
import { LibraryAvatar } from '../../shared/library/LibraryItem';
import library from '../../shared/library/Library.module.css';
import { PromptTextarea } from '../../shared/prompt-templates/TemplateHelp';
import { VariableFields } from '../../shared/variables/VariableFields';
import {
  $personaDirty, personaAvatarPicked, personaClosed, personaDeleteRequested, personaEdited, personaOpened, personaSaveRequested,
  type ReadyPersonaEditor,
} from './editorModel';
import classes from './Personas.module.css';

function issueKey(issue: NonNullable<ReadyPersonaEditor['issue']>): MessageKey {
  if (issue.code !== 'persona_invalid') return `error.${issue.code}`;
  const { field } = issue;
  if (field === '/name') return 'personas.invalid.name';
  if (field === '/description') return 'personas.invalid.description';
  if (field === '/avatar') return 'personas.invalid.avatar';
  if (field?.startsWith('/variables/') && field.endsWith('/name')) return 'personas.invalid.variableName';
  if (field?.startsWith('/variables/') && field.endsWith('/value')) return 'personas.invalid.variableValue';
  return 'error.persona_invalid';
}

export function PersonaEditor({ editor }: { editor: ReadyPersonaEditor }) {
  const { t } = useI18n();
  const { dirty, change, save, remove, close, open, pick } = useUnit({
    dirty: $personaDirty, change: personaEdited, save: personaSaveRequested, remove: personaDeleteRequested,
    close: personaClosed, open: personaOpened, pick: personaAvatarPicked,
  });
  const [discard, setDiscard] = useState<'leave' | 'reload'>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const variableSection = useRef<HTMLDetailsElement>(null);
  const resetFile = useRef<() => void>(null);
  const { id, draft, saved, operation, issue, saveNotice } = editor;
  const busy = Boolean(operation);
  const conflict = issue?.code === 'persona_conflict';
  const canSave = !busy && !conflict && (!saved || dirty);
  const deleting = operation === 'deleting';

  useEffect(() => {
    if (issue?.code !== 'persona_invalid' || issue.field === '/avatar') return;
    const details = variableSection.current;
    if (details && (issue.field === '/variables' || issue.field?.startsWith('/variables/'))) {
      details.open = true;
      (details.querySelector<HTMLElement>('[aria-invalid="true"]') ?? details.querySelector('summary'))?.focus();
      return;
    }
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [issue]);

  return <form ref={form} className={classes.editor} noValidate onSubmit={(event) => {
    event.preventDefault();
    if (canSave) save();
  }}>
    <Button type="button" variant="subtle" className={classes.back} disabled={busy} leftSection={<ArrowLeft size={16} aria-hidden="true" />}
      onClick={() => dirty ? setDiscard('leave') : close()}>{t('personas.back')}</Button>
    <header className={`page-heading ${library['library-heading']} ${classes.editorHeading}`}>
      <h1 tabIndex={-1} dir="auto">{saved?.name ?? t('personas.new')}</h1>
      <Group gap="xs" justify="flex-end" ms="auto">
        {saved && <Button type="button" variant="subtle" color="red" disabled={busy || conflict} onClick={() => setConfirmDelete(true)}>
          {t('personas.delete')}
        </Button>}
        <Button type="submit" disabled={!canSave} loading={operation === 'saving'}>{t('common.save')}</Button>
      </Group>
    </header>
    {saveNotice && <output className={classes.notice}>{t('personas.saved')}</output>}
    {issue && !confirmDelete && <div className={classes.issue}>
      <p role="alert" className={classes.error}>{t(issueKey(issue))}</p>
      {conflict && <Button type="button" variant="default" onClick={() => dirty ? setDiscard('reload') : open(id)}>
        {t('personas.reloadLatest')}
      </Button>}
    </div>}
    <div className={`${library['library-surface']} ${classes.editorSurface}`}>
      <div className={classes.fields}>
        <div className={classes.avatarField}>
          <LibraryAvatar className={classes.editorAvatar} src={draft.avatar} placeholder={<UserRound size={28} />} />
          <div className={classes.avatarControls}>
            <Group gap="xs">
              <FileButton accept={avatarFormats} resetRef={resetFile} onChange={(file) => {
                if (!file) return;
                resetFile.current?.();
                pick(file);
              }}>
                {(props) => <Button {...props} type="button" variant="default" disabled={busy || conflict} loading={operation === 'avatar'}
                  leftSection={<ImagePlus size={16} aria-hidden="true" />}>
                  {t(draft.avatar ? 'personas.avatarChange' : 'personas.avatarUpload')}
                </Button>}
              </FileButton>
              {draft.avatar && <Button type="button" variant="subtle" disabled={busy} onClick={() => change({ avatar: undefined })}>
                {t('personas.avatarRemove')}
              </Button>}
            </Group>
            <p>{t('personas.avatarFormats')}</p>
          </div>
        </div>
        <TextInput label={t('personas.name')} name="name" value={draft.name} dir="auto" maxLength={personaNameLimit} required disabled={busy}
          error={issue?.field === '/name'} onChange={(event) => change({ name: event.currentTarget.value })} />
        <PromptTextarea scope="persona" label={t('personas.description')} name="description" value={draft.description} dir="auto"
          minRows={5} maxRows={16} autosize maxLength={personaDescriptionLimit} disabled={busy}
          error={issue?.field === '/description'} onChange={(event) => change({ description: event.currentTarget.value })} />
      </div>
      <details ref={variableSection} className={classes.variableSection} open>
        <summary className={classes.variableSummary}>
          <h2>{t('personas.variables')} <ChevronDown size={18} aria-hidden="true" /></h2>
        </summary>
        <div className={classes.variableBody}>
          <p>{t('personas.variablesHelp')}</p>
          <VariableFields scope="personaValue" variables={draft.variables} issue={issue?.field} disabled={busy}
            onChange={(variables) => change({ variables })} />
        </div>
      </details>
    </div>
    <DiscardChangesDialog opened={discard !== undefined} onClose={() => setDiscard(undefined)} onDiscard={() => {
      if (discard === 'reload') open(id);
      else close();
      setDiscard(undefined);
    }} />
    {saved && <Modal opened={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('personas.deleteTitle')}
      closeOnEscape={!deleting} closeOnClickOutside={!deleting} withCloseButton={!deleting} closeButtonProps={{ 'aria-label': t('common.close') }}>
      <p>{t('personas.deleteBody', { name: saved.name })}</p>
      {issue && <p role="alert" className={classes.error}>{t(issueKey(issue))}</p>}
      <Group justify="flex-end" gap="sm" mt="md">
        <Button type="button" variant="default" data-autofocus disabled={deleting} onClick={() => setConfirmDelete(false)}>
          {t(conflict ? 'common.close' : 'common.cancel')}
        </Button>
        {!conflict && <Button type="button" color="red" loading={deleting} onClick={remove}>{t('common.delete')}</Button>}
      </Group>
    </Modal>}
  </form>;
}
