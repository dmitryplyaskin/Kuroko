import { Button, Modal, Tabs, TextInput } from '@mantine/core';
import { useUnit } from 'effector-react';
import { ArrowDownRight, Bot, CircleAlert, Code, Cpu, Layers, MessageSquare, NotebookText, Search, UserRound, Wrench, X } from 'lucide-react';
import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { ChatMessage } from '@kuroko/contracts/chat';
import type { JsonValue } from '@kuroko/contracts/llm';
import { useI18n } from '../../shared/i18n/i18n';
import { activityObject, ActivityStatus, type ActivityEntry } from './ChatActivity';
import { chatPromptMessages } from './chatApi';
import { chatLogTurns, logRowPreview, withLiveLogReply, type LogRow, type LogTurn } from './chatLogActivity';
import { ChatText } from './ChatText';
import { $promptPreview, promptPreviewHidden, promptPreviewRequested } from './promptPreview';
import logClasses from './ChatLog.module.css';
import chatClasses from './Chat.module.css';

const rowLabels = {
  user: 'chat.logUser', assistant: 'chat.logAssistant', instruction: 'chat.logInstruction',
  model: 'common.model', tool: 'chat.eventTool', reply: 'chat.eventReply',
} as const;
const rowIcons = { user: UserRound, assistant: MessageSquare, instruction: NotebookText, model: Cpu, tool: Wrench, reply: CircleAlert };
const detailLabels = {
  request: 'chat.eventRequest', response: 'chat.eventResponse', arguments: 'chat.toolArguments', result: 'chat.toolResult',
  modelResult: 'chat.eventModelResult', error: 'chat.eventError', instruction: 'instructions.text',
} as const;
const detailTabs = {
  request: ['request'],
  arguments: ['arguments'],
  result: ['result', 'modelResult'],
  response: ['response'],
} as const;

function LogLabel({ row }: { row: LogRow }) {
  const { t } = useI18n();
  const Icon = rowIcons[row.kind];
  return <span className={logClasses['chat-log-label']} data-kind={row.kind}><Icon size={14} aria-hidden="true" />{t(rowLabels[row.kind])}</span>;
}

function LogStatus({ row }: { row: LogRow }) {
  if (row.event) return <ActivityStatus status={row.event.status} />;
  if (row.pending) return <ActivityStatus status="running" />;
  return null;
}

function RawDetail({ value, limit }: { value: JsonValue; limit?: number }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return <pre className={logClasses['chat-log-raw']}>{limit && text.length > limit ? `${text.slice(0, limit)}…` : text}</pre>;
}

function LogSectionTitle({ turn }: { turn?: number }) {
  const { t, number } = useI18n();
  return turn === undefined ? t('chat.logSceneStart') : t('chat.logTurn', { number: number.format(turn) });
}

