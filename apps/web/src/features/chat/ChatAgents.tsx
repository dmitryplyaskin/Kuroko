import { Button } from '@mantine/core';
import { ArrowLeft, Bot, ChevronRight } from 'lucide-react';
import { memo, useLayoutEffect, useRef, type RefObject } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { ActivityStatus, AgentName, useAgentName, type ActivityEntry, type Agent } from './ChatActivity';
import { ChatMessageFrame } from './ChatMessage';
import { ChatText } from './ChatText';
import type { LogRow, LogTurn } from './chatLogActivity';
import chatClasses from './Chat.module.css';

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
    <ul className={chatClasses['chat-tool-calls']} aria-label={t('chat.toolCalls')}>
      {calls.map(({ key, name, status, details, targetAgentKey }) => (
        <li key={key}>
          <details className={chatClasses['chat-tool-call']}>
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

export function AgentToolbar({ agent, heading, onBack }: {
  agent: Agent; heading: RefObject<HTMLHeadingElement | null>; onBack: () => void;
}) {
  const { t } = useI18n();
  const backLabel = t(agent.parentKey ? 'chat.backToParentAgent' : 'chat.backToMainChat');
  return (
    <div className={chatClasses['chat-agent-context']}>
      <button type="button" className={['icon-button', chatClasses['chat-agent-back']].join(' ')} aria-label={backLabel} title={backLabel} onClick={onBack}>
        <ArrowLeft size={17} aria-hidden="true" />
      </button>
      <h2 id="chat-agent-title" ref={heading} tabIndex={-1}><AgentName agent={agent.identity} /></h2>
    </div>
  );
}

export const AgentConversation = memo(function AgentConversation({ agent, turns, visible, onSelect }: {
  agent: Agent; turns: LogTurn[]; visible: boolean; onSelect: (key: string) => void;
}) {
  const { t } = useI18n();
  const history = useRef<HTMLElement>(null);
  const atEnd = useRef(true);
  const name = useAgentName(agent.identity);

  useLayoutEffect(() => {
    if (visible && atEnd.current && history.current) history.current.scrollTop = history.current.scrollHeight;
  }, [visible, turns]);

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The agent transcript scrolls independently.
    <section className={[chatClasses['chat-history'], chatClasses['chat-agent-conversation']].join(' ')} ref={history} aria-label={t('chat.agentHistory')} tabIndex={0}
      onScroll={(event) => {
        const viewport = event.currentTarget;
        if (viewport.clientHeight) atEnd.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 8;
      }}>
      <div className={chatClasses['chat-timeline']}>
        {turns.map(({ id, rows }) => (
          <div key={id} className={chatClasses['chat-agent-exchange']}>
            {conversationRows(rows).map(({ row, tools }) => {
              const user = row.kind === 'user';
              const pending = row.pending || row.event?.status === 'running';
              const failed = row.event?.status === 'failed' || row.event?.status === 'stopped';
              const error = row.event?.details.error;
              if (!row.text?.trim() && !tools.length && !pending && !failed) return null;
              return (
                <ChatMessageFrame key={row.key} role={user ? 'user' : 'assistant'} heading="h3"
                  author={user ? t('chat.agentTask') : name} time={row.time}>
                  <div className={chatClasses['chat-message-blocks']}>
                    {row.text?.trim() && <ChatText user={user}>{row.text}</ChatText>}
                    {tools.length > 0 && <AgentToolCalls calls={tools} onOpen={onSelect} />}
                    {pending && !tools.length && !row.text && <p className={chatClasses['chat-typing']}>{t('chat.answering')}</p>}
                    {failed && row.event && <ActivityStatus status={row.event.status} />}
                    {typeof error === 'string' && <p className={chatClasses['chat-agent-error']}>{error}</p>}
                  </div>
                </ChatMessageFrame>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
});

export const ChatAgents = memo(function ChatAgents({ agents, onSelect }: {
  agents: Agent[]; onSelect: (key: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section className={chatClasses['chat-agent-directory']}>
      <div className={chatClasses['chat-column']}>
        <h2>{t('chat.agents')}</h2>
        <ul className={chatClasses['chat-agent-list']}>
          {agents.filter(({ parentKey }) => !parentKey).map((agent) => (
            <li key={agent.key}>
              <button type="button" className={chatClasses['chat-agent-button']} onClick={() => onSelect(agent.key)}>
                <span className={['icon-tile', 'account-avatar', chatClasses['chat-avatar']].join(' ')} aria-hidden="true"><Bot size={18} /></span>
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
