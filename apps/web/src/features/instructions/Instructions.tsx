import { Button } from '@mantine/core';
import { instructionTextLimit, readInstructionText } from '@kuroko/contracts/instructions';
import { useUnit } from 'effector-react';
import { useEffect, useRef } from 'react';
import { $activeSession } from '../../platform/session/model';
import { useI18n } from '../../shared/i18n/i18n';
import { PromptTextarea } from '../../shared/prompt-templates/TemplateHelp';
import { PresetControls } from '../../shared/presets/PresetControls';
import { $instructions, changeInstructionFx, instructionDraftChanged, instructionsOpened } from './model';
import { insertPromptCode, PromptTemplateControls } from './PromptTemplateControls';
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
  const [view, open, edit, change, session] = useUnit([$instructions, instructionsOpened, instructionDraftChanged, changeInstructionFx, $activeSession]);
  const input = useRef<HTMLTextAreaElement>(null);
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
  const { text, worldId, worldTitle } = view.draft;
  const valid = Boolean(readInstructionText(text));

  return <div className="instruction-editor">
    <PresetControls presets={presets} selectedId={activePresetId} disabled={saving}
      saveDisabled={!valid} onAction={change} />
    {session && <PromptTemplateControls session={session} text={text} disabled={saving} worldId={worldId} worldTitle={worldTitle}
      onWorld={(world, code) => {
        const next = code ? insertPromptCode(input.current, text, code, instructionTextLimit) : text;
        if (next === undefined) return false;
        edit({ text: next, worldId: world?.id ?? null, worldTitle: world?.title });
        return true;
      }} />}
    <PromptTextarea scope="chat" label={t('instructions.text')} ref={input} classNames={{ input: 'instruction-editor-input' }}
      description={t(activePresetId ? 'instructions.editHint' : 'instructions.createHint')}
      value={text} maxLength={instructionTextLimit} resize="vertical" readOnly={saving}
      error={text.trim() && !valid ? t('error.instruction_text_invalid') : undefined}
      onChange={({ currentTarget }) => edit({ text: currentTarget.value })} />
    {activePresetId ? <Button variant="default" disabled={saving}
      onClick={() => void change({ kind: 'clear' }).catch(() => {})}>{t('instructions.clear')}</Button>
      : <output className="instruction-status">{t('instructions.inactive')}</output>}
    {view.error && <p role="alert" className="instruction-error">{t(`error.${view.error}`)}</p>}
  </div>;
}
