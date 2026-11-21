import type { ChatMessage, ChatToolCall } from '@kuroko/contracts/chat';
import type { LlmMessage } from '@kuroko/contracts/llm';

export type ChatImage = {
  src: string;
  alt: string;
  width: number;
  height: number;
} | { file: File };

export type Message = ChatMessage & {
  reasoning?: string;
  image?: ChatImage;
};

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

export function editMessageText(message: Message, text: string): Message {
  const oldText = message.text;
  const edited = { ...message, text, edited: true };
  if (!message.toolCalls?.some(({ textOffset }) => textOffset)) return edited;

  let prefix = 0;
  const sharedLength = Math.min(oldText.length, text.length);
  while (prefix < sharedLength && oldText[prefix] === text[prefix]) prefix++;
  let oldEnd = oldText.length;
  let newEnd = text.length;
  while (oldEnd > prefix && newEnd > prefix && oldText[oldEnd - 1] === text[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return {
    ...edited,
    toolCalls: message.toolCalls.map((call) => {
      const offset = call.textOffset;
      if (offset === undefined || offset <= prefix) return call;
      const moved = offset >= oldEnd ? offset + newEnd - oldEnd : newEnd;
      const code = text.charCodeAt(moved);
      return { ...call, textOffset: code >= 0xdc00 && code <= 0xdfff ? moved - 1 : moved };
    }),
  };
}

export function toLlmMessages(messages: ChatMessage[]): LlmMessage[] {
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
        const calls = block.calls.map(({ name, arguments: args, result, modelResult, isError }) =>
          `${name}(${JSON.stringify(args)}) ${isError ? 'failed' : 'returned'} ${JSON.stringify(modelResult === undefined ? result : modelResult)}`);
        return `Tool calls:\n${calls.join('\n')}`;
      }).filter((block) => block.trim()).join('\n\n');
      history.push({ role, parts: [{ type: 'text', text: content }] });
    }
  }
  return history;
}

export type ReplyPhase = 'reasoning' | 'answer';
