import type { ChatMessage } from '@kuroko/contracts/chat';

export { hasMessageContent, messageBlocks } from '@kuroko/tool-runtime/chatHistory';

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

export type ReplyPhase = 'reasoning' | 'answer' | 'subagent';
export type ActiveSubagent = { id: string; name?: string };
