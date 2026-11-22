import { Button, Tabs, TextInput } from '@mantine/core';
import { ArrowDownRight, Bot, CircleAlert, Cpu, Layers, MessageSquare, Search, UserRound, Wrench, X } from 'lucide-react';
import { memo, useId, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import type { ChatMessage } from '@kuroko/contracts/chat';
import type { JsonValue } from '@kuroko/contracts/llm';
import { useI18n } from '../../shared/i18n/i18n';
import { activityLabels, activityObject, activitySections, ActivityStatus, type ActivityEntry } from './ChatActivity';
import { chatLogTurns, logRowPreview, withLiveLogReply, type LogRow, type LogTurn } from './chatLogActivity';
import { ChatText } from './ChatText';
import './chatLog.css';

const rowLabels = { ...activityLabels, model: 'common.model', user: 'chat.logUser', assistant: 'chat.logAssistant' } as const;
const rowIcons = { user: UserRound, assistant: MessageSquare, model: Cpu, tool: Wrench, agent: Bot, reply: CircleAlert };
const detailTabs = {
  request: ['request'],
  arguments: ['arguments'],
  result: ['result', 'modelResult'],
  response: ['response'],
} as const;

function LogLabel({ row }: { row: LogRow }) {
  const { t } = useI18n();
  const Icon = rowIcons[row.kind];
  return <span className="chat-log-label" data-kind={row.kind}><Icon size={14} aria-hidden="true" />{t(rowLabels[row.kind])}</span>;
}

function LogStatus({ row }: { row: LogRow }) {
  if (row.event) return <ActivityStatus status={row.event.status} />;
  if (row.pending) return <ActivityStatus status="running" />;
  return null;
}

function RawDetail({ value, limit }: { value: JsonValue; limit?: number }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return <pre className="chat-log-raw">{limit && text.length > limit ? `${text.slice(0, limit)}…` : text}</pre>;
}

function LogInspector({ row, turn, source, heading, id, onClose, onSource, onOpenAgent }: {
  row: LogRow; turn: number; source?: LogRow; heading: Ref<HTMLHeadingElement>; id: string;
  onClose: () => void; onSource: () => void; onOpenAgent?: (key: string) => void;
}) {
  const { t, date, number } = useI18n();
  const { event, text } = row;
  const details = event?.details ?? {};
  const completion = activityObject(details.response);
  const usage = activityObject(completion?.usage);
  const titleId = `${id}-title`;
  const tabs = Object.entries(detailTabs).filter(([, keys]) => keys.some((key) => details[key] !== undefined));
  const model = event?.kind === 'model' ? event.name : undefined;
  const metadata = [
    [t('common.model'), model],
    [t('chat.logProvider'), typeof completion?.provider === 'string' ? completion.provider : undefined],
    [t('chat.logStarted'), date.format(row.time)],
    [t('chat.logDuration'), event?.duration === undefined ? undefined
      : t('chat.logSeconds', { time: number.format(event.duration / 1000) })],
    [t('chat.logInputTokens'), typeof usage?.inputTokens === 'number' ? number.format(usage.inputTokens) : undefined],
    [t('chat.logOutputTokens'), typeof usage?.outputTokens === 'number' ? number.format(usage.outputTokens) : undefined],
    [t('chat.logTotalTokens'), typeof usage?.totalTokens === 'number' ? number.format(usage.totalTokens) : undefined],
  ];
  const overview = (
    <>
      {text?.trim() && <div className="chat-log-transcript chat-message-content">
        <ChatText user={row.kind === 'user'}>{text}</ChatText>
      </div>}
      {row.kind === 'tool' && (['arguments', 'result'] as const).map((key) => details[key] !== undefined && (
        <section className="chat-log-inspector-section" key={key}>
          <h3>{t(activitySections[key])}</h3>
          <RawDetail value={details[key]} limit={350} />
        </section>
      ))}
      {Object.entries(details).filter(([key]) => !tabs.some(([, keys]) => keys.some((item) => item === key)))
        .map(([key, value]) => (
          <section className="chat-log-inspector-section" key={key}>
            <h3>{Object.hasOwn(activitySections, key) ? t(activitySections[key as keyof typeof activitySections]) : key}</h3>
            <RawDetail value={value} />
          </section>
        ))}
      <dl className="chat-log-metadata">
        {metadata.map(([label, value]) => value && <div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>)}
      </dl>
      {(source || (onOpenAgent && event?.targetAgentKey)) && (
        <div className="chat-log-related">
          {onOpenAgent && event?.targetAgentKey && <Button variant="light" size="compact-sm"
            onClick={() => onOpenAgent(event.targetAgentKey!)} leftSection={<Bot size={15} aria-hidden="true" />}>
            {t('chat.logOpenAgent')}
          </Button>}
          {source && <Button variant="subtle" size="compact-sm" className="chat-log-source" onClick={onSource}
            leftSection={<ArrowDownRight size={15} aria-hidden="true" />}>{t('chat.logOpenModel')}</Button>}
        </div>
      )}
    </>
  );
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape dismisses details from any of its controls.
    <aside className="chat-log-inspector" id={id} aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}>
      <header className="chat-log-inspector-header">
        <div>
          <span className="chat-log-turn-number">{t('chat.logTurn', { number: number.format(turn) })}</span>
          <h2 id={titleId} ref={heading} tabIndex={-1}>
            {event?.name ? <bdi>{event.name}</bdi> : t(rowLabels[row.kind])}
          </h2>
          <LogStatus row={row} />
        </div>
        <button type="button" className="icon-button chat-log-close" aria-label={t('chat.logCloseDetails')}
          title={t('chat.logCloseDetails')} onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>
      {tabs.length ? (
        <Tabs className="chat-log-detail-tabs" defaultValue="overview" keepMounted={false} color="var(--kr-accent)">
          <Tabs.List aria-label={t('chat.logDetails')}>
            <Tabs.Tab value="overview">{t('chat.logOverview')}</Tabs.Tab>
            {tabs.map(([key]) => <Tabs.Tab key={key} value={key}>{t(activitySections[key as keyof typeof detailTabs])}</Tabs.Tab>)}
          </Tabs.List>
          <Tabs.Panel value="overview" className="chat-log-detail-panel">{overview}</Tabs.Panel>
          {tabs.map(([tab, keys]) => (
            <Tabs.Panel key={tab} value={tab} className="chat-log-detail-panel">
              {keys.map((key) => details[key] !== undefined && <section className="chat-log-inspector-section" key={key}>
                <h3>{t(activitySections[key])}</h3>
                <RawDetail value={details[key]} />
              </section>)}
            </Tabs.Panel>
          ))}
        </Tabs>
      ) : <div className="chat-log-detail-panel">{overview}</div>}
    </aside>
  );
}

