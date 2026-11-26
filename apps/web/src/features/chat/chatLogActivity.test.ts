import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatActivityEntry, ChatMessage } from '@kuroko/contracts/chat';
import { chatActivityView } from './ChatActivity';
import { agentLogTurns, chatLogTurns, logRowPreview, withLiveLogReply } from './chatLogActivity';

const prompt: ChatMessage = { id: 1, role: 'user', text: 'Привет', time: 1 };
const reply: ChatMessage = { id: 2, role: 'assistant', text: 'Привет!', time: 2 };
const event = (id: string, kind: ChatActivityEntry['kind'], details: ChatActivityEntry['details'] = {}): ChatActivityEntry =>
  ({ id, kind, time: Number(id), status: 'completed', details });
const model = (id: string, text: string) => event(id, 'model', { response: { message: { parts: [{ type: 'text', text }] } } });

function log(activity: ChatActivityEntry[], messages = [prompt, reply]) {
  const turns = activity.length ? [{ promptId: prompt.id, entries: activity }] : [];
  return chatLogTurns(chatActivityView(turns, messages).entries, messages);
}

test('shows a saved plain answer and uses the same single assistant row for a recorded answer', () => {
  for (const turns of [log([]), log([event('1', 'reply'), model('2', reply.text)])]) {
    assert.deepEqual(turns[0]?.rows.map(({ kind, text }) => [kind, text]), [
      ['user', 'Привет'], ['assistant', 'Привет!'],
    ]);
  }
});

test('shows the instruction before the user message in live and saved turns', () => {
  const instruction = { ...event('0', 'instruction', { instruction: 'Отвечай кратко.\nСохраняй тон.' }), time: 3 };
  const pending = withLiveLogReply(log([instruction], [prompt]), { ...reply, text: '' });
  const waiting = { ...model('2', ''), status: 'running' as const };
  const live = withLiveLogReply(log([instruction, waiting], [prompt]), reply);
  for (const [turn] of [pending, live, log([instruction, model('2', reply.text)]), log([instruction])]) {
    assert.deepEqual(turn?.rows.map(({ kind }) => kind), ['instruction', 'user', 'assistant']);
    assert.equal(logRowPreview(turn!.rows[0]!), 'Отвечай кратко.\nСохраняй тон.');
  }
  assert.equal(pending[0]?.rows[2]?.pending, true);
  assert.equal(live[0]?.rows[2]?.text, reply.text);
});

test('shows an instruction again only after it changes or a turn uses no instruction', () => {
  const instructions = ['Пиши кратко.', 'Пиши кратко.', 'Добавляй детали.', undefined, 'Добавляй детали.'];
  const messages = instructions.flatMap((_, index) => [{ ...prompt, id: index * 2 + 1 }, { ...reply, id: index * 2 + 2 }]);
  const activity = instructions.flatMap((instruction, index) => instruction ? [{
    promptId: index * 2 + 1, entries: [event('0', 'instruction', { instruction })],
  }] : []);
  const turns = chatLogTurns(chatActivityView(activity, messages).entries, messages);
  assert.deepEqual(turns.map(({ rows }) => rows.map(({ kind }) => kind)), [
    ['instruction', 'user', 'assistant'], ['user', 'assistant'], ['instruction', 'user', 'assistant'],
    ['user', 'assistant'], ['instruction', 'user', 'assistant'],
  ]);
});

test('keeps a recorded tool between model rounds and links it to the model that called it', () => {
  const [turn] = log([event('1', 'reply'), model('2', 'Сверяю записи.'), event('3', 'tool'), model('4', 'Готово.')]);
  assert.deepEqual(turn?.rows.map(({ kind, text, sourceKey }) => [kind, text, sourceKey]), [
    ['user', 'Привет', undefined],
    ['assistant', 'Сверяю записи.', undefined],
    ['tool', undefined, '1:2'],
    ['assistant', 'Готово.', undefined],
  ]);
});

