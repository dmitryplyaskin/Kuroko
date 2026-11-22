import { Button } from '@mantine/core';
import { ArrowLeft, Bot, ChevronRight, List, MessageSquare } from 'lucide-react';
import { memo, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { ActivityStatus, AgentName, useAgentName, type ActivityEntry, type Agent } from './ChatActivity';
import { ChatLogView } from './ChatLog';
import { ChatMessageFrame } from './ChatMessage';
import { ChatText } from './ChatText';
import { agentLogTurns, type LogRow } from './chatLogActivity';

type ConversationRow = { row: LogRow; tools: ActivityEntry[] };

function conversationRows(rows: LogRow[]) {
  const conversation: ConversationRow[] = [];
  for (const row of rows) {
    const last = conversation.at(-1);
    if (row.kind === 'tool' && row.event) {
      if (last && last.row.kind !== 'user') last.tools.push(row.event);
      else conversation.push({ row, tools: [row.event] });
    } else conversation.push({ row, tools: [] });
  }
  return conversation;
}

function AgentToolCalls({ calls, onOpen }: { calls: ActivityEntry[]; onOpen: (key: string) => void }) {
  const { t } = useI18n();
  return (
    <ul className="chat-tool-calls" aria-label={t('chat.toolCalls')}>
      {calls.map(({ key, name, status, details, targetAgentKey }) => (
        <li key={key}>
          <details className="chat-tool-call">
            <summary><code>{name}</code> <ActivityStatus status={status} /></summary>
            <dl>
              {details.arguments !== undefined && <><dt>{t('chat.toolArguments')}</dt><dd><pre>{JSON.stringify(details.arguments, null, 2)}</pre></dd></>}
              {details.result !== undefined && <><dt>{t('chat.toolResult')}</dt><dd><pre>{JSON.stringify(details.result, null, 2)}</pre></dd></>}
              {targetAgentKey && <dd>
                <Button variant="light" size="compact-sm" onClick={() => onOpen(targetAgentKey)}>
                  {t('chat.logOpenAgent')}
                </Button>
              </dd>}
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function AgentToolbar({ agent, heading, showLog, onBack, onToggleLog }: {
  agent: Agent; heading: RefObject<HTMLHeadingElement | null>; showLog: boolean; onBack: () => void; onToggleLog: () => void;
}) {
  const { t } = useI18n();
  const backLabel = t(agent.parentKey ? 'chat.backToParentAgent' : 'chat.backToAgents');
  const ViewIcon = showLog ? MessageSquare : List;
  return (
    <div className="chat-agent-context">
      <button type="button" className="icon-button chat-agent-back" aria-label={backLabel} title={backLabel} onClick={onBack}>
        <ArrowLeft size={17} aria-hidden="true" />
      </button>
      <div className="chat-agent-heading">
        <h2 ref={heading} tabIndex={-1}><AgentName agent={agent.identity} /></h2>
        <ActivityStatus status={agent.tasks.at(-1)!.entry.status} />
      </div>
      <button type="button" className="icon-button chat-agent-log-toggle" onClick={onToggleLog}>
        <ViewIcon size={15} aria-hidden="true" />
        {t(showLog ? 'chat.agentConversation' : 'chat.agentLog')}
      </button>
    </div>
  );
}

function AgentSession({ agent, showLog, onSelect }: {
  agent: Agent; showLog: boolean; onSelect: (key?: string) => void;
}) {
  const { t } = useI18n();
  const history = useRef<HTMLElement>(null);
  const atEnd = useRef(true);
  const name = useAgentName(agent.identity);
  const turns = useMemo(() => agentLogTurns(agent.tasks), [agent.tasks]);

  useLayoutEffect(() => {
    if (!showLog && atEnd.current && history.current) history.current.scrollTop = history.current.scrollHeight;
  }, [showLog, turns]);

  return (
    <div className="chat-agent-session">
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The agent transcript scrolls independently. */}
      <section className="chat-history chat-agent-conversation" ref={history} aria-label={t('chat.agentHistory')} tabIndex={0}
        hidden={showLog} onScroll={(event) => {
          const viewport = event.currentTarget;
          if (viewport.clientHeight) atEnd.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 8;
        }}>
        <div className="chat-timeline">
          {turns.map(({ id, rows }) => (
            <div key={id} className="chat-agent-exchange">
              {conversationRows(rows).map(({ row, tools }) => {
                const user = row.kind === 'user';
                const pending = row.pending || row.event?.status === 'running';
                const failed = row.event?.status === 'failed' || row.event?.status === 'stopped';
                const error = row.event?.details.error;
                if (!row.text?.trim() && !tools.length && !pending && !failed) return null;
                return (
                  <ChatMessageFrame key={row.key} role={user ? 'user' : 'assistant'} heading="h3"
                    author={user ? t('chat.agentTask') : name} time={row.time}>
                    <div className="chat-message-blocks">
                      {row.text?.trim() && <ChatText user={user}>{row.text}</ChatText>}
                      {tools.length > 0 && <AgentToolCalls calls={tools} onOpen={onSelect} />}
                      {pending && !tools.length && !row.text && <p className="chat-typing">{t('chat.answering')}</p>}
                      {failed && row.event && <ActivityStatus status={row.event.status} />}
                      {typeof error === 'string' && <p className="chat-agent-error">{error}</p>}
                    </div>
                  </ChatMessageFrame>
                );
              })}
            </div>
          ))}
        </div>
      </section>
      <div className="chat-log-pane" hidden={!showLog}>
        <ChatLogView turns={turns} emptyMessage={t('chat.logEmpty')} onOpenAgent={onSelect} />
      </div>
    </div>
  );
}

export const ChatAgents = memo(function ChatAgents({ agents, agent, heading, showLog, onSelect }: {
  agents: Agent[]; agent?: Agent; heading: RefObject<HTMLHeadingElement | null>;
  showLog: boolean; onSelect: (key?: string) => void;
}) {
  const { t } = useI18n();
  const selectedKey = agent?.key;
  const rootKey = agent?.parentKey ? undefined : selectedKey;
  const lastRoot = useRef<string>(undefined);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const listHeading = useRef<HTMLHeadingElement>(null);

  useLayoutEffect(() => {
    if (selectedKey) {
      if (rootKey) lastRoot.current = rootKey;
      heading.current?.focus({ preventScroll: true });
    }
    else if (lastRoot.current) {
      const target = triggers.current.get(lastRoot.current) ?? listHeading.current;
      target?.focus({ preventScroll: true });
      lastRoot.current = undefined;
    }
  }, [heading, selectedKey, rootKey]);

  if (agent) {
    return <AgentSession key={selectedKey} agent={agent} showLog={showLog} onSelect={onSelect} />;
  }

  return (
    <section className="chat-agent-directory">
      <div className="chat-column">
        <h2 ref={listHeading} tabIndex={-1}>{t('chat.agents')}</h2>
        <ul className="chat-agent-list">
          {agents.filter(({ parentKey }) => !parentKey).map((agent) => (
            <li key={agent.key}>
              <button ref={(element) => { if (element) triggers.current.set(agent.key, element); else triggers.current.delete(agent.key); }}
                type="button" className="chat-agent-button" onClick={() => onSelect(agent.key)}>
                <span className="icon-tile account-avatar chat-avatar" aria-hidden="true"><Bot size={18} /></span>
                <strong><AgentName agent={agent.identity} /></strong>
                <ActivityStatus status={agent.tasks.at(-1)!.entry.status} />
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
});
