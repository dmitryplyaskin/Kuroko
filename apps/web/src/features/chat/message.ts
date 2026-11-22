import type { ChatMessage } from '@kuroko/contracts/chat';
import { messageBlocks } from '@kuroko/tool-runtime/chatHistory';

export { hasMessageContent } from '@kuroko/tool-runtime/chatHistory';
export { messageBlocks };

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

export function messageDraftTexts(message: Message): string[] {
  const texts = messageBlocks(message).flatMap((block) => block.kind === 'text' ? [block.text] : []);
  return texts.length ? texts : [''];
}

export function editMessageText(message: Message, texts: readonly string[]): Message {
  const draft = texts.join('');
  const text = draft.trim();
  const edited = { ...message, text, edited: true };
  if (!message.toolCalls?.length) return edited;

  const leadingWhitespace = draft.length - draft.trimStart().length;
  let index = 0;
  let position = 0;
  let moved = false;
  const toolCalls = messageBlocks(message).flatMap((block) => {
    if (block.kind === 'text') {
      position += texts[index++]!.length;
      return [];
    }
    const boundary = Math.max(0, Math.min(text.length, position - leadingWhitespace));
    const code = text.charCodeAt(boundary);
    const offset = boundary > 0 && code >= 0xdc00 && code <= 0xdfff ? boundary - 1 : boundary;
    return block.calls.map((call) => {
      if ((call.textOffset ?? 0) === offset) return call;
      moved = true;
      return { ...call, textOffset: offset };
    });
  });
  return moved ? { ...edited, toolCalls } : edited;
}

export type ReplyPhase = 'reasoning' | 'answer' | 'subagent';
export type ActiveSubagent = { id: string; name?: string };
