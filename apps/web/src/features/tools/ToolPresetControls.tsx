import { ActionIcon, Button, Modal, NativeSelect, TextInput } from '@mantine/core';
import { readToolPresetName, toolPresetNameLimit, type ToolPreset } from '@kuroko/contracts/tools';
import { useUnit } from 'effector-react';
import { BookmarkPlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { errorCode, type ErrorCode } from '../../shared/http/api';
import { useI18n } from '../../shared/i18n/i18n';
import { toolSettingsChangeFx } from './model';

type Dialog = { kind: 'save' } | { kind: 'delete'; preset: ToolPreset };

export function ToolPresetControls({ presets, disabled, saving }: { presets: ToolPreset[]; disabled: boolean; saving: boolean }) {
  const { t } = useI18n();
  const change = useUnit(toolSettingsChangeFx);
  const [selectedId, setSelectedId] = useState('');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [name, setName] = useState('');
  const [issue, setIssue] = useState<ErrorCode | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const deleted = useRef(false);
  const selected = presets.find((preset) => preset.id === selectedId);
  const nameError = issue === 'preset_name_invalid' || issue === 'preset_name_taken';

  useEffect(() => {
    if (!dialog && deleted.current) {
      deleted.current = false;
      saveButton.current?.focus();
    }
  }, [dialog]);

  function show(next: Dialog) {
    setName('');
    setIssue(null);
    setDialog(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!dialog || disabled) return;
    setIssue(null);
    const presetName = readToolPresetName(name);
    if (dialog.kind === 'save' && !presetName) {
      setIssue('preset_name_invalid');
      nameInput.current?.focus();
      return;
    }
    try {
      const result = await change(dialog.kind === 'save'
        ? { kind: 'savePreset', name: presetName! }
        : { kind: 'deletePreset', id: dialog.preset.id });
      if (!result) return;
      setSelectedId(dialog.kind === 'save' ? result.presets?.find((preset) => preset.name === presetName)?.id ?? '' : '');
      deleted.current = dialog.kind === 'delete';
      setDialog(null);
    } catch (error) {
      const code = errorCode(error);
      setIssue(code);
      if (code === 'preset_name_invalid' || code === 'preset_name_taken') nameInput.current?.focus();
    }
  }

  return <>
    <div className="tool-manager-presets">
      {presets.length > 0 && <div className="tool-manager-preset-picker">
        <NativeSelect className="tool-manager-preset-select" aria-label={t('tools.presets')} value={selected?.id ?? ''}
          disabled={disabled} title={selected?.name} onChange={(event) => setSelectedId(event.currentTarget.value)}
          data={[
            { value: '', label: t('tools.choosePreset') },
            ...presets.map(({ id, name }) => ({ value: id, label: name })),
          ]} />
        <Button variant="default" disabled={disabled || !selected}
          onClick={() => { if (selected) void change({ kind: 'applyPreset', id: selected.id }).catch(() => {}); }}>
          {t('tools.applyPreset')}
        </Button>
        <ActionIcon type="button" size={42} variant="default" aria-label={t('tools.deletePreset')} title={t('tools.deletePreset')}
          disabled={disabled || !selected} onClick={() => { if (selected) show({ kind: 'delete', preset: selected }); }}>
          <Trash2 size={16} aria-hidden="true" />
        </ActionIcon>
      </div>}
      <Button ref={saveButton} disabled={disabled} leftSection={<BookmarkPlus size={16} aria-hidden="true" />} onClick={() => show({ kind: 'save' })}>
        {t('tools.savePreset')}
      </Button>
    </div>
    <Modal opened={dialog !== null} title={t(dialog?.kind === 'delete' ? 'tools.confirmDeletePreset' : 'tools.savePreset')}
      onClose={() => setDialog(null)} closeOnEscape={!saving} closeOnClickOutside={!saving}
      closeButtonProps={{ 'aria-label': t('common.close'), disabled: saving }} transitionProps={{ transition: 'fade' }}>
      {dialog && <form className="tool-manager-preset-form" onSubmit={(event) => void submit(event)} noValidate>
        {dialog.kind === 'save' ? <>
          <p>{t('tools.savePresetHelp')}</p>
          <TextInput ref={nameInput} data-autofocus label={t('tools.presetName')} value={name} required
            maxLength={toolPresetNameLimit} disabled={saving} error={nameError && issue ? t(`error.${issue}`) : undefined}
            onChange={(event) => { setName(event.currentTarget.value); setIssue(null); }} />
        </> : <p>{t('tools.deletePresetBody', { name: dialog.preset.name })}</p>}
        {issue && !nameError && <p className="tool-manager-error" role="alert">{t(`error.${issue}`)}</p>}
        <div className="tool-manager-modal-actions">
          <Button type="button" variant="default" data-autofocus={dialog.kind === 'delete' || undefined}
            disabled={saving} onClick={() => setDialog(null)}>{t('common.cancel')}</Button>
          <Button type="submit" color={dialog.kind === 'delete' ? 'red' : undefined} loading={saving}>
            {t(dialog.kind === 'delete' ? 'tools.deletePreset' : 'common.save')}
          </Button>
        </div>
      </form>}
    </Modal>
  </>;
}
