import { readDelegatedTask, readSubagentName } from '@kuroko/contracts/tools';
import type { ChatActivityEntry, ChatActivityTurn, ChatMessage, ChatToolCall } from '@kuroko/contracts/chat';
import type { JsonValue } from '@kuroko/contracts/llm';
import { ArrowLeft, Bot, ChevronRight, CircleDot, Cpu, Wrench } from 'lucide-react';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { ChatText } from './ChatText';

function asObject(value: JsonValue | undefined) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

function legacyEntries({ toolCalls, time }: ChatMessage): ChatActivityEntry[] {
  function toolEntry(call: ChatToolCall, id: string, agentId?: string): ChatActivityEntry {
    return {
      id, agentId, kind: 'tool', time, name: call.name, status: call.isError ? 'failed' : 'completed',
      details: { arguments: call.arguments, result: call.result },
    };
  }
  return (toolCalls ?? []).flatMap((call, index): ChatActivityEntry[] => {
    const id = `tool-${index}`;
    const tool = toolEntry(call, id);
    const task = call.name === 'delegate_task' && readDelegatedTask(call.arguments.task);
    const result = asObject(call.result);
    if (!task || !result) return [tool];
    const agentId = `agent-${index}`;
    const agent: ChatActivityEntry = {
      id: agentId, kind: 'agent', time, name: readSubagentName(call.arguments.name), status: tool.status,
      details: { task, result: call.result },
    };
    const nested = Array.isArray(result.toolCalls) ? result.toolCalls.flatMap((value, index) => {
      const call = asObject(value);
      const args = asObject(call?.arguments);
      if (!call || typeof call.name !== 'string' || !args || call.result === undefined) return [];
      return [toolEntry({ id: '', name: call.name, arguments: args, result: call.result, isError: call.isError === true },
        `${agentId}/${index}`, agentId)];
    }) : [];
    return [tool, agent, ...nested];
  });
}

type AgentIdentity = { name?: string; number: number };
type Entry = ChatActivityEntry & { key: string; agent?: AgentIdentity };
type Agent = { key: string; identity: AgentIdentity; tasks: { entry: Entry; activity: Entry[] }[] };

export function chatActivityView(turns: ChatActivityTurn[], messages: ChatMessage[]) {
  const byPrompt = new Map(turns.map((turn) => [turn.promptId, turn.entries]));
  for (const message of messages) {
    if (message.role !== 'assistant' || byPrompt.has(message.id - 1) || !message.toolCalls?.length) continue;
    byPrompt.set(message.id - 1, legacyEntries(message));
  }
  const entries: Entry[] = [];
  const agents = new Map<string, Agent>();
  let anonymous = 0;
  for (const [promptId, turn] of [...byPrompt].sort(([a], [b]) => a - b)) {
    const tasks = new Map<string, { agent: Agent; task: Agent['tasks'][number] }>();
    for (const item of turn) {
      const key = `${promptId}:${item.id}`;
      const parent = item.agentId ? tasks.get(item.agentId) : undefined;
      const entry: Entry = { ...item, key, agent: parent?.agent.identity };
      entries.push(entry);
      if (item.kind === 'agent') {
        const agentKey = item.name ? `name:${item.name.toLowerCase()}` : key;
        const agent = agents.get(agentKey) ?? {
          key: agentKey, identity: { name: item.name, number: item.name ? 0 : ++anonymous }, tasks: [],
        };
        entry.agent = agent.identity;
        const task = { entry, activity: [] };
        agent.tasks.push(task);
        agents.set(agentKey, agent);
        tasks.set(item.id, { agent, task });
      }
      parent?.task.activity.push(entry);
    }
  }
  return { entries, agents: [...agents.values()] };
}

const labels = { reply: 'chat.eventReply', model: 'chat.eventModel', tool: 'chat.eventTool', agent: 'chat.eventAgent' } as const;
const icons = { reply: CircleDot, model: Cpu, tool: Wrench, agent: Bot };
const sections = {
  request: 'chat.eventRequest', response: 'chat.eventResponse',
  task: 'chat.agentTask', arguments: 'chat.toolArguments', result: 'chat.toolResult',
  modelResult: 'chat.eventModelResult', error: 'chat.eventError',
} as const;

function Status({ status }: { status: ChatActivityEntry['status'] }) {
  const { t } = useI18n();
  return <span className="chat-event-status" data-status={status}>{t(`chat.activity.${status}`)}</span>;
}

function AgentName({ agent }: { agent: AgentIdentity }) {
  const { t, number } = useI18n();
  return <bdi>{agent.name || t('chat.anonymousAgent', { number: number.format(agent.number) })}</bdi>;
}

