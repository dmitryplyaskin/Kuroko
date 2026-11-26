import type { ChatMessage } from '@kuroko/contracts/chat';
import type { JsonValue } from '@kuroko/contracts/llm';
import { messageBlocks } from '@kuroko/tool-runtime/chatHistory';
import { activityModelText, activityObject, activityToolDetails, type ActivityEntry, type AgentTask } from './ChatActivity';

type LogEvent = ActivityEntry & { kind: Exclude<ActivityEntry['kind'], 'agent'> };

export type LogRow = {
  key: string;
  kind: LogEvent['kind'] | ChatMessage['role'];
  time: number;
  text?: string;
  event?: LogEvent;
  sourceKey?: string;
  pending?: boolean;
};

export type LogTurn = { id: number; number: number; rows: LogRow[] };
type Turn = { user?: ChatMessage; reply?: ChatMessage; entries: ActivityEntry[] };

function messageRow(message: ChatMessage, text = message.text, key = `message-${message.id}`): LogRow {
  return { key, kind: message.role, time: message.time, text };
}

function eventRow(event: LogEvent, sourceKey?: string): LogRow {
  const text = event.kind === 'model' ? activityModelText(event) : undefined;
  return {
    key: event.key, kind: text?.trim() ? 'assistant' : event.kind, time: event.time, text,
    event: { ...event, details: activityToolDetails(event) }, sourceKey,
  };
}

function recordedRows(entries: ActivityEntry[], agentId?: string) {
  const rows: LogRow[] = [];
  let lastModel: string | undefined;
  let summary: LogEvent | undefined;
  const events = entries.filter((entry): entry is LogEvent =>
    entry.agentId === agentId && entry.kind !== 'agent' && entry.kind !== 'instruction');
  for (const event of events) {
    if (event.kind === 'reply') {
      summary ??= event;
      continue;
    }
    if (event.kind === 'model') lastModel = event.key;
    rows.push(eventRow(event, event.kind === 'tool' ? lastModel : undefined));
  }
  if (summary && (!rows.length || summary.status === 'failed' || summary.status === 'stopped')) rows.push(eventRow(summary));
  return rows;
}

function savedRows(reply: ChatMessage, entries: ActivityEntry[]) {
  if (!reply.toolCalls?.length) return reply.text.trim() ? [messageRow(reply)] : [];
  const tools = entries.filter((entry): entry is LogEvent => !entry.agentId && entry.kind === 'tool');
  const byCall = Map.groupBy(tools, ({ legacyCallId }) => legacyCallId);
  return messageBlocks(reply).flatMap((block, index) => block.kind === 'text'
    ? [messageRow(reply, block.text, `message-${reply.id}-${index}`)]
    : block.calls.flatMap(({ id }) => (byCall.get(id) ?? []).map((entry) => eventRow(entry))));
}

function withLatestText(rows: LogRow[], reply: ChatMessage, pending: boolean) {
  const models = rows.filter(({ event }) => event?.kind === 'model' && !event.agentId);
  const target = models.findLast(({ event }) => event?.status === 'running' || event?.status === 'stopped' || event?.status === 'failed');
  if (!target && models.some(({ text }) => text?.trim())) return rows;

  // The chat joins textual rounds with a blank line. Remove the rounds the log already displays.
  const logged = models.reduce((text, row) => row.text ? `${text}${text.trim() ? '\n\n' : ''}${row.text}` : text, '');
  const remaining = reply.text.startsWith(logged) ? reply.text.slice(logged.length).trim() : '';
  if (target) return remaining
    ? rows.map((row) => row === target ? { ...row, kind: 'assistant' as const, text: remaining } : row)
    : rows;

  if (!remaining && (!pending || rows.some(({ kind }) => kind !== 'user' && kind !== 'instruction'))) return rows;
  return [...rows, { ...messageRow(reply, remaining), pending }];
}

export function chatLogTurns(entries: ActivityEntry[], messages: ChatMessage[]): LogTurn[] {
  const turns = new Map<number, Turn>();
  function turnFor(id: number) {
    const turn = turns.get(id) ?? { entries: [] };
    turns.set(id, turn);
    return turn;
  }
  for (const message of messages) {
    if (message.role === 'user') turnFor(message.id).user = message;
    else turnFor(message.id - 1).reply = message;
  }
  for (const entry of entries) turnFor(entry.promptId).entries.push(entry);

  let previousInstruction: string | undefined;
  return [...turns].sort(([a], [b]) => a - b).map(([id, { user, reply, entries }], index) => {
    const rows: LogRow[] = [];
    const instruction = entries.find((entry): entry is LogEvent => !entry.agentId && entry.kind === 'instruction');
    if (instruction && typeof instruction.details.instruction === 'string') {
      if (instruction.details.instruction !== previousInstruction) rows.push(eventRow(instruction));
      previousInstruction = instruction.details.instruction;
    } else if (reply || entries.some(({ agentId, kind }) => !agentId && kind === 'model')) {
      previousInstruction = undefined;
    }
    if (user) rows.push(messageRow(user));
    if (reply && (!entries.length || entries[0]?.legacyCallId !== undefined)) rows.push(...savedRows(reply, entries));
    else {
      const recorded = recordedRows(entries);
      rows.push(...(reply ? withLatestText(recorded, reply, false) : recorded));
    }
    return { id, number: index + 1, rows };
  });
}

export function agentLogTurns(tasks: AgentTask[]): LogTurn[] {
  return tasks.map(({ entry, activity }, index) => {
    const rows: LogRow[] = [];
    if (typeof entry.details.task === 'string') {
      rows.push({ key: `${entry.key}-task`, kind: 'user', time: entry.time, text: entry.details.task });
    }
    rows.push(...recordedRows(activity, entry.id));
    const result = entry.details.result;
    const answer = activityObject(result)?.answer;
    const lastModel = rows.findLast(({ event }) => event?.kind === 'model');
    const endTime = Math.min(entry.time + (entry.duration ?? 0), 8.64e15);
    if (typeof answer === 'string' && answer.trim() !== lastModel?.text?.trim()) {
      rows.push({ key: `${entry.key}-answer`, kind: 'assistant', time: endTime, text: answer });
    }
    if (entry.status === 'failed' || entry.status === 'stopped') {
      const error = typeof result === 'string' ? result : activityObject(result)?.error;
      rows.push(eventRow({ ...entry, kind: 'reply', name: undefined, time: endTime,
        details: typeof error === 'string' ? { error } : {} }));
    } else if (!lastModel && entry.status === 'running') {
      rows.push({ key: `${entry.key}-answer`, kind: 'assistant', time: entry.time, pending: true });
    }
    return { id: index + 1, number: index + 1, rows };
  });
}

export function withLiveLogReply(turns: LogTurn[], reply: ChatMessage): LogTurn[] {
  return turns.map((turn) => turn.id === reply.id - 1
    ? { ...turn, rows: withLatestText(turn.rows, reply, true) }
    : turn);
}

function preview(value: JsonValue | undefined, limit?: number) {
  if (value === undefined) return '';
  const answer = activityObject(value)?.answer;
  const text = typeof answer === 'string' ? answer : typeof value === 'string' ? value : JSON.stringify(value);
  return limit && text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function logRowPreview({ kind, text, event }: LogRow) {
  if (text) return text;
  if (!event) return '';
  if (kind === 'instruction') return preview(event.details.instruction, 200);
  if (kind === 'tool') {
    const args = preview(event.details.arguments, 140);
    const result = preview(event.details.result, 200);
    return result ? `${args} → ${result}` : args;
  }
  return preview(event.details.error);
}