function LogInspector({ row, turn, source, heading, id, onClose, onSource, onOpenAgent }: {
  row: LogRow; turn?: number; source?: LogRow; heading: Ref<HTMLHeadingElement>; id: string;
  onClose: () => void; onSource: () => void; onOpenAgent: (key: string) => void;
}) {
  const { t, date, number } = useI18n();
  const { event, text } = row;
  const targetAgentKey = event?.targetAgentKey;
  const details = event?.details ?? {};
  const completion = activityObject(details.response);
  const usage = activityObject(completion?.usage);
  const titleId = `${id}-title`;
  const tabs = Object.entries(detailTabs).filter(([, keys]) => keys.some((key) => details[key] !== undefined));
  const model = event?.kind === 'model' ? event.name : undefined;
  const metadata = [
    [t('common.model'), model],
    [t('chat.logProvider'), typeof completion?.provider === 'string' ? completion.provider : undefined],
    [t('chat.logStarted'), row.kind === 'instruction' && !event ? undefined : date.format(row.time)],
    [t('chat.logDuration'), event?.duration === undefined ? undefined
      : t('chat.logSeconds', { time: number.format(event.duration / 1000) })],
    [t('chat.logInputTokens'), typeof usage?.inputTokens === 'number' ? number.format(usage.inputTokens) : undefined],
    [t('chat.logOutputTokens'), typeof usage?.outputTokens === 'number' ? number.format(usage.outputTokens) : undefined],
    [t('chat.logTotalTokens'), typeof usage?.totalTokens === 'number' ? number.format(usage.totalTokens) : undefined],
  ];
  const overview = (
    <>
      {text?.trim() && <div className={logClasses['chat-log-transcript']} data-chat-content>
        <ChatText user={row.kind === 'user'}>{text}</ChatText>
      </div>}
      {row.kind === 'tool' && (['arguments', 'result'] as const).map((key) => details[key] !== undefined && (
        <section className={logClasses['chat-log-inspector-section']} key={key}>
          <h3>{t(detailLabels[key])}</h3>
          <RawDetail value={details[key]} limit={350} />
        </section>
      ))}
      {Object.entries(details).filter(([key]) => !tabs.some(([, keys]) => keys.some((item) => item === key)))
        .map(([key, value]) => (
          <section className={logClasses['chat-log-inspector-section']} key={key}>
            <h3>{Object.hasOwn(detailLabels, key) ? t(detailLabels[key as keyof typeof detailLabels]) : key}</h3>
            <RawDetail value={value} />
          </section>
        ))}
      <dl className={logClasses['chat-log-metadata']}>
        {metadata.map(([label, value]) => value && <div key={label}><dt>{label}</dt><dd><bdi>{value}</bdi></dd></div>)}
      </dl>
      {(source || targetAgentKey) && (
        <div className={logClasses['chat-log-related']}>
          {targetAgentKey && <Button variant="light" size="compact-sm"
            onClick={() => onOpenAgent(targetAgentKey)} leftSection={<Bot size={15} aria-hidden="true" />}>
            {t('chat.logOpenAgent')}
          </Button>}
          {source && <Button variant="subtle" size="compact-sm" className={logClasses['chat-log-source']} onClick={onSource}
            leftSection={<ArrowDownRight size={15} aria-hidden="true" />}>{t('chat.logOpenModel')}</Button>}
        </div>
      )}
    </>
  );
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape dismisses details from any of its controls.
    <aside className={logClasses['chat-log-inspector']} id={id} aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}>
      <header className={logClasses['chat-log-inspector-header']}>
        <div>
          <span className={logClasses['chat-log-turn-number']}><LogSectionTitle turn={turn} /></span>
          <h2 id={titleId} ref={heading} tabIndex={-1}>
            {event?.name ? <bdi>{event.name}</bdi> : t(rowLabels[row.kind])}
          </h2>
          <LogStatus row={row} />
        </div>
        <button type="button" className={['icon-button', logClasses['chat-log-close']].join(' ')} aria-label={t('chat.logCloseDetails')}
          title={t('chat.logCloseDetails')} onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </header>
      {tabs.length ? (
        <Tabs className={logClasses['chat-log-detail-tabs']} defaultValue="overview" keepMounted={false} color="var(--kr-accent)">
          <Tabs.List aria-label={t('chat.logDetails')}>
            <Tabs.Tab value="overview">{t('chat.logOverview')}</Tabs.Tab>
            {tabs.map(([key]) => <Tabs.Tab key={key} value={key}>{t(detailLabels[key as keyof typeof detailTabs])}</Tabs.Tab>)}
          </Tabs.List>
          <Tabs.Panel value="overview" className={logClasses['chat-log-detail-panel']}>{overview}</Tabs.Panel>
          {tabs.map(([tab, keys]) => (
            <Tabs.Panel key={tab} value={tab} className={logClasses['chat-log-detail-panel']}>
              {keys.map((key) => details[key] !== undefined && <section className={logClasses['chat-log-inspector-section']} key={key}>
                <h3>{t(detailLabels[key])}</h3>
                <RawDetail value={details[key]} />
              </section>)}
            </Tabs.Panel>
          ))}
        </Tabs>
      ) : <div className={logClasses['chat-log-detail-panel']}>{overview}</div>}
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
    <li className={logClasses['chat-log-row']}>
      <button type="button" className={logClasses['chat-log-row-button']} aria-current={current || undefined}
        aria-controls={current ? inspectorId : undefined} onClick={(event) => select(row.key, event.currentTarget)}>
        <LogLabel row={row} />
        <span className={logClasses['chat-log-preview']}>
          {row.kind !== 'assistant' && event?.name && <strong><bdi>{event.name}</bdi></strong>}
          {preview && <bdi>{preview}</bdi>}
          {!preview && !event?.name && (event?.status === 'running' || row.pending) && <span>{t('chat.answering')}</span>}
        </span>
        <span className={logClasses['chat-log-row-meta']}>
          <LogStatus row={row} />
          {row.kind !== 'instruction' && <time dateTime={new Date(row.time).toISOString()} title={date.format(row.time)}>
            {clockWithSeconds.format(row.time)}
          </time>}
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
  const { t } = useI18n();
  return (
    <nav className={logClasses['chat-log-overview']} aria-label={t('chat.logTurns')}>
      <ol>
        {turns.map((turn) => (
          <li key={turn.id}>
            <button type="button" aria-current={turn.id === current || undefined} onClick={() => jump(turn.id)}>
              <span><LogSectionTitle turn={turn.number} /></span>
              <span className={logClasses['chat-log-track']} aria-hidden="true">
                {turn.rows.map((row) => <span key={row.key} data-kind={row.kind} />)}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function PromptPreviewControl({ messages, state, reload, gmMode }: {
  messages: ChatMessage[]; state: ReturnType<typeof $promptPreview.getState>; reload: () => void; gmMode: boolean;
}) {
  const { t } = useI18n();
  const [opened, setOpened] = useState(false);
  const description = useId();
  return <>
    <Button type="button" variant="default" size="sm" leftSection={<Code size={15} aria-hidden="true" />} onClick={() => {
      reload();
      setOpened(true);
    }}>{t('chat.logRawPrompt')}</Button>
    <Modal opened={opened} onClose={() => setOpened(false)} title={t('chat.logRawPrompt')} size="xl" centered
      aria-describedby={description} closeButtonProps={{ 'aria-label': t('common.close') }}>
      <p id={description} className={logClasses['chat-log-prompt-description']}>
        {t(gmMode ? 'chat.logRawGmDescription' : 'chat.logRawDescription')}
      </p>
      {(!state || state.status === 'loading') && <output>{t('chat.loading')}</output>}
      {state?.status === 'error' && <div>
        <p role="alert">{t(`error.${state.code}`)}</p>
        <Button type="button" variant="default" onClick={reload}>{t('common.retryLoad')}</Button>
      </div>}
      {state?.status === 'ready' && (
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Let keyboard users scroll the raw messages.
        <pre dir="ltr" tabIndex={0} className={[logClasses['chat-log-raw'], logClasses['chat-log-prompt']].join(' ')}>
          {JSON.stringify(chatPromptMessages(state.data, messages), null, 2)}
        </pre>
      )}
    </Modal>
  </>;
}

export const ChatLog = memo(function ChatLog({ chatId, entries, messages, liveReply, gmMode, visible, onOpenAgent }: {
  chatId: string; entries: ActivityEntry[]; messages: ChatMessage[]; liveReply?: ChatMessage;
  gmMode: boolean; visible: boolean; onOpenAgent: (key: string) => void;
}) {
  const { t } = useI18n();
  const [preview, load, hide] = useUnit([$promptPreview, promptPreviewRequested, promptPreviewHidden]);
  const state = preview?.request.id === chatId ? preview : null;
  const instruction = state?.data?.text;
  const hasPlayerMessage = messages.some(({ role }) => role === 'user');
  useEffect(() => {
    if (!visible || !chatId) return;
    if (!hasPlayerMessage) load(chatId);
    return () => hide();
  }, [visible, chatId, hasPlayerMessage, load, hide]);
  const baseTurns = useMemo(() => visible ? chatLogTurns(entries, messages, instruction) : [], [entries, messages, instruction, visible]);
  const turns = liveReply ? withLiveLogReply(baseTurns, liveReply) : baseTurns;
  return <ChatLogView visible={visible} turns={turns} emptyMessage={t(gmMode ? 'chat.gmModeDescription' : 'chat.logEmpty')} onOpenAgent={onOpenAgent}
    controls={chatId ? <PromptPreviewControl messages={messages} state={state} reload={() => load(chatId)} gmMode={gmMode} /> : undefined} />;
});

export function ChatLogView({ turns, emptyMessage, visible, onOpenAgent, controls }: {
  turns: LogTurn[]; emptyMessage: string; visible: boolean; onOpenAgent: (key: string) => void; controls?: ReactNode;
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
  const numberedTurns = turns.filter(({ number }) => number !== undefined);
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
    if (!visible) return;
    if (selectedKey) heading.current?.focus({ preventScroll: true });
    else if (origin.current) {
      const trigger = origin.current;
      origin.current = null;
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
      else search.current?.focus({ preventScroll: true });
    }
  }, [selectedKey, visible]);

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

  if (!visible) return null;
  if (!turns.length && !controls) return <p className={[chatClasses['chat-section-empty'], logClasses['chat-log-empty']].join(' ')}>{emptyMessage}</p>;

  const related = selected?.row.sourceKey ? byKey.get(selected.row.sourceKey) : undefined;
  return (
    <div className={logClasses['chat-log']} data-inspecting={Boolean(selected) || undefined}>
      <div className={logClasses['chat-log-controls']}>
        <TextInput ref={search} name="log-query" type="search" size="sm" className={logClasses['chat-log-search']}
          aria-label={t('chat.logSearch')} placeholder={t('chat.logSearch')} value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          leftSection={<Search size={16} aria-hidden="true" />} />
        <Button type="button" variant={collapse ? 'light' : 'default'} size="sm" aria-pressed={collapse}
          leftSection={<Layers size={15} aria-hidden="true" />} onClick={() => setCollapse((value) => !value)}>
          {t('chat.logCollapseCalls')}
        </Button>
        {controls}
        <output className={chatClasses['chat-sr-only']}>{needle && t('chat.logMatches', { count: number.format(matches) })}</output>
      </div>
      {!needle && numberedTurns.length > 1 && <TurnOverview turns={numberedTurns} current={selected?.turn.id} jump={jump} />}
      <div className={logClasses['chat-log-body']}>
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The list scrolls independently via keyboard. */}
        <section className={logClasses['chat-log-list']} aria-label={t('chat.logTrajectory')} tabIndex={0}>
          {!visibleTurns.length && <p className={chatClasses['chat-section-empty']}>{turns.length ? t('chat.logNoMatches') : emptyMessage}</p>}
          {visibleTurns.map((turn) => (
            <section className={logClasses['chat-log-turn']} key={turn.id}>
              <h2 id={`${id}-turn-${turn.id}`} tabIndex={-1}><LogSectionTitle turn={turn.number} /></h2>
              <ol className={logClasses['chat-log-rows']}>
                {rowGroups(turn.rows, collapse && !needle).map(({ rows, folded }) => {
                  const renderRow = (row: LogRow) => <LogEventRow row={row} key={row.key} inspectorId={inspectorId}
                    current={row.key === selectedKey} select={openRow} />;
                  if (!folded) return renderRow(rows[0]!);
                  const names = [...new Set(rows.flatMap(({ event }) => event?.name ? [event.name] : []))];
                  return (
                    <li className={logClasses['chat-log-fold']} key={rows[0]!.key}>
                      <details>
                        <summary><span>{t('chat.logCallGroup', { count: number.format(rows.length) })}</span>
                          {names.length > 0 && <bdi>{names.join(', ')}</bdi>}</summary>
                        <ol className={logClasses['chat-log-rows']}>{rows.map(renderRow)}</ol>
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
