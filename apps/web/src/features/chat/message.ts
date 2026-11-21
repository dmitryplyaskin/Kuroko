import type { ChatMessage } from '@kuroko/contracts/chat';
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

export function toLlmMessages(messages: ChatMessage[]): LlmMessage[] {
  const history: LlmMessage[] = [];
  for (const message of messages) {
    const { role, text, toolCalls } = message;
    if (!hasMessageContent(message)) continue;
    if (role === 'user') {
      history.push({ role, content: text });
    } else if (history.length) {
      // Earlier calls travel as text so the conversation can continue with a different provider or with tools disabled.
      const calls = toolCalls?.map(({ name, arguments: args, result, isError }) =>
        `${name}(${JSON.stringify(args)}) ${isError ? 'failed' : 'returned'} ${JSON.stringify(result)}`);
      const content = calls?.length ? [`Tool calls:\n${calls.join('\n')}`, text].filter(Boolean).join('\n\n') : text;
      history.push({ role, parts: [{ type: 'text', text: content }] });
    }
  }
  return history;
}

export type ReplyPhase = 'reasoning' | 'answer';