function LogEventRow({ row, current, inspectorId, select }: {
  row: LogRow; current: boolean; inspectorId: string; select: (key: string, trigger: HTMLButtonElement) => void;
}) {
  const { t, clockWithSeconds, date } = useI18n();
  const { event } = row;
  const preview = logRowPreview(row);
  return (
    <li className="chat-log-row">
      <button type="button" className="chat-log-row-button" aria-current={current || undefined}
        aria-controls={current ? inspectorId : undefined} onClick={(event) => select(row.key, event.currentTarget)}>
        <LogLabel row={row} />
        <span className="chat-log-preview">
          {row.kind !== 'assistant' && event?.name && <strong><bdi>{event.name}</bdi></strong>}
          {preview && <bdi>{preview}</bdi>}
          {!preview && !event?.name && (event?.status === 'running' || row.pending) && <span>{t('chat.answering')}</span>}
        </span>
        <span className="chat-log-row-meta">
          <LogStatus row={row} />
          <time dateTime={new Date(row.time).toISOString()} title={date.format(row.time)}>{clockWithSeconds.format(row.time)}</time>
        </span>
      </button>
    </li>
  );
}

function rowGroups(rows: LogRow[], collapse: boolean) {
  const groups: { rows: LogRow[]; folded: boolean }[] = [];
  for (const row of rows) {
    const folded = collapse && row.kind === 'tool';
    const last = groups.at(-1);
    if (folded && last?.folded) last.rows.push(row);
    else groups.push({ rows: [row], folded });
  }
  return groups;
}

