import { Button, Checkbox, Modal, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { realmPageSize, realmSearchMaxLength } from '@kuroko/contracts/realms';
import { useEffect, useId, useMemo, useState } from 'react';
import { useUnit } from 'effector-react';
import { useI18n } from '../../shared/i18n/i18n';
import { templatePreview, templateWorlds } from './templateQueries';
import classes from './PromptTemplateControls.module.css';

export type ChosenWorld = { id: string; title: string };

export function PromptTemplateControls({ text, disabled, agentName, worldId, worldTitle, onWorld }: {
  text: string;
  disabled: boolean;
  agentName?: string;
  worldId?: string | null;
  worldTitle?: string;
  onWorld: (world: ChosenWorld | null, code?: string) => boolean;
}) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<'preview' | 'world' | null>(null);
  const title = dialog === 'preview' ? 'templates.preview' : 'templates.chooseWorld';
  return <div className={classes['prompt-template-controls']}>
    <Button type="button" variant="default" size="xs" disabled={disabled} aria-haspopup="dialog" onClick={() => setDialog('world')}>
      {worldTitle ? t('templates.selectedWorld', { title: worldTitle }) : t('templates.insertWorld')}
    </Button>
    <Button type="button" variant="default" size="xs" disabled={disabled || !text.trim()} aria-haspopup="dialog" onClick={() => setDialog('preview')}>
      {t('templates.preview')}
    </Button>
    <Modal opened={dialog !== null} onClose={() => setDialog(null)} title={t(title)} size="lg"
      closeButtonProps={{ 'aria-label': t('common.close') }}>
      {dialog === 'preview' && <Preview text={text} agentName={agentName} worldId={worldId} />}
      {dialog === 'world' && <WorldPicker selected={worldId} onSelect={(world) => {
        const code = world && !worldId && !/\b(?:world\(\s*\)|vars\.)/.test(text) ? '{{ world().context }}' : undefined;
        if (!onWorld(world, code)) return false;
        setDialog(null);
        return true;
      }} />}
    </Modal>
  </div>;
}

function Preview({ text, agentName, worldId }: { text: string; agentName?: string; worldId?: string | null }) {
  const { t } = useI18n();
  const dialog = useId();
  const [state, load, close, retry] = useUnit([templatePreview.$state, templatePreview.requested, templatePreview.closed, templatePreview.retried]);
  const [gmMode, setGmMode] = useState(false);
  const chatTitle = t('templates.exampleScene');
  const shownAgentName = agentName === undefined ? undefined : agentName || t('templates.exampleAgent');
  const input = useMemo(() => ({ text, chatTitle, gmMode, agentName: shownAgentName, worldId }),
    [text, chatTitle, gmMode, shownAgentName, worldId]);
  const current = state?.request.dialog === dialog && state.request.input === input ? state : null;

  useEffect(() => { load({ dialog, input }); }, [dialog, load, input]);
  useEffect(() => () => { close(dialog); }, [dialog, close]);

  return <div className={classes['prompt-template-help']}>
    <p>{t(shownAgentName === undefined ? 'templates.previewHelp' : 'templates.agentPreviewHelp')}</p>
    {shownAgentName === undefined && <Checkbox label={t('templates.previewGm')} checked={gmMode}
      onChange={(event) => setGmMode(event.currentTarget.checked)} />}
    {!current || current.status === 'loading' ? <output>{t('templates.loading')}</output> : current.status === 'error'
      ? <>
        <p role="alert">{current.code === 'prompt_template_invalid' && current.field
          ? t('templates.lineError', { line: current.field }) : t(`error.${current.code}`)}</p>
        {current.code !== 'prompt_template_invalid' && <Button variant="default" onClick={() => retry(dialog)}>{t('common.retryLoad')}</Button>}
      </>
      : current.data.text ? <pre dir="auto">{current.data.text}</pre> : <p>{t('templates.empty')}</p>}
  </div>;
}

export function insertPromptCode(input: HTMLTextAreaElement | null, text: string, code: string, limit: number) {
  const before = text.slice(0, input?.selectionStart ?? text.length);
  const after = text.slice(input?.selectionEnd ?? text.length);
  const next = `${before}${before && !before.endsWith('\n') ? '\n' : ''}${code}${after && !after.startsWith('\n') ? '\n' : ''}${after}`;
  if (next.length <= limit) return next;
}

function WorldPicker({ selected, onSelect }: { selected?: string | null; onSelect: (world: ChosenWorld | null) => boolean }) {
  const { t } = useI18n();
  const dialog = useId();
  const [state, load, close, retry] = useUnit([templateWorlds.$state, templateWorlds.requested, templateWorlds.closed, templateWorlds.retried]);
  const [search, setSearch] = useState('');
  const [query] = useDebouncedValue(search, 200);
  const [offset, setOffset] = useState(0);
  const [full, setFull] = useState(false);
  const current = state?.request.dialog === dialog && state.request.input.q === search && state.request.input.offset === offset ? state : null;

  useEffect(() => {
    if (query === search) load({ dialog, input: { q: query, offset } });
    else close(dialog);
  }, [close, dialog, load, offset, query, search]);
  useEffect(() => () => { close(dialog); }, [dialog, close]);

  return <div className={classes['prompt-template-help']}>
    {full && <p role="alert">{t('templates.insertionLimit')}</p>}
    <TextInput label={t('realms.search')} maxLength={realmSearchMaxLength} value={search} data-autofocus
      onChange={(event) => { setSearch(event.currentTarget.value); setOffset(0); }} />
    {!current || current.status === 'loading' ? <output>{t('realms.loading')}</output> : current.status === 'error'
      ? <>
        <p role="alert">{t(`error.${current.code}`)}</p>
        <Button variant="default" onClick={() => retry(dialog)}>{t('common.retryLoad')}</Button>
      </>
      : <>
        {current.data.items.length ? <ul className={classes['prompt-world-list']}>
          {current.data.items.map(({ id, title }) => <li key={id}><Button type="button" variant={id === selected ? 'light' : 'default'} fullWidth
            aria-pressed={id === selected} onClick={() => setFull(!onSelect({ id, title }))}>{title}</Button></li>)}
        </ul> : <p>{t(search ? 'realms.noResults' : 'realms.empty')}</p>}
        {(offset > 0 || offset + realmPageSize < current.data.total) && <div className={classes['prompt-template-actions']}>
          <Button type="button" variant="default" disabled={!offset} onClick={() => setOffset(offset - realmPageSize)}>{t('realms.previous')}</Button>
          <Button type="button" variant="default" disabled={offset + realmPageSize >= current.data.total}
            onClick={() => setOffset(offset + realmPageSize)}>{t('realms.next')}</Button>
        </div>}
      </>}
    {selected && <Button type="button" variant="subtle" onClick={() => onSelect(null)}>{t('templates.clearWorld')}</Button>}
  </div>;
}
