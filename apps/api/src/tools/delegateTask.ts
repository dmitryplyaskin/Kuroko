import type { ChatToolCall } from '@kuroko/contracts/chat';
import type { LlmMessage } from '@kuroko/contracts/llm';
import { delegatedAnswerLimit, type DelegateTaskRequest, type DelegateTaskResult } from '@kuroko/contracts/tools';
import { runToolCall, toolDeclarations } from '@kuroko/tool-runtime';
import { randomUUID } from 'node:crypto';
import { LlmError } from '../llm/llmErrors';
import type { createLlmService } from '../llm/llmService';
import type { createToolsStore } from './toolsStore';

const maxToolRounds = 16;

export function createDelegateTask(
  llm: Pick<ReturnType<typeof createLlmService>, 'generate'>,
  tools: Pick<ReturnType<typeof createToolsStore>, 'list' | 'subagentPresetId'>,
) {
  return async (userId: number, { task, name, history = [] }: DelegateTaskRequest, signal: AbortSignal): Promise<DelegateTaskResult> => {
    signal.throwIfAborted();
    const enabled = tools.list(userId);
    if (!enabled.includes('delegate_task')) return { result: 'Tool is not enabled.', isError: true };

    const presetId = tools.subagentPresetId(userId);
    if (!presetId) return { result: 'Select a subagent connection preset in the Tools settings.', isError: true };

    const prior = history.flatMap<LlmMessage>(({ task, answer }) => [
      { role: 'user', content: task },
      { role: 'assistant', parts: [{ type: 'text', text: answer }] },
    ]);
    const instructions = [
      'Complete the latest delegated task. Use your earlier tasks and answers when relevant.',
      'Use the available tools as needed. Report actual dice results from those tools.',
      'Use getRollDetails for rolls already made in this delegated task.',
      'Return a concise result for the calling model and mention any missing information.',
      ...(name ? [`Your subagent name is the label ${JSON.stringify(name)}.`] : []),
    ].join('\n');
    const messages: LlmMessage[] = [{ role: 'system', content: instructions }, ...prior, { role: 'user', content: task }];
    const allowedTools = enabled.filter((id) => id !== 'delegate_task');
    const declarations = toolDeclarations(allowedTools);
    const trace: ChatToolCall[] = [];
    const timeout = AbortSignal.timeout(120_000);
    const runSignal = AbortSignal.any([signal, timeout]);
    const fail = (result: string): DelegateTaskResult => ({ result, isError: true, toolCalls: trace.length ? trace : undefined });

    try {
      for (let round = 0; round <= maxToolRounds; round++) {
        runSignal.throwIfAborted();
        const completion = await llm.generate(userId, { presetId, messages, tools: declarations }, runSignal);
        runSignal.throwIfAborted();
        if (completion.finishReason === 'content_filter') return fail('The subagent response was blocked by the provider.');
        if (completion.finishReason === 'length') return fail('The subagent reached its response length limit. Ask for a shorter answer.');

        const assistant = completion.message;
        const calls = assistant.parts.filter((part) => part.type === 'toolCall');
        if (!calls.length) {
          const answer = assistant.parts.flatMap((part) => part.type === 'text' ? [part.text] : []).join('').trim().toWellFormed();
          if (!answer) return fail('The subagent returned an empty answer.');
          if (answer.length > delegatedAnswerLimit) return fail('The subagent answer was too long. Ask for a shorter answer.');
          const rollIds = trace.filter((call) => !call.isError && (call.name === 'roll_dice' || call.name === 'resolveCheck'))
            .map(({ id }) => id);
          return {
            result: { answer, name, rollIds: rollIds.length ? rollIds : undefined },
            toolCalls: trace.length ? trace : undefined,
          };
        }
        if (round === maxToolRounds) break;

        const results = await Promise.all(calls.map((call) => runToolCall(call, allowedTools, {
          signal: runSignal, id: `sub_${randomUUID()}`, history: trace,
        })));
        trace.push(...results.map(({ entry }) => entry));
        messages.push(assistant, ...results.map(({ message }) => message));
      }
      return fail('The subagent reached its tool-call round limit.');
    } catch (error) {
      signal.throwIfAborted();
      if (timeout.aborted) return fail('Subagent generation failed (timeout).');
      if (error instanceof LlmError) return fail(`Subagent generation failed (${error.code}).`);
      throw error;
    }
  };
}
