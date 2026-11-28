import type { ChatMessage, ChatReasoningBlock } from '@kuroko/contracts/chat';
import { messageBlocks } from '@kuroko/tool-runtime/chatHistory';

export { hasMessageContent } from '@kuroko/tool-runtime/chatHistory';

export type ChatImage = {
  src: string;
  alt: string;
  width: number;
  height: number;
} | { file: File };

export type Message = ChatMessage & {
  image?: ChatImage;
};

type ReasoningBlock = ChatReasoningBlock & { kind: 'reasoning' };
type DisplayBlock = ReturnType<typeof messageBlocks>[number] | ReasoningBlock;

export function displayMessageBlocks(message: Message): DisplayBlock[] {
  if (message.role !== 'assistant' || !message.reasoningBlocks?.length) {
    const blocks = messageBlocks(message);
    return message.role === 'assistant' && message.reasoning
      ? [{ kind: 'reasoning', text: message.reasoning, textOffset: 0 }, ...blocks]
      : blocks;
  }
  const reasoning = new Map(message.reasoningBlocks.map((block) => [block.afterToolCallId, block]));
  const display: DisplayBlock[] = [];
  let position = 0;
  function appendText(offset: number) {
    if (offset <= position) return;
    display.push({ kind: 'text', text: message.text.slice(position, offset) });
    position = offset;
  }
  const first = reasoning.get(undefined);
  if (first) display.push({ kind: 'reasoning', ...first });
  for (const call of message.toolCalls ?? []) {
    appendText(call.textOffset ?? 0);
    const last = display.at(-1);
    if (last?.kind === 'tools') last.calls.push(call);
    else display.push({ kind: 'tools', calls: [call] });
    const after = reasoning.get(call.id);
    if (after) {
      appendText(after.textOffset);
      display.push({ kind: 'reasoning', ...after });
    }
  }
  appendText(message.text.length);
  return display;
}

export function messageDraftTexts(message: Message): string[] {
  if (message.role === 'user') return [message.text];
  const texts = displayMessageBlocks(message).flatMap((block) => block.kind === 'text' ? [block.text] : []);
  return texts.length ? texts : [''];
}

export function editMessageText(message: Message, texts: readonly string[]): Message {
  const draft = texts.join('');
  const text = draft.trim();
  const edited = { ...message, text, edited: true };
  if (message.role === 'user') return { ...edited, renderedText: undefined };
  if (!message.toolCalls?.length && !message.reasoningBlocks?.length) return edited;

  const leadingWhitespace = draft.length - draft.trimStart().length;
  let index = 0;
  let position = 0;
  let callsMoved = false;
  let reasoningMoved = false;
  const toolCalls: NonNullable<Message['toolCalls']> = [];
  const reasoningBlocks: ChatReasoningBlock[] = [];
  for (const block of displayMessageBlocks(message)) {
    if (block.kind === 'text') {
      position += texts[index++]!.length;
      continue;
    }
    const boundary = Math.max(0, Math.min(text.length, position - leadingWhitespace));
    const code = text.charCodeAt(boundary);
    const offset = boundary > 0 && code >= 0xdc00 && code <= 0xdfff ? boundary - 1 : boundary;
    if (block.kind === 'reasoning') {
      if (message.reasoningBlocks) {
        const { text, afterToolCallId } = block;
        reasoningMoved ||= block.textOffset !== offset;
        reasoningBlocks.push({ text, textOffset: offset, ...(afterToolCallId && { afterToolCallId }) });
      }
    } else {
      for (const call of block.calls) {
        const moved = (call.textOffset ?? 0) !== offset;
        callsMoved ||= moved;
        toolCalls.push(moved ? { ...call, textOffset: offset } : call);
      }
    }
  }
  if (callsMoved) edited.toolCalls = toolCalls;
  if (reasoningMoved) edited.reasoningBlocks = reasoningBlocks;
  return edited;
}

export type ReplyPhase = 'reasoning' | 'answer' | 'subagent';
export type ActiveSubagent = { id: string; name?: string };
