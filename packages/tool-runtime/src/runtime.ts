import { isAgentId } from '@kuroko/contracts/agents';
import type { ChatToolCall } from '@kuroko/contracts/chat';
import type { JsonObject, JsonValue, LlmMessage, LlmTool, LlmToolCall } from '@kuroko/contracts/llm';
import { delegatedTaskLimit, isToolId, readDelegatedTask, readSubagentName, subagentNameLimit, toolIds, type ToolId } from '@kuroko/contracts/tools';
import { getRollDetails, rollDetailsDeclaration } from './getRollDetails';
import { resolveCheck, resolveCheckDeclaration } from './resolveCheck';
import { rollDice, rollDiceDeclaration } from './rollDice';
import type { RunSubagent } from './subagents';

export { createSubagentBatch, recentNamedSubagents } from './subagents';

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
  subagent: {
    declaration: {
      name: 'subagent',
      description: 'Delegate a task and wait for its answer. Pass agentId to use a saved agent’s instructions and tools. Use distinct names to run independent instances in parallel, including with the same agentId. Reuse the same agentId and name, when provided, to continue an instance’s history in this chat.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The task and any relevant context.', minLength: 1, maxLength: delegatedTaskLimit },
          agentId: { type: 'string', description: 'Optional saved agent ID. Omit it to create a temporary agent with the default tool permissions.' },
          name: { type: 'string', description: 'Optional instance name. With a saved agent ID, use distinct names for independent runs of that agent.', minLength: 1, maxLength: subagentNameLimit },
        },
        required: ['task'],
      },
    },
    async run({ task, name, agentId }, { delegateTask, signal, id }): Promise<ToolResult> {
      const input = readDelegatedTask(task);
      if (!input) return { result: `Set task to a non-empty string of at most ${delegatedTaskLimit} characters.`, isError: true };
      const agent = readSubagentName(name);
      if (name !== undefined && !agent) return { result: `Set name to a non-empty name of at most ${subagentNameLimit} characters.`, isError: true };
      if (agentId !== undefined && !isAgentId(agentId)) {
        return { result: 'Set agentId to an available saved agent ID.', isError: true };
      }
      if (!delegateTask) return { result: 'Subagent delegation is unavailable.', isError: true };
      const { result, isError, toolCalls } = await delegateTask({ task: input, name: agent, agentId }, signal, id);
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
