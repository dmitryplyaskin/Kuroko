import { isAgentId } from '@kuroko/contracts/agents';
import type { ChatToolCall } from '@kuroko/contracts/chat';
import {
  delegatedAnswerLimit, isSubagentTool, readDelegatedTask, readSubagentName, subagentHistoryLimit, subagentHistoryTextLimit,
  type DelegateTaskInput, type DelegateTaskRequest, type DelegateTaskResult, type SubagentTurn,
} from '@kuroko/contracts/tools';

type Delegate<Payload> = (input: Payload, signal: AbortSignal, id: string) => Promise<DelegateTaskResult>;
export type RunSubagent = Delegate<DelegateTaskInput>;

export function createSubagentBatch(calls: readonly ChatToolCall[], execute: Delegate<DelegateTaskRequest>): RunSubagent {
  const assigned = new Set<string>();

  return async (input, signal, id) => {
    const key = agentKey(input.agentId, input.name);
    if (!key) return execute(input, signal, id);

    if (assigned.has(key)) {
      return { result: `Subagent “${input.name ?? input.agentId}” already has a task in this batch. Use a distinct name for an independent run or send a follow-up in a later round.`, isError: true };
    }
    assigned.add(key);

    const history: SubagentTurn[] = [];
    let size = 0;
    for (let index = calls.length - 1; index >= 0 && history.length < subagentHistoryLimit; index--) {
      const turn = readSubagentTurn(calls[index]!);
      if (!turn || agentKey(turn.agentId, turn.name) !== key) continue;
      size += turn.task.length + turn.answer.length;
      if (size > subagentHistoryTextLimit) break;
      history.push({ task: turn.task, answer: turn.answer });
    }
    return execute({ ...input, history: history.length ? history.reverse() : undefined }, signal, id);
  };
}

export function recentNamedSubagents(calls: readonly ChatToolCall[]) {
  const names = new Map<string, { agentId?: string; name: string }>();
  for (let index = calls.length - 1; index >= 0 && names.size < 32; index--) {
    const turn = readSubagentTurn(calls[index]!);
    if (!turn?.name) continue;
    const key = agentKey(turn.agentId, turn.name)!;
    if (!names.has(key)) names.set(key, { agentId: turn.agentId, name: turn.name });
  }
  return [...names.values()];
}

function agentKey(id: string | undefined, name: string | undefined) {
  return id ? `saved:${id}:${name?.toLowerCase() ?? ''}` : name ? `named:${name.toLowerCase()}` : undefined;
}

function readSubagentTurn({ name, arguments: args, result, isError }: ChatToolCall) {
  if (!isSubagentTool(name) || isError || !result || typeof result !== 'object' || Array.isArray(result)) return;
  const agentId = isAgentId(args.agentId) ? args.agentId : undefined;
  const agent = readSubagentName(args.name);
  const task = readDelegatedTask(args.task);
  const answer = result.answer;
  if ((agentId || agent) && task && typeof answer === 'string' && answer.length <= delegatedAnswerLimit && answer.isWellFormed() && answer.trim()) {
    return { agentId, name: agent, task, answer };
  }
}
