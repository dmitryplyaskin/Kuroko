import { ActionIcon, Button, Menu, Modal, Select, TextInput, Tooltip } from '@mantine/core';
import { presetNameLimit, type Preset } from '@kuroko/contracts/presets';
import { Copy, Ellipsis, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useUnit } from 'effector-react';
import type { PresetControlsModel } from '../../platform/presets';
import { useI18n } from '../i18n/i18n';
import './presetControls.css';

type Props = {
  presets: readonly Preset[];
  selectedId: string | null;
  disabled?: boolean;
  saveDisabled?: boolean;
  model: PresetControlsModel;
};

const dialogTitle = {
  create: 'presets.create', rename: 'presets.rename', copy: 'presets.copy', delete: 'presets.confirmDelete',
} as const;
const feedback = {
  apply: 'presets.applied', update: 'presets.saved', create: 'presets.created',
  rename: 'presets.renamed', copy: 'presets.copied', delete: 'presets.deleted',
} as const;

export function PresetControls({ presets, selectedId, disabled, saveDisabled, model }: Props) {
  const { t } = useI18n();
  const [{ dialog, name, submission }, openDialog, close, setName, run, submit] = useUnit([
    model.$state, model.opened, model.closed, model.nameChanged, model.requested, model.submitted,
  ]);
  const [search, setSearch] = useState<string | null>(null);
  const pending = submission.status === 'pending';
  const issue = submission.status === 'error' ? submission.code : undefined;
  const completed = submission.status === 'done' ? submission.action : undefined;
  const select = useRef<HTMLInputElement>(null);
  const create = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const dialogReturnFocus = useRef<'create' | 'more' | 'select'>('create');
  const selected = presets.find(({ id }) => id === selectedId);
  const nameError = dialog?.kind !== 'delete' && (issue === 'preset_name_invalid' || issue === 'preset_name_taken');

  useEffect(() => {
    if (dialog && nameError) nameInput.current?.focus();
  }, [dialog, nameError]);

  function open(next: Parameters<typeof openDialog>[0]) {
    if (disabled || pending) return;
    dialogReturnFocus.current = next.kind === 'create' ? 'create' : 'more';
    openDialog(next);
  }

  function restoreDialogFocus() {
    const target = completed === 'delete' ? 'select' : dialogReturnFocus.current;
    (target === 'create' ? create.current : target === 'more' ? more.current : select.current)?.focus();
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
        disabled={disabled && !pending} readOnly={pending} comboboxProps={{ transitionProps: { duration: 0 } }}
        onOptionSubmit={(id) => { if (!disabled && !pending) run({ kind: 'apply', id }); }} />
      <Tooltip label={t('presets.save')} events={tooltipEvents}>
        <ActionIcon type="button" size={44} variant="default" aria-label={t('presets.save')}
          disabled={!selected || saveDisabled || (disabled && !pending)} data-disabled={pending || undefined}
          aria-disabled={pending || undefined}
          onClick={() => { if (selected && !disabled && !pending && !saveDisabled) run({ kind: 'update', id: selected.id }); }}>
          <Save size={18} aria-hidden="true" />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t('presets.create')} events={tooltipEvents}>
        <ActionIcon ref={create} type="button" size={44} variant="default" aria-label={t('presets.create')} aria-haspopup="dialog"
          disabled={saveDisabled || (disabled && !pending)} data-disabled={pending || undefined}
          aria-disabled={pending || undefined} onClick={() => open({ kind: 'create' })}>
          <Plus size={18} aria-hidden="true" />
        </ActionIcon>
      </Tooltip>
      <Menu position="bottom-end" transitionProps={{ duration: 0 }}>
        <Tooltip label={t('presets.more')} events={tooltipEvents}>
          <Menu.Target>
            <ActionIcon ref={more} type="button" size={44} variant="default" aria-label={t('presets.more')}
              disabled={!selected || disabled || pending}>
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
      closeButtonProps={{ 'aria-label': t('common.close'), disabled: pending }} transitionProps={{ transition: 'fade' }}>
      {dialog && <form className="preset-controls-dialog" onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && !pending && (dialog.kind !== 'create' || !saveDisabled)) submit();
      }} noValidate>
        {dialog.kind === 'delete' ? <p>{t('presets.deleteBody', { name: dialog.preset.name })}</p>
          : <TextInput ref={nameInput} data-autofocus label={t('presets.name')} value={name} required readOnly={pending}
            maxLength={presetNameLimit} error={nameError && issue ? <span role="alert">{t(`error.${issue}`)}</span> : undefined}
            onChange={(event) => setName(event.currentTarget.value)} />}
        {issue && !nameError && <p className="preset-controls-error" role="alert">{t(`error.${issue}`)}</p>}
        <div className="preset-controls-dialog-actions">
          <Button type="button" variant="default" data-autofocus={dialog.kind === 'delete' || undefined}
            disabled={pending} onClick={close}>{t('common.cancel')}</Button>
          <Button type="submit" color={dialog.kind === 'delete' ? 'red' : undefined} loading={pending}
            disabled={disabled || (dialog.kind === 'create' && saveDisabled)}>
            {t(dialog.kind === 'delete' ? 'presets.delete' : dialog.kind === 'rename' ? 'common.save' : dialogTitle[dialog.kind])}
          </Button>
        </div>
      </form>}
    </Modal>
  </div>;
}
