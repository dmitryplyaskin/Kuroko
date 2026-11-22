import type { ChatToolCall } from '@kuroko/contracts/chat';
import type { JsonObject, JsonValue, LlmMessage, LlmTool, LlmToolCall } from '@kuroko/contracts/llm';
import { delegatedTaskLimit, isToolId, readDelegatedTask, readSubagentName, subagentNameLimit, toolIds, type ToolId } from '@kuroko/contracts/tools';
import { getRollDetails, rollDetailsDeclaration } from './getRollDetails';
import { resolveCheck, resolveCheckDeclaration } from './resolveCheck';
import { rollDice, rollDiceDeclaration } from './rollDice';
import type { RunSubagent } from './subagents';

export { createSubagentBatch, recentSubagentNames } from './subagents';

type ToolResult = { result: JsonValue; modelResult?: JsonValue; replyResult?: JsonValue; isError?: true };
type ToolContext = {
  id: string;
  signal: AbortSignal;
  history: readonly ChatToolCall[];
  delegateTask?: RunSubagent;
};
type ToolDefinition = {
  declaration: LlmTool;
  run: (args: JsonObject, context: ToolContext) => ToolResult | Promise<ToolResult>;
};

const echoLimit = 256;
const tools: Record<ToolId, ToolDefinition> = {
  roll_dice: {
    declaration: rollDiceDeclaration,
    run: (args, { id, signal }) => rollDice(args, id, signal),
  },
  resolveCheck: {
    declaration: resolveCheckDeclaration,
    run: (args, { id, signal }) => resolveCheck(args, id, signal),
  },
  getRollDetails: {
    declaration: rollDetailsDeclaration,
    run: (args, { history }) => getRollDetails(args, history),
  },
  test_echo: {
    declaration: {
      name: 'test_echo',
      description: 'Test the tool connection by returning the supplied text unchanged.',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Text to return unchanged.', minLength: 1, maxLength: echoLimit } },
        required: ['text'],
      },
    },
    run({ text }) {
      if (typeof text !== 'string' || !text.length || !text.isWellFormed() || Array.from(text).length > echoLimit) {
        return { result: `Set text to a string between 1 and ${echoLimit} characters.`, isError: true };
      }
      return { result: { text } };
    },
  },
  delegate_task: {
    declaration: {
      name: 'delegate_task',
      description: 'Run a task in a separate model request and wait for its answer. The subagent can use enabled tools such as roll_dice. Give an agent a name and reuse it to continue its history in this chat. Use distinct names to delegate independent tasks in parallel.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The task and any relevant context.', minLength: 1, maxLength: delegatedTaskLimit },
          name: { type: 'string', description: 'Optional subagent name. Reuse it to continue its history, or omit it for a one-off task.', minLength: 1, maxLength: subagentNameLimit },
        },
        required: ['task'],
      },
    },
    async run({ task, name }, { delegateTask, signal, id }): Promise<ToolResult> {
      const input = readDelegatedTask(task);
      if (!input) return { result: `Set task to a non-empty string of at most ${delegatedTaskLimit} characters.`, isError: true };
      const agent = readSubagentName(name);
      if (name !== undefined && !agent) return { result: `Set name to a non-empty name of at most ${subagentNameLimit} characters.`, isError: true };
      if (!delegateTask) return { result: 'Subagent delegation is unavailable.', isError: true };
      const { result, isError, toolCalls } = await delegateTask({ task: input, name: agent }, signal, id);
      if (!toolCalls?.length) return { result, isError };
      return {
        result: typeof result === 'string' ? { error: result, toolCalls } : { ...result, toolCalls },
        modelResult: result, isError,
      };
    },
  },
};

export function toolDeclarations(enabled: readonly ToolId[]) {
  return toolIds.filter((id) => enabled.includes(id)).map((id) => tools[id].declaration);
}

export async function runToolCall(
  { id, name, arguments: args }: LlmToolCall, enabled: readonly ToolId[], context: ToolContext,
) {
  context.signal.throwIfAborted();
  const { result, modelResult, replyResult, isError }: ToolResult = isToolId(name) && enabled.includes(name)
    ? await tools[name].run(args, context)
    : { result: 'Tool is not enabled.', isError: true };
  const entry: ChatToolCall = { id: context.id, name, arguments: args, result, modelResult, isError };
  const message: Extract<LlmMessage, { role: 'tool' }> = {
    role: 'tool', callId: id, content: replyResult !== undefined ? replyResult : modelResult !== undefined ? modelResult : result, isError,
  };
  return { entry, message };
}