function TurnOverview({ turns, current, jump }: { turns: LogTurn[]; current?: number; jump: (id: number) => void }) {
  const { t, number } = useI18n();
  return (
    <nav className="chat-log-overview" aria-label={t('chat.logTurns')}>
      <ol>
        {turns.map((turn) => (
          <li key={turn.id}>
            <button type="button" aria-current={turn.id === current || undefined} onClick={() => jump(turn.id)}>
              <span>{t('chat.logTurn', { number: number.format(turn.number) })}</span>
              <span className="chat-log-track" aria-hidden="true">
                {turn.rows.map((row) => <span key={row.key} data-kind={row.kind} />)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export const ChatLog = memo(function ChatLog({ entries, messages, liveReply, gmMode, onOpenAgent }: {
  entries: ActivityEntry[]; messages: ChatMessage[]; liveReply?: ChatMessage; gmMode: boolean; onOpenAgent: (key: string) => void;
}) {
  const { t } = useI18n();
  const baseTurns = useMemo(() => chatLogTurns(entries, messages), [entries, messages]);
  const turns = liveReply ? withLiveLogReply(baseTurns, liveReply) : baseTurns;
  return <ChatLogView turns={turns} emptyMessage={t(gmMode ? 'chat.gmModeDescription' : 'chat.logEmpty')} onOpenAgent={onOpenAgent} />;
});

export function ChatLogView({ turns, emptyMessage, onOpenAgent }: {
  turns: LogTurn[]; emptyMessage: string; onOpenAgent: (key: string) => void;
}) {
  const { t, locale, number } = useI18n();
  const [query, setQuery] = useState('');
  const [collapse, setCollapse] = useState(false);
  const [selection, select] = useState<string>();
  const search = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const origin = useRef<HTMLButtonElement>(null);
  const id = useId();
  const inspectorId = `${id}-details`;
  const byKey = new Map(turns.flatMap((turn) => turn.rows.map((row) => [row.key, { row, turn }] as const)));
  const selected = selection ? byKey.get(selection) : undefined;
  const selectedKey = selected?.row.key;
  const needle = query.trim().toLocaleLowerCase(locale);
  const visibleTurns = needle ? turns.map((turn) => ({
    ...turn,
    rows: turn.rows.filter((row) => [
      row.text, t(rowLabels[row.kind]), row.event?.name,
    ].some((value) => value?.toLocaleLowerCase(locale).includes(needle)) ||
      (row.event && JSON.stringify(row.event.details).toLocaleLowerCase(locale).includes(needle))),
  })).filter(({ rows }) => rows.length) : turns;
  const matches = needle ? visibleTurns.reduce((total, { rows }) => total + rows.length, 0) : 0;

  useLayoutEffect(() => {
    if (selectedKey) heading.current?.focus({ preventScroll: true });
    else if (origin.current) {
      const trigger = origin.current;
      origin.current = null;
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
      else search.current?.focus({ preventScroll: true });
    }
  }, [selectedKey]);

  function openRow(key: string, trigger: HTMLButtonElement) {
    origin.current = trigger;
    if (key === selectedKey) heading.current?.focus({ preventScroll: true });
    else select(key);
  }

  function jump(turn: number) {
    const target = document.getElementById(`${id}-turn-${turn}`);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'start', inline: 'nearest' });
  }

  if (!turns.length) return <p className="chat-section-empty chat-log-empty">{emptyMessage}</p>;

  const related = selected?.row.sourceKey ? byKey.get(selected.row.sourceKey) : undefined;
  return (
    <div className="chat-log" data-inspecting={Boolean(selected) || undefined}>
      <div className="chat-log-controls">
        <TextInput ref={search} name="log-query" type="search" size="sm" className="chat-log-search"
          aria-label={t('chat.logSearch')} placeholder={t('chat.logSearch')} value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          leftSection={<Search size={16} aria-hidden="true" />} />
        <Button type="button" variant={collapse ? 'light' : 'default'} size="sm" aria-pressed={collapse}
          leftSection={<Layers size={15} aria-hidden="true" />} onClick={() => setCollapse((value) => !value)}>
          {t('chat.logCollapseCalls')}
        </Button>
        <output className="chat-sr-only">{needle && t('chat.logMatches', { count: number.format(matches) })}</output>
      </div>
      {!needle && turns.length > 1 && <TurnOverview turns={turns} current={selected?.turn.id} jump={jump} />}
      <div className="chat-log-body">
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The list scrolls independently via keyboard. */}
        <section className="chat-log-list" aria-label={t('chat.logTrajectory')} tabIndex={0}>
          {!visibleTurns.length && <p className="chat-section-empty">{t('chat.logNoMatches')}</p>}
          {visibleTurns.map((turn) => (
            <section className="chat-log-turn" key={turn.id}>
              <h2 id={`${id}-turn-${turn.id}`} tabIndex={-1}>{t('chat.logTurn', { number: number.format(turn.number) })}</h2>
              <ol className="chat-log-rows">
                {rowGroups(turn.rows, collapse && !needle).map(({ rows, folded }) => {
                  const renderRow = (row: LogRow) => <LogEventRow row={row} key={row.key} inspectorId={inspectorId}
                    current={row.key === selectedKey} select={openRow} />;
                  if (!folded) return renderRow(rows[0]!);
                  const names = [...new Set(rows.flatMap(({ kind, event }) => kind === 'tool' && event?.name ? [event.name] : []))];
                  return (
                    <li className="chat-log-fold" key={rows[0]!.key}>
                      <details>
                        <summary><span>{t('chat.logCallGroup', { count: number.format(rows.length) })}</span>
                          {names.length > 0 && <bdi>{names.join(', ')}</bdi>}</summary>
                        <ol className="chat-log-rows">{rows.map(renderRow)}</ol>
                      </details>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </section>
        {selected && <LogInspector key={selected.row.key} id={inspectorId} heading={heading} row={selected.row}
          turn={selected.turn.number} source={related?.row} onClose={() => select(undefined)} onOpenAgent={onOpenAgent}
          onSource={() => { if (related) select(related.row.key); }} />}
      </div>
    </div>
  );
}
