import type { ChatActivityEntry, ChatToolCall } from '@kuroko/contracts/chat';
import type { LlmMessage, LlmTool } from '@kuroko/contracts/llm';
import { delegatedAnswerLimit, type DelegateTaskRequest, type DelegateTaskResult } from '@kuroko/contracts/tools';
import { runToolCall, toolDeclarations } from '@kuroko/tool-runtime';
import { createChatActivity, recordModelRequest } from '@kuroko/tool-runtime/chatActivity';
import { randomUUID } from 'node:crypto';
import type { createAgentsStore } from '../agents/agentsStore';
import { PromptTemplateError, type createPromptRenderer } from '../instructions/promptTemplate';
import { LlmError } from '../llm/llmErrors';
import type { createLlmService } from '../llm/llmService';
import type { createToolsStore } from './toolsStore';

const maxToolRounds = 16;

export function createSubagentToolDescriptions(
  agents: Pick<ReturnType<typeof createAgentsStore>, 'catalog'>,
  tools: Pick<ReturnType<typeof createToolsStore>, 'temporaryAgentTools'>,
  renderPrompt: ReturnType<typeof createPromptRenderer>,
) {
  return (userId: number, declarations: LlmTool[]) => {
    if (!declarations.some(({ name }) => name === 'subagent')) return declarations;
    const catalog = agents.catalog(userId).map(({ id, name, description, worldId }) => ({
      id, name, description: renderPrompt(userId, { agent: { name } }, worldId)(description).trim(),
    }));
    const temporaryTools = tools.temporaryAgentTools(userId);
    return declarations.map((tool) => tool.name === 'subagent' ? {
      ...tool,
      description: [
        tool.description,
        temporaryTools.length ? `Tools for temporary agents: ${temporaryTools.join(', ')}.` : 'Temporary agents have no tools.',
        catalog.length && `Choose a saved agent by its description and pass its id as agentId: ${JSON.stringify(catalog)}`,
      ].filter(Boolean).join('\n'),
    } : tool);
  };
}

export function createDelegateTask(
  llm: Pick<ReturnType<typeof createLlmService>, 'generate'>,
  tools: Pick<ReturnType<typeof createToolsStore>, 'list' | 'subagentPresetId' | 'temporaryAgentTools'>,
  agents: Pick<ReturnType<typeof createAgentsStore>, 'find'>,
  renderPrompt: ReturnType<typeof createPromptRenderer>,
) {
  return async (userId: number, { task, name: instanceName, agentId, history = [] }: DelegateTaskRequest, signal: AbortSignal,
    onActivity?: (entry: ChatActivityEntry) => void): Promise<DelegateTaskResult> => {
    signal.throwIfAborted();
    const enabled = tools.list(userId);
    if (!enabled.includes('subagent')) return { result: 'Tool is not enabled.', isError: true };

    const agent = agentId ? agents.find(userId, agentId) : undefined;
    if (agentId && !agent) return { result: 'Saved agent not found. Use an agentId from the available agents.', isError: true };
    const name = instanceName ?? agent?.name;

    const presetId = tools.subagentPresetId(userId);
    if (!presetId) return { result: 'Select a subagent connection preset in the Tools settings.', isError: true };

    const prior = history.flatMap<LlmMessage>(({ task, answer }) => [
      { role: 'user', content: task },
      { role: 'assistant', parts: [{ type: 'text', text: answer }] },
    ]);
    const allowedTools = agent?.tools ?? tools.temporaryAgentTools(userId, enabled);
    let customInstructions: string | undefined;
    if (agent) {
      try {
        customInstructions = renderPrompt(userId, { agent: { name: name ?? agent.name } }, agent.worldId)(agent.instructions).trim();
      } catch (error) {
        if (!(error instanceof PromptTemplateError)) throw error;
        return { result: 'The saved agent instructions could not be rendered.', isError: true };
      }
    }
    const instructions = [
      'Complete the latest delegated task. Use your earlier tasks and answers when relevant.',
      'Use the available tools as needed.',
      (allowedTools.includes('roll_dice') || allowedTools.includes('resolveCheck')) && 'Report actual dice results from the tools.',
      allowedTools.includes('getRollDetails') && 'Use getRollDetails for rolls already made in this delegated task.',
      'Return a concise result for the calling model and mention any missing information.',
      ...(name ? [`Your subagent name is the label ${JSON.stringify(name)}.`] : []),
      ...(customInstructions ? [`Saved agent instructions:\n${customInstructions}`] : []),
    ].filter(Boolean).join('\n');
    const messages: LlmMessage[] = [{ role: 'system', content: instructions }, ...prior, { role: 'user', content: task }];
    const declarations = toolDeclarations(allowedTools);
    const trace: ChatToolCall[] = [];
    const timeout = AbortSignal.timeout(120_000);
    const runSignal = AbortSignal.any([signal, timeout]);
    const fail = (result: string): DelegateTaskResult => ({ result, isError: true, toolCalls: trace.length ? trace : undefined });
    const start = onActivity && createChatActivity(onActivity);

    try {
      for (let round = 0; round <= maxToolRounds; round++) {
        runSignal.throwIfAborted();
        const request = { presetId, messages, tools: declarations };
        const generate = () => llm.generate(userId, request, runSignal);
        const completion = await (start ? recordModelRequest(start, request, generate, signal,
          (error) => timeout.aborted ? 'timeout' : error instanceof LlmError ? error.code : 'internal_error') : generate());
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

        const results = await Promise.all(calls.map(async (call) => {
          const activity = start?.('tool', { arguments: call.arguments }, call.name);
          const result = await runToolCall(call, allowedTools, { signal: runSignal, id: `sub_${randomUUID()}`, history: trace });
          activity?.finish(result.entry.isError ? 'failed' : 'completed', {
            result: result.entry.result,
            ...(result.message.content !== result.entry.result && { modelResult: result.message.content }),
          });
          return result;
        }));
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
