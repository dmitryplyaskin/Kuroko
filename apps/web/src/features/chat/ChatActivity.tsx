import { isAgentId } from '@kuroko/contracts/agents';
import { isSubagentTool, readDelegatedTask, readSubagentName, readSubagentResultName } from '@kuroko/contracts/tools';
import type { ChatActivityEntry, ChatActivityTurn, ChatMessage, ChatToolCall } from '@kuroko/contracts/chat';
import type { JsonValue } from '@kuroko/contracts/llm';
import { useI18n } from '../../shared/i18n/i18n';
import chatClasses from './Chat.module.css';

export function activityObject(value: JsonValue | undefined) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
}

type SourceEntry = ChatActivityEntry & { legacyCallId?: string };

export function activityToolDetails(entry: ActivityEntry) {
  if (entry.kind !== 'tool' || !isSubagentTool(entry.name)) return entry.details;
  const { callId: _, result, modelResult, ...details } = entry.details;
  const returned = modelResult ?? result;
  const object = activityObject(returned);
  if (object && Object.hasOwn(object, 'toolCalls')) {
    const { toolCalls: _, ...summary } = object;
    return { ...details, result: summary };
  }
  return returned === undefined ? details : { ...details, result: returned };
}

function legacyEntries({ toolCalls, time }: ChatMessage): SourceEntry[] {
  function toolEntry(call: ChatToolCall, id: string, agentId?: string): ChatActivityEntry {
    return {
      id, agentId, kind: 'tool', time, name: call.name, status: call.isError ? 'failed' : 'completed',
      details: {
        arguments: call.arguments, result: call.result,
        ...(call.modelResult !== undefined && { modelResult: call.modelResult }),
      },
    };
  }
  return (toolCalls ?? []).flatMap((call, index): SourceEntry[] => {
    const id = `tool-${index}`;
    const tool = toolEntry(call, id);
    const task = isSubagentTool(call.name) && readDelegatedTask(call.arguments.task);
    const result = activityObject(call.result);
    if (!task || !result) return [{ ...tool, legacyCallId: call.id }];
    const agentId = `agent-${index}`;
    const name = readSubagentName(call.arguments.name);
    const agent: ChatActivityEntry = {
      id: agentId, kind: 'agent', time, name: readSubagentResultName(call.result) ?? name, status: tool.status,
      details: {
        task, result: call.result,
        ...(isAgentId(call.arguments.agentId) && { savedAgentId: call.arguments.agentId, ...(name && { instanceName: name }) }),
      },
    };
    const nested = Array.isArray(result.toolCalls) ? result.toolCalls.flatMap((value, index) => {
      const call = activityObject(value);
      const args = activityObject(call?.arguments);
      if (!call || typeof call.name !== 'string' || !args || call.result === undefined) return [];
      return [toolEntry({ id: '', name: call.name, arguments: args, result: call.result, isError: call.isError === true },
        `${agentId}/${index}`, agentId)];
    }) : [];
    return [tool, agent, ...nested].map((entry) => ({ ...entry, legacyCallId: call.id }));
  });
}

export type AgentIdentity = { name?: string; number: number };
export type ActivityEntry = SourceEntry & { key: string; promptId: number; targetAgentKey?: string };
export type AgentTask = { entry: ActivityEntry; activity: ActivityEntry[] };
export type Agent = { key: string; parentKey?: string; identity: AgentIdentity; tasks: AgentTask[] };

export function chatActivityView(turns: ChatActivityTurn[], messages: ChatMessage[]) {
  const byPrompt = new Map<number, SourceEntry[]>(turns.map((turn) => [turn.promptId, turn.entries]));
  for (const message of messages) {
    if (message.role !== 'assistant' || byPrompt.has(message.id - 1) || !message.toolCalls?.length) continue;
    byPrompt.set(message.id - 1, legacyEntries(message));
  }
  const entries: ActivityEntry[] = [];
  const agents = new Map<string, Agent>();
  let anonymous = 0;
  for (const [promptId, turn] of [...byPrompt].sort(([a], [b]) => a - b)) {
    const tasks = new Map<string, { agent: Agent; task: AgentTask }>();
    const delegates = new Map<string, ActivityEntry>();
    for (const item of turn) {
      const key = `${promptId}:${item.id}`;
      const parent = item.agentId ? tasks.get(item.agentId) : undefined;
      const entry: ActivityEntry = { ...item, key, promptId };
      entries.push(entry);
      const callId = item.details.callId ?? item.legacyCallId;
      const delegateKey = JSON.stringify([item.agentId, callId]);
      if (item.kind === 'tool' && isSubagentTool(item.name)) delegates.set(delegateKey, entry);
      if (item.kind === 'agent') {
        const parentKey = parent?.agent.key;
        const savedId = isAgentId(item.details.savedAgentId) ? item.details.savedAgentId : undefined;
        const instanceName = readSubagentName(item.details.instanceName)?.toLowerCase();
        const agentKey = savedId ? JSON.stringify([parentKey, 'saved', savedId, instanceName])
          : item.name ? JSON.stringify([parentKey, item.name.toLowerCase()]) : key;
        const agent = agents.get(agentKey) ?? {
          key: agentKey, parentKey, identity: { name: item.name, number: item.name ? 0 : ++anonymous }, tasks: [],
        };
        const task = { entry, activity: [] };
        if (savedId && item.name) agent.identity.name = item.name;
        agent.tasks.push(task);
        agents.set(agentKey, agent);
        tasks.set(item.id, { agent, task });
        const delegate = delegates.get(delegateKey);
        if (delegate) {
          const args = activityObject(delegate.details.arguments);
          if (callId !== undefined || (readDelegatedTask(args?.task) === item.details.task && readSubagentName(args?.name) === item.name)) {
            delegate.targetAgentKey = agentKey;
            delegates.delete(delegateKey);
          }
        }
      }
      parent?.task.activity.push(entry);
    }
  }
  return { entries, agents: [...agents.values()] };
}

export function ActivityStatus({ status }: { status: ChatActivityEntry['status'] }) {
  const { t } = useI18n();
  return <span className={chatClasses['chat-event-status']} data-status={status}>{t(`chat.activity.${status}`)}</span>;
}

export function useAgentName(agent: AgentIdentity) {
  const { t, number } = useI18n();
  return agent.name || t('chat.anonymousAgent', { number: number.format(agent.number) });
}

export function AgentName({ agent }: { agent: AgentIdentity }) {
  return <bdi>{useAgentName(agent)}</bdi>;
}

export function activityModelText(entry: ActivityEntry) {
  const parts = activityObject(activityObject(entry.details.response)?.message)?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.flatMap((value) => {
    const part = activityObject(value);
    return part?.type === 'text' && typeof part.text === 'string' ? [part.text] : [];
  }).join('');
}