function ActivityRow({ entry, children }: { entry: Entry; children?: ReactNode }) {
  const { t, clockWithSeconds, date, number } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const Icon = icons[entry.kind];
  return (
    <li className="chat-event-row" data-agent={Boolean(entry.agentId) || undefined}>
      <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>
          <ChevronRight size={14} className="chat-event-chevron" aria-hidden="true" />
          <Icon size={16} className="chat-event-icon" aria-hidden="true" />
          <span className="chat-event-label">
            <span>{t(labels[entry.kind])}</span>
            {entry.kind === 'agent' && entry.agent ? <AgentName agent={entry.agent} /> : entry.name && <bdi>{entry.name}</bdi>}
            {entry.agentId && entry.agent && <span className="chat-event-agent"><AgentName agent={entry.agent} /></span>}
          </span>
          <Status status={entry.status} />
          <time dateTime={new Date(entry.time).toISOString()} title={date.format(entry.time)}>{clockWithSeconds.format(entry.time)}</time>
        </summary>
        {expanded && <div className="chat-event-detail">
          {entry.duration !== undefined && <p>{t('chat.duration', { time: number.format(Math.round(entry.duration / 100) / 10) })}</p>}
          {Object.entries(entry.details).map(([key, value]) => (
            <div key={key}>
              <h3>{Object.hasOwn(sections, key) ? t(sections[key as keyof typeof sections]) : key}</h3>
              <pre>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</pre>
            </div>
          ))}
        </div>}
      </details>
      {children && <div className="chat-event-text">{children}</div>}
    </li>
  );
}

export const ChatLog = memo(function ChatLog({ entries, gmMode }: { entries: Entry[]; gmMode: boolean }) {
  const { t } = useI18n();
  return (
    <div className="chat-column">
      {entries.length
        ? <ol className="chat-event-list">{entries.map((entry) => <ActivityRow key={entry.key} entry={entry} />)}</ol>
        : <p className="chat-section-empty">{t(gmMode ? 'chat.gmModeDescription' : 'chat.logEmpty')}</p>}
    </div>
  );
});

function modelText(entry: Entry) {
  const parts = asObject(asObject(entry.details.response)?.message)?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.flatMap((value) => {
    const part = asObject(value);
    return part?.type === 'text' && typeof part.text === 'string' ? [part.text] : [];
  }).join('').trim();
}

export const ChatAgents = memo(function ChatAgents({ agents }: { agents: Agent[] }) {
  const { t } = useI18n();
  const [selected, select] = useState<string>();
  const selectedAgent = agents.find(({ key }) => key === selected);
  const selectedAgentKey = selectedAgent?.key;
  const heading = useRef<HTMLHeadingElement>(null);
  const lastTrigger = useRef<string>(undefined);
  const triggers = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (selectedAgentKey) {
      heading.current?.focus();
    } else if (lastTrigger.current) {
      triggers.current.get(lastTrigger.current)?.focus();
      lastTrigger.current = undefined;
    }
  }, [selectedAgentKey]);

  if (!selectedAgent) {
    return (
      <ul className="chat-agent-list chat-column">
        {agents.map((agent) => (
          <li key={agent.key}>
            <button ref={(element) => { if (element) triggers.current.set(agent.key, element); else triggers.current.delete(agent.key); }}
              type="button" className="chat-agent-button" onClick={() => { lastTrigger.current = agent.key; select(agent.key); }}>
              <Bot size={18} aria-hidden="true" />
              <span><AgentName agent={agent.identity} /></span>
              <Status status={agent.tasks.at(-1)!.entry.status} />
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="chat-agent-thread chat-column">
      <button type="button" className="icon-button chat-agent-back" onClick={() => select(undefined)}>
        <ArrowLeft size={16} aria-hidden="true" />{t('chat.backToAgents')}
      </button>
      <h2 ref={heading} tabIndex={-1}><AgentName agent={selectedAgent.identity} /></h2>
      {selectedAgent.tasks.map(({ entry, activity }) => {
        const answer = asObject(entry.details.result)?.answer;
        const error = typeof entry.details.result === 'string' ? entry.details.result : asObject(entry.details.result)?.error;
        const lastModel = activity.findLast(({ kind }) => kind === 'model');
        return (
          <section className="chat-agent-task" key={entry.key}>
            <header><h3>{t('chat.agentTask')}</h3><Status status={entry.status} /></header>
            {typeof entry.details.task === 'string' && <ChatText>{entry.details.task}</ChatText>}
            {activity.length > 0 && (
              <ol className="chat-event-list">
                {activity.map((item) => {
                  const text = item.kind === 'model' && modelText(item);
                  return <ActivityRow key={item.key} entry={item}>
                    {text && (item !== lastModel || text !== answer) && <ChatText>{text}</ChatText>}
                  </ActivityRow>;
                })}
              </ol>
            )}
            {typeof answer === 'string' && <div className="chat-agent-answer"><h3>{t('chat.agentAnswer')}</h3><ChatText>{answer}</ChatText></div>}
            {typeof error === 'string' && <p className="chat-manager-error">{error}</p>}
          </section>
        );
      })}
    </div>
  );
});
