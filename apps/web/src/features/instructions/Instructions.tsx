import { Button, Textarea } from '@mantine/core';
import { instructionTextLimit, readInstructionText } from '@kuroko/contracts/instructions';
import { useUnit } from 'effector-react';
import { useEffect } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { PresetControls } from '../../shared/presets/PresetControls';
import { $instructions, changeInstructionFx, instructionDraftChanged, instructionsOpened } from './model';
import './instructions.css';

export default function Instructions() {
  const { t } = useI18n();
  return <section aria-labelledby="instructions-title">
    <header className="page-heading">
      <h1 id="instructions-title" tabIndex={-1}>{t('instructions.label')}</h1>
      <p>{t('instructions.description')}</p>
    </header>
    <InstructionEditor />
  </section>;
}

function InstructionEditor() {
  const { t } = useI18n();
  const [view, open, edit, change] = useUnit([$instructions, instructionsOpened, instructionDraftChanged, changeInstructionFx]);
  useEffect(() => { open(); }, [open]);

  if (view.status === 'error') {
    return <div className="instruction-editor">
      <p role="alert" className="instruction-error">{t(`error.${view.code}`)}</p>
      <Button variant="default" onClick={open}>{t('common.retryLoad')}</Button>
    </div>;
  }
  if (view.status !== 'ready' && view.status !== 'saving') return <output>{t('instructions.loading')}</output>;

  const { activePresetId, presets } = view.data;
  const saving = view.status === 'saving';
  const valid = Boolean(readInstructionText(view.draft));

  return <div className="instruction-editor">
    <PresetControls presets={presets} selectedId={activePresetId} disabled={saving}
      saveDisabled={!valid} onAction={change} />
    <Textarea label={t('instructions.text')} classNames={{ input: 'instruction-editor-input' }}
      description={t(activePresetId ? 'instructions.editHint' : 'instructions.createHint')}
      value={view.draft} maxLength={instructionTextLimit} resize="vertical" readOnly={saving}
      error={view.draft.trim() && !valid ? t('error.instruction_text_invalid') : undefined}
      onChange={({ currentTarget }) => edit(currentTarget.value)} />
    {activePresetId ? <Button variant="default" disabled={saving}
      onClick={() => void change({ kind: 'clear' }).catch(() => {})}>{t('instructions.clear')}</Button>
      : <output className="instruction-status">{t('instructions.inactive')}</output>}
    {view.error && <p role="alert" className="instruction-error">{t(`error.${view.error}`)}</p>}
  </div>;
}
