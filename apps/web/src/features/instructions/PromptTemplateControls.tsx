import { Button, Checkbox, Modal, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { defaultRealmFilters, realmPageSize, realmSearchMaxLength, type RealmList } from '@kuroko/contracts/realms';
import { useEffect, useState } from 'react';
import type { ActiveSession } from '../../platform/session/model';
import { sessionRequest } from '../../platform/session/request';
import { ApiError, errorCode, type ErrorCode } from '../../shared/http/api';
import { useI18n } from '../../shared/i18n/i18n';
import { requestRealmList } from '../realms/model';
import './promptTemplateControls.css';

export type ChosenWorld = { id: string; title: string };

export function PromptTemplateControls({ session, text, disabled, agentName, worldId, worldTitle, onWorld }: {
  session: ActiveSession;
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
  return <div className="prompt-template-controls">
    <Button type="button" variant="default" size="xs" disabled={disabled} aria-haspopup="dialog" onClick={() => setDialog('world')}>
      {worldTitle ? t('templates.selectedWorld', { title: worldTitle }) : t('templates.insertWorld')}
    </Button>
    <Button type="button" variant="default" size="xs" disabled={disabled || !text.trim()} aria-haspopup="dialog" onClick={() => setDialog('preview')}>
      {t('templates.preview')}
    </Button>
    <Modal opened={dialog !== null} onClose={() => setDialog(null)} title={t(title)} size="lg"
      closeButtonProps={{ 'aria-label': t('common.close') }}>
      {dialog === 'preview' && <Preview session={session} text={text} agentName={agentName} worldId={worldId} />}
      {dialog === 'world' && <WorldPicker session={session} selected={worldId} onSelect={(world) => {
        const code = world && !worldId && !/\b(?:world\(\s*\)|vars\.)/.test(text) ? '{{ world().context }}' : undefined;
        if (!onWorld(world, code)) return false;
        setDialog(null);
        return true;
      }} />}
    </Modal>
  </div>;
}

function Preview({ session, text, agentName, worldId }: { session: ActiveSession; text: string; agentName?: string; worldId?: string | null }) {
  const { t } = useI18n();
  const [gmMode, setGmMode] = useState(false);
  const [result, setResult] = useState<{ text: string } | { error: ErrorCode; line?: string }>();
  const example = t('templates.exampleScene');
  const shownAgentName = agentName === undefined ? undefined : agentName || t('templates.exampleAgent');
  useEffect(() => {
    const controller = new AbortController();
    void sessionRequest<{ text: string }>(session, '/settings/instructions/preview', {
      method: 'POST', body: { text, chatTitle: example, gmMode, agentName: shownAgentName, worldId }, signal: controller.signal,
    }).then((preview) => { if (!controller.signal.aborted) setResult(preview); }, (error: unknown) => {
      if (controller.signal.aborted) return;
      const code = errorCode(error);
      setResult({ error: code, line: code === 'prompt_template_invalid' && error instanceof ApiError ? error.field : undefined });
    });
    return () => controller.abort();
  }, [example, gmMode, session, shownAgentName, text, worldId]);

  return <div className="prompt-template-help">
    <p>{t(shownAgentName === undefined ? 'templates.previewHelp' : 'templates.agentPreviewHelp')}</p>
    {shownAgentName === undefined && <Checkbox label={t('templates.previewGm')} checked={gmMode}
      onChange={(event) => { setResult(undefined); setGmMode(event.currentTarget.checked); }} />}
    {!result ? <output>{t('templates.loading')}</output> : 'error' in result
      ? <p role="alert">{result.line ? t('templates.lineError', { line: result.line }) : t(`error.${result.error}`)}</p>
      : result.text ? <pre dir="auto">{result.text}</pre> : <p>{t('templates.empty')}</p>}
  </div>;
}

export function insertPromptCode(input: HTMLTextAreaElement | null, text: string, code: string, limit: number) {
  const before = text.slice(0, input?.selectionStart ?? text.length);
  const after = text.slice(input?.selectionEnd ?? text.length);
  const next = `${before}${before && !before.endsWith('\n') ? '\n' : ''}${code}${after && !after.startsWith('\n') ? '\n' : ''}${after}`;
  if (next.length <= limit) return next;
}

function WorldPicker({ session, selected, onSelect }: {
  session: ActiveSession; selected?: string | null; onSelect: (world: ChosenWorld | null) => boolean;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [query] = useDebouncedValue(search, 200);
  const [offset, setOffset] = useState(0);
  const [full, setFull] = useState(false);
  const [response, setResponse] = useState<{ q: string; offset: number; result: RealmList | ErrorCode }>();
  const current = response?.q === search && response.offset === offset ? response.result : undefined;
  useEffect(() => {
    const controller = new AbortController();
    void requestRealmList({ session, signal: controller.signal, query: {
      q: query, offset, limit: realmPageSize, sort: 'updated', filters: defaultRealmFilters,
    } }).then((result) => { if (!controller.signal.aborted) setResponse({ q: query, offset, result }); }, (error: unknown) => {
      if (!controller.signal.aborted) setResponse({ q: query, offset, result: errorCode(error) });
    });
    return () => controller.abort();
  }, [offset, query, session]);

  return <div className="prompt-template-help">
    {full && <p role="alert">{t('templates.insertionLimit')}</p>}
    <TextInput label={t('realms.search')} maxLength={realmSearchMaxLength} value={search} data-autofocus
      onChange={(event) => { setSearch(event.currentTarget.value); setOffset(0); }} />
    {current === undefined ? <output>{t('realms.loading')}</output> : typeof current === 'string'
      ? <p role="alert">{t(`error.${current}`)}</p>
      : <>
        {current.items.length ? <ul className="prompt-world-list">
          {current.items.map(({ id, title }) => <li key={id}><Button type="button" variant={id === selected ? 'light' : 'default'} fullWidth
            aria-pressed={id === selected} onClick={() => setFull(!onSelect({ id, title }))}>{title}</Button></li>)}
        </ul> : <p>{t(search ? 'realms.noResults' : 'realms.empty')}</p>}
        {(offset > 0 || offset + realmPageSize < current.total) && <div className="prompt-template-actions">
          <Button type="button" variant="default" disabled={!offset} onClick={() => setOffset(offset - realmPageSize)}>{t('realms.previous')}</Button>
          <Button type="button" variant="default" disabled={offset + realmPageSize >= current.total}
            onClick={() => setOffset(offset + realmPageSize)}>{t('realms.next')}</Button>
        </div>}
      </>}
    {selected && <Button type="button" variant="subtle" onClick={() => onSelect(null)}>{t('templates.clearWorld')}</Button>}
  </div>;
}
