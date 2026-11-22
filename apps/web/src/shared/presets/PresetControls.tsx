import { ActionIcon, Button, Menu, Modal, Select, TextInput, Tooltip } from '@mantine/core';
import { presetNameLimit, readPresetName, type Preset, type PresetAction } from '@kuroko/contracts/presets';
import { Copy, Ellipsis, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useRef, useState, type SubmitEvent } from 'react';
import { errorCode, type ErrorCode } from '../http/api';
import { useI18n } from '../i18n/i18n';
import './presetControls.css';

type Dialog = { kind: 'create' } | { kind: 'rename' | 'copy' | 'delete'; preset: Preset };
type Props = {
  presets: readonly Preset[];
  selectedId: string | null;
  disabled?: boolean;
  saveDisabled?: boolean;
  onAction: (action: PresetAction) => Promise<boolean>;
};

const dialogTitle = {
  create: 'presets.create', rename: 'presets.rename', copy: 'presets.copy', delete: 'presets.confirmDelete',
} as const;
const feedback = {
  apply: 'presets.applied', update: 'presets.saved', create: 'presets.created',
  rename: 'presets.renamed', copy: 'presets.copied', delete: 'presets.deleted',
} as const;

export function PresetControls({ presets, selectedId, disabled, saveDisabled, onAction }: Props) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState<PresetAction['kind'] | null>(null);
  const [issue, setIssue] = useState<ErrorCode | null>(null);
  const [completed, setCompleted] = useState<PresetAction['kind'] | null>(null);
  const inFlight = useRef(false);
  const select = useRef<HTMLInputElement>(null);
  const create = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const dialogReturnFocus = useRef<'create' | 'more' | 'select'>('create');
  const selected = presets.find(({ id }) => id === selectedId);
  const nameError = dialog?.kind !== 'delete' && (issue === 'preset_name_invalid' || issue === 'preset_name_taken');

  function open(next: Dialog) {
    if (disabled || inFlight.current) return;
    dialogReturnFocus.current = next.kind === 'create' ? 'create' : 'more';
    setName(next.kind === 'rename' ? next.preset.name : '');
    setIssue(null);
    setCompleted(null);
    setDialog(next);
  }

  function close() {
    if (inFlight.current) return;
    setIssue(null);
    setDialog(null);
  }

  function restoreDialogFocus() {
    const target = dialogReturnFocus.current;
    (target === 'create' ? create.current : target === 'more' ? more.current : select.current)?.focus();
  }

  async function run(action: PresetAction) {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    setPending(action.kind);
    setIssue(null);
    setCompleted(null);
    try {
      if (await onAction(action)) {
        if (action.kind === 'delete') dialogReturnFocus.current = 'select';
        setCompleted(action.kind);
        setDialog(null);
      }
    } catch (error) {
      const code = errorCode(error);
      setIssue(code);
      if (dialog && dialog.kind !== 'delete' && (code === 'preset_name_invalid' || code === 'preset_name_taken')) {
        nameInput.current?.focus();
      }
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dialog || disabled || inFlight.current) return;
    if (dialog.kind === 'delete') {
      void run({ kind: 'delete', id: dialog.preset.id });
      return;
    }
    const validName = readPresetName(name);
    if (!validName) {
      setIssue('preset_name_invalid');
      nameInput.current?.focus();
      return;
    }
    void run(dialog.kind === 'create'
      ? { kind: 'create', name: validName }
      : { kind: dialog.kind, id: dialog.preset.id, name: validName });
  }

  const tooltipEvents = { hover: true, focus: true, touch: false };
  return <div className="preset-controls">
    <div className="preset-controls-row">
      <Select ref={select} className="preset-controls-select" classNames={{ dropdown: 'preset-controls-dropdown', option: 'preset-controls-option' }}
        size="md" aria-label={t('presets.label')} aria-autocomplete="list" placeholder={t('presets.choose')} title={selected?.name}
        nothingFoundMessage={t(presets.length ? 'presets.noResults' : 'presets.empty')} allowDeselect={false}
        searchable openOnFocus={false}
        value={selected?.id ?? null} data={presets.map(({ id, name }) => ({ value: id, label: name }))}
        searchValue={search ?? selected?.name ?? ''}
        onSearchChange={(query) => setSearch(query === (selected?.name ?? '') ? null : query)}
        onDropdownClose={() => setSearch(null)}
        disabled={disabled && !pending} readOnly={pending !== null} comboboxProps={{ transitionProps: { duration: 0 } }}
        onOptionSubmit={(id) => void run({ kind: 'apply', id })} />
      <Tooltip label={t('presets.save')} events={tooltipEvents}>
        <ActionIcon type="button" size={44} variant="default" aria-label={t('presets.save')}
          disabled={!selected || saveDisabled || (disabled && !pending)} data-disabled={pending !== null || undefined}
          aria-disabled={pending !== null || undefined}
          onClick={() => { if (selected) void run({ kind: 'update', id: selected.id }); }}>
          <Save size={18} aria-hidden="true" />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t('presets.create')} events={tooltipEvents}>
        <ActionIcon ref={create} type="button" size={44} variant="default" aria-label={t('presets.create')} aria-haspopup="dialog"
          disabled={saveDisabled || (disabled && !pending)} data-disabled={pending !== null || undefined}
          aria-disabled={pending !== null || undefined} onClick={() => open({ kind: 'create' })}>
          <Plus size={18} aria-hidden="true" />
        </ActionIcon>
      </Tooltip>
      <Menu position="bottom-end" transitionProps={{ duration: 0 }}>
        <Tooltip label={t('presets.more')} events={tooltipEvents}>
          <Menu.Target>
            <ActionIcon ref={more} type="button" size={44} variant="default" aria-label={t('presets.more')}
              disabled={!selected || disabled || pending !== null}>
              <Ellipsis size={18} aria-hidden="true" />
            </ActionIcon>
          </Menu.Target>
        </Tooltip>
        {selected && <Menu.Dropdown>
          <Menu.Item leftSection={<Pencil size={16} aria-hidden="true" />} aria-haspopup="dialog"
            onClick={() => open({ kind: 'rename', preset: selected })}>{t('presets.rename')}</Menu.Item>
          <Menu.Item leftSection={<Copy size={16} aria-hidden="true" />} aria-haspopup="dialog"
            onClick={() => open({ kind: 'copy', preset: selected })}>{t('presets.copy')}</Menu.Item>
          <Menu.Item color="var(--kr-danger)" leftSection={<Trash2 size={16} aria-hidden="true" />} aria-haspopup="dialog"
            onClick={() => open({ kind: 'delete', preset: selected })}>{t('presets.delete')}</Menu.Item>
        </Menu.Dropdown>}
      </Menu>
    </div>
    {!dialog && issue && <p className="preset-controls-error" role="alert">{t(`error.${issue}`)}</p>}
    <output className="preset-controls-feedback">
      {!dialog && (pending ? t('common.loading') : completed && t(feedback[completed]))}
    </output>

    <Modal opened={dialog !== null} onClose={close} title={dialog && t(dialogTitle[dialog.kind])}
      returnFocus={false} onExitTransitionEnd={restoreDialogFocus} closeOnEscape={!pending} closeOnClickOutside={!pending}
      closeButtonProps={{ 'aria-label': t('common.close'), disabled: pending !== null }} transitionProps={{ transition: 'fade' }}>
      {dialog && <form className="preset-controls-dialog" onSubmit={submit} noValidate>
        {dialog.kind === 'delete' ? <p>{t('presets.deleteBody', { name: dialog.preset.name })}</p>
          : <TextInput ref={nameInput} data-autofocus label={t('presets.name')} value={name} required readOnly={pending !== null}
            maxLength={presetNameLimit} error={nameError && issue ? <span role="alert">{t(`error.${issue}`)}</span> : undefined}
            onChange={(event) => { setName(event.currentTarget.value); setIssue(null); }} />}
        {issue && !nameError && <p className="preset-controls-error" role="alert">{t(`error.${issue}`)}</p>}
        <div className="preset-controls-dialog-actions">
          <Button type="button" variant="default" data-autofocus={dialog.kind === 'delete' || undefined}
            disabled={pending !== null} onClick={close}>{t('common.cancel')}</Button>
          <Button type="submit" color={dialog.kind === 'delete' ? 'red' : undefined} loading={pending !== null}
            disabled={disabled || (dialog.kind === 'create' && saveDisabled)}>
            {t(dialog.kind === 'delete' ? 'presets.delete' : dialog.kind === 'rename' ? 'common.save' : dialogTitle[dialog.kind])}
          </Button>
        </div>
      </form>}
    </Modal>
  </div>;
}
