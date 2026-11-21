import type { ChatToolCall } from '@kuroko/contracts/chat';
import type { JsonObject, JsonValue, LlmMessage, LlmTool, LlmToolCall } from '@kuroko/contracts/llm';
import { isToolId, toolIds, type ToolId } from '@kuroko/contracts/tools';
import type { MessageKey } from '../../shared/i18n/i18n';
import { getRollDetails, rollDetailsDeclaration } from './getRollDetails';
import { resolveCheck, resolveCheckDeclaration } from './resolveCheck';
import { rollDice, rollDiceDeclaration } from './rollDice';

type ToolResult = { result: JsonValue; modelResult?: JsonValue; replyResult?: JsonValue; isError?: true };
type ToolContext = { id: string; signal: AbortSignal; history: readonly ChatToolCall[] };
type ToolDefinition = {
  label: MessageKey;
  description: MessageKey;
  parameters: readonly { name: string; description: MessageKey }[];
  example: JsonObject;
  declaration: LlmTool;
  run: (args: JsonObject, context: ToolContext) => ToolResult | Promise<ToolResult>;
};

const echoLimit = 256;

export const tools: Record<ToolId, ToolDefinition> = {
  roll_dice: {
    label: 'tools.dice',
    description: 'tools.diceDescription',
    parameters: [
      { name: 'rolls', description: 'tools.diceRolls' },
      { name: 'purpose', description: 'tools.dicePurpose' },
      { name: 'details', description: 'tools.diceDetails' },
    ],
    example: { rolls: { attack: '2d20kh1 + 5', hit: '$attack >= 15', damage: 'if($hit, 2d6! + 3, 0)' } },
    declaration: rollDiceDeclaration,
    run: (args, { id, signal }) => rollDice(args, id, signal),
  },
  resolveCheck: {
    label: 'tools.check',
    description: 'tools.checkDescription',
    parameters: [
      { name: 'profile', description: 'tools.checkProfile' },
      { name: 'sides', description: 'tools.checkSides' },
      { name: 'target', description: 'tools.checkTarget' },
      { name: 'modifier', description: 'tools.checkModifier' },
      { name: 'mode', description: 'tools.checkMode' },
      { name: 'damage', description: 'tools.checkDamage' },
      { name: 'purpose', description: 'tools.dicePurpose' },
      { name: 'details', description: 'tools.diceDetails' },
    ],
    example: { profile: 'attack', sides: 12, target: 9, modifier: 2, mode: 'advantage', damage: { normal: 'd6 + 3', critical: '2d6 + 3' } },
    declaration: resolveCheckDeclaration,
    run: (args, { id, signal }) => resolveCheck(args, id, signal),
  },
  getRollDetails: {
    label: 'tools.rollDetails',
    description: 'tools.rollDetailsDescription',
    parameters: [{ name: 'rollIds', description: 'tools.rollDetailsIds' }],
    example: { rollIds: ['roll-id'] },
    declaration: rollDetailsDeclaration,
    run: (args, { history }) => getRollDetails(args, history),
  },
  test_echo: {
    label: 'tools.echo',
    description: 'tools.echoDescription',
    parameters: [{ name: 'text', description: 'tools.echoText' }],
    example: { text: 'ping' },
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
