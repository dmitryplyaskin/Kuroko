import type { ChatMessage, ChatToolCall } from '@kuroko/contracts/chat';
import type { LlmMessage } from '@kuroko/contracts/llm';
import { isSubagentTool } from '@kuroko/contracts/tools';
import { toolHistoryResult } from './getRollDetails';

export function hasMessageContent({ text, toolCalls }: ChatMessage) {
  return Boolean(text.trim() || toolCalls?.length);
}

type MessageBlock = { kind: 'text'; text: string } | { kind: 'tools'; calls: ChatToolCall[] };

export function messageBlocks({ text, toolCalls }: ChatMessage): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let position = 0;
  for (const call of toolCalls ?? []) {
    const offset = call.textOffset ?? 0;
    if (offset > position) blocks.push({ kind: 'text', text: text.slice(position, offset) });
    const last = blocks.at(-1);
    if (last?.kind === 'tools') last.calls.push(call);
    else blocks.push({ kind: 'tools', calls: [call] });
    position = offset;
  }
  if (position < text.length) blocks.push({ kind: 'text', text: text.slice(position) });
  return blocks;
}

export function toLlmMessages(messages: ChatMessage[], privateContext?: ReadonlyMap<number, string>): LlmMessage[] {
  const history: LlmMessage[] = [];
  for (const message of messages) {
    const { role, text } = message;
    if (!hasMessageContent(message)) continue;
    if (role === 'user') {
      history.push({ role, content: text });
    } else if (history.length) {
      // Earlier calls travel as text so the conversation can continue with a different provider or with tools disabled.
      const content = messageBlocks(message).map((block) => {
        if (block.kind === 'text') return block.text;
        const calls = block.calls.map((call) =>
          `${isSubagentTool(call.name) ? 'subagent' : call.name}(${JSON.stringify(call.arguments)}) ${call.isError ? 'failed' : 'returned'} ${JSON.stringify(toolHistoryResult(call))}`);
        return `Tool calls:\n${calls.join('\n')}`;
      });
      const notes = privateContext?.get(message.id);
      if (notes) content.push(notes);
      history.push({ role, parts: [{ type: 'text', text: content.filter((block) => block.trim()).join('\n\n') }] });
    }
  }
  return history;
}
