import { chatMessageText, type ChatMessage } from '@kuroko/contracts/chat';
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

export type LogTurn = { id: number; number?: number; rows: LogRow[] };
type Turn = { user: ChatMessage; replies: ChatMessage[] };

function messageRow(message: ChatMessage, text = chatMessageText(message), key = `message-${message.id}`): LogRow {
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

function loggedInstruction({ details }: LogEvent, opening?: ChatMessage) {
  const { instruction, systemOnly } = details;
  if (typeof instruction !== 'string') return;
  if (systemOnly || !opening?.realmStart) return instruction;
  const marker = 'Opening message:\n';
  const openingBlock = `${marker}${opening.text.trim()}`;
  if (instruction === openingBlock) return '';
  const suffix = `\n\n${openingBlock}`;
  if (instruction.endsWith(suffix)) return instruction.slice(0, -suffix.length);
  // An older entry can contain a different start if the player changed variants later.
  const boundary = instruction.lastIndexOf(`\n\n${marker}`);
  if (boundary >= 0) return instruction.slice(0, boundary);
  return instruction.startsWith(marker) ? '' : instruction;
}

export function chatLogTurns(entries: ActivityEntry[], messages: ChatMessage[], initialInstruction?: string | null): LogTurn[] {
  const byPrompt = Map.groupBy(entries, ({ promptId }) => promptId);
  const turns: Turn[] = [];
  const opening: LogRow[] = [];
  const saved = (reply: ChatMessage) => savedRows(reply, byPrompt.get(reply.id - 1) ?? []);
  for (const message of messages) {
    const turn = turns.at(-1);
    if (message.role === 'user') turns.push({ user: message, replies: [] });
    else if (turn) turn.replies.push(message);
    else opening.push(...saved(message));
  }

  let previousInstruction: string | undefined;
  const numbered = turns.map(({ user, replies }, index): LogTurn => {
    const [reply, ...otherReplies] = replies;
    const activity = byPrompt.get(user.id) ?? [];
    const rows = [messageRow(user)];
    const instruction = activity.find((entry): entry is LogEvent => !entry.agentId && entry.kind === 'instruction');
    const text = instruction && loggedInstruction(instruction, messages[0]);
    if (instruction && text) {
      if (text !== previousInstruction) {
        const row = eventRow({ ...instruction, details: { instruction: text } });
        if (index === 0) opening.unshift(row);
        else rows.push(row);
      }
      previousInstruction = text;
    } else if (instruction || reply || activity.some(({ agentId, kind }) => !agentId && kind === 'model')) {
      previousInstruction = undefined;
    }
    if (reply && (!activity.length || activity[0]?.legacyCallId !== undefined)) rows.push(...savedRows(reply, activity));
    else {
      const recorded = recordedRows(activity);
      rows.push(...(reply ? withLatestText(recorded, reply, false) : recorded));
    }
    rows.push(...otherReplies.flatMap(saved));
    return { id: user.id, number: index + 1, rows };
  });
  if (initialInstruction && !turns[0]?.replies.length && opening[0]?.kind !== 'instruction') {
    opening.unshift({ key: 'initial-instruction', kind: 'instruction', time: messages[0]?.time ?? 0, text: initialInstruction });
  }
  return opening.length ? [{ id: 0, rows: opening }, ...numbered] : numbered;
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
  return turns.map((turn) => turn.number !== undefined && turn.id === reply.id - 1
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
