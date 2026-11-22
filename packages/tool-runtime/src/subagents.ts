import type { ChatToolCall } from '@kuroko/contracts/chat';
import {
  delegatedAnswerLimit, readDelegatedTask, readSubagentName, subagentHistoryLimit, subagentHistoryTextLimit,
  type DelegateTaskInput, type DelegateTaskRequest, type DelegateTaskResult, type SubagentTurn,
} from '@kuroko/contracts/tools';

type Delegate<Payload> = (input: Payload, signal: AbortSignal, id: string) => Promise<DelegateTaskResult>;
export type RunSubagent = Delegate<DelegateTaskInput>;

export function createSubagentBatch(calls: readonly ChatToolCall[], execute: Delegate<DelegateTaskRequest>): RunSubagent {
  const names = new Set<string>();

  return async (input, signal, id) => {
    if (!input.name) return execute(input, signal, id);

    const key = input.name.toLowerCase();
    if (names.has(key)) {
      return { result: `Subagent “${input.name}” already has a task in this batch. Send follow-up tasks in a later round.`, isError: true };
    }
    names.add(key);

    const history: SubagentTurn[] = [];
    let size = 0;
    for (let index = calls.length - 1; index >= 0 && history.length < subagentHistoryLimit; index--) {
      const turn = readSubagentTurn(calls[index]!);
      if (!turn || turn.name.toLowerCase() !== key) continue;
      size += turn.task.length + turn.answer.length;
      if (size > subagentHistoryTextLimit) break;
      history.push({ task: turn.task, answer: turn.answer });
    }
    return execute({ ...input, history: history.length ? history.reverse() : undefined }, signal, id);
  };
}

export function recentSubagentNames(calls: readonly ChatToolCall[]) {
  const names = new Map<string, string>();
  for (let index = calls.length - 1; index >= 0 && names.size < 32; index--) {
    const turn = readSubagentTurn(calls[index]!);
    if (!turn) continue;
    const key = turn.name.toLowerCase();
    if (!names.has(key)) names.set(key, turn.name);
  }
  return [...names.values()];
}

function readSubagentTurn({ name, arguments: args, result, isError }: ChatToolCall) {
  if (name !== 'delegate_task' || isError || !result || typeof result !== 'object' || Array.isArray(result)) return;
  const agent = readSubagentName(args.name);
  const task = readDelegatedTask(args.task);
  const answer = result.answer;
  if (agent && task && typeof answer === 'string' && answer.length <= delegatedAnswerLimit && answer.isWellFormed() && answer.trim()) {
    return { name: agent, task, answer };
  }
}