test('keeps saved tool placement and shows only new text from a live or stopped round', () => {
  const legacy = { ...reply, text: 'До.После.', toolCalls: [
    { id: 'check', name: 'test_echo', arguments: {}, result: 'OK', textOffset: 3 },
  ] };
  assert.deepEqual(log([], [prompt, legacy])[0]?.rows.map(({ kind, text }) => [kind, text]), [
    ['user', 'Привет'], ['assistant', 'До.'], ['tool', undefined], ['assistant', 'После.'],
  ]);

  const partial = { ...reply, text: 'Начало.\n\nПродолжение' };
  const first = model('2', 'Начало.');
  const waiting = { ...event('3', 'model'), status: 'running' as const };
  const live = withLiveLogReply(log([event('1', 'reply'), first, waiting], [prompt]), partial);
  const last = live[0]?.rows.at(-1);
  assert.deepEqual([last?.kind, last?.text, last?.key], ['assistant', 'Продолжение', '1:3']);
  const stopped = log([{ ...event('1', 'reply'), status: 'stopped' }, first, { ...waiting, status: 'stopped' }], [prompt, partial]);
  assert.deepEqual(stopped[0]?.rows.slice(-2).map(({ kind, text }) => [kind, text]), [
    ['assistant', 'Продолжение'], ['reply', undefined],
  ]);
});

test('shows each tool and model only in the log of the session that ran it', () => {
  const rootCall = {
    ...event('3', 'tool', {
      callId: 'call-outer', arguments: { name: 'Первый', task: 'Проверь даты' },
      result: { answer: 'Даты проверены', toolCalls: [{ name: 'internal' }] },
      modelResult: { answer: 'Даты проверены' },
    }),
    name: 'delegate_task',
  };
  const first = { ...event('4', 'agent', { callId: 'call-outer', task: 'Проверь даты' }), name: 'Первый' };
  const secondCall = {
    ...event('6', 'tool', { arguments: { name: 'Второй', task: 'Найди ошибку' }, callId: 'call-inner' }),
    name: 'delegate_task', agentId: first.id,
  };
  const second = { ...event('7', 'agent', { task: 'Найди ошибку', callId: 'call-inner' }), name: 'Второй', agentId: first.id };
  const view = chatActivityView([{ promptId: prompt.id, entries: [
    event('1', 'reply'), model('2', 'Делегирую.'), rootCall, first,
    { ...model('5', 'Ищу даты.'), agentId: first.id }, secondCall, second,
    { ...model('8', 'Ищу ошибку.'), agentId: second.id },
    { ...event('9', 'tool'), name: 'internal', agentId: second.id },
    model('10', 'Всё готово.'),
  ] }], [prompt, reply]);
  const [rootAgent, childAgent] = view.agents;
  const names = (rows: ReturnType<typeof chatLogTurns>[number]['rows']) =>
    rows.map(({ kind, text, event }) => text || event?.name || kind);
  const main = chatLogTurns(view.entries, [prompt, reply])[0]!.rows;
  assert.deepEqual(names(main), ['Привет', 'Делегирую.', 'delegate_task', 'Всё готово.']);
  assert.equal(main[2]?.event?.targetAgentKey, rootAgent!.key);
  assert.deepEqual(main[2]?.event?.details.result, { answer: 'Даты проверены' });
  const firstLog = agentLogTurns(rootAgent!.tasks)[0]!.rows;
  assert.deepEqual(names(firstLog), ['Проверь даты', 'Ищу даты.', 'delegate_task']);
  assert.equal(firstLog[2]?.event?.targetAgentKey, childAgent!.key);
  assert.equal(childAgent!.parentKey, rootAgent!.key);
  assert.deepEqual(names(agentLogTurns(childAgent!.tasks)[0]!.rows), ['Найди ошибку', 'Ищу ошибку.', 'internal']);
});

test('preserves old agent replies and tools without exposing archived tool traces in the parent log', () => {
  const saved = { ...reply, toolCalls: [{
    id: 'delegate', name: 'delegate_task', arguments: { name: 'Хронолог', task: 'Проверь даты' },
    result: { answer: 'Готово', toolCalls: [{ id: 'check', name: 'test_echo', arguments: {}, result: 'OK' }] },
  }] };
  const { agents, entries } = chatActivityView([], [prompt, saved]);
  const main = chatLogTurns(entries, [prompt, saved])[0]!.rows;
  assert.deepEqual(main.map(({ kind }) => kind), ['user', 'tool', 'assistant']);
  assert.deepEqual(main[1]?.event?.details.result, { answer: 'Готово' });
  assert.equal(main[1]?.event?.targetAgentKey, agents[0]?.key);
  assert.deepEqual(agentLogTurns(agents[0]!.tasks)[0]?.rows.map(({ kind, text, event }) => [kind, text || event?.name]), [
    ['user', 'Проверь даты'], ['tool', 'test_echo'], ['assistant', 'Готово'],
  ]);
});
