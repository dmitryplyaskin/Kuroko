import { chatMessageText, chatTitleLimit, type ChatMessage } from '@kuroko/contracts/chat';

function oneLine(text: string) {
  return text.replace(/\s+/gu, ' ').trim();
}

export function defaultChatTitle(realmTitle: string | null | undefined, createdAt: number) {
  const date = new Date(createdAt).toISOString().split('T')[0]!;
  const separator = ' — ';
  const world = Array.from(oneLine(realmTitle ?? '')).slice(0, chatTitleLimit - separator.length - date.length).join('').trimEnd();
  return world ? `${world}${separator}${date}` : date;
}

export function lastMessagePreview(message: ChatMessage | undefined) {
  if (!message) return '';
  const text = oneLine(chatMessageText(message));
  const maxLength = 400;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).toWellFormed().trimEnd()}…`;
}
