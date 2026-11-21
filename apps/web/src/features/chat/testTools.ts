import type { ChatToolCall } from '@kuroko/contracts/chat';
import type { JsonObject, LlmMessage, LlmTool, LlmToolCall } from '@kuroko/contracts/llm';

const echoLimit = 256;
const defaultSides = 6;
const maxSides = 1000;

export const testTools: LlmTool[] = [
  {
    name: 'test_echo',
    description: 'Test the tool connection by returning the supplied text unchanged.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to return unchanged.', minLength: 1, maxLength: echoLimit } },
      required: ['text'],
    },
  },
  {
    name: 'roll_dice',
    description: 'Roll one virtual die and return the number. Use this when the user asks to roll a die.',
    parameters: {
      type: 'object',
      properties: { sides: { type: 'integer', description: 'Number of sides. Defaults to 6.', minimum: 2, maximum: maxSides } },
    },
  },
];

function execute(name: string, args: JsonObject): JsonObject | string {
  if (name === 'test_echo') {
    const { text } = args;
    if (typeof text !== 'string' || !text.length || !text.isWellFormed() || Array.from(text).length > echoLimit) {
      return `Set text to a string between 1 and ${echoLimit} characters.`;
    }
    return { text };
  }
  if (name === 'roll_dice') {
    const sides = args.sides === undefined ? defaultSides : args.sides;
    if (typeof sides !== 'number' || !Number.isInteger(sides) || sides < 2 || sides > maxSides) {
      return `Set sides to an integer between 2 and ${maxSides}.`;
    }
    return { sides, roll: Math.floor(Math.random() * sides) + 1 };
  }
  return 'Unknown tool.';
}

export function runTestTool({ id, name, arguments: args }: LlmToolCall) {
  const result = execute(name, args);
  const isError = typeof result === 'string' ? true : undefined;
  const entry: ChatToolCall = { id, name, arguments: args, result, isError };
  const message: Extract<LlmMessage, { role: 'tool' }> = { role: 'tool', callId: id, content: result, isError };
  return { entry, message };
}
