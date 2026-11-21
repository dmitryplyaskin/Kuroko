import type { CSSProperties } from 'react';
import type { ChatColorScheme, ChatSettings } from '@kuroko/contracts/chatSettings';

export function chatDisplayStyle(settings: ChatSettings, scheme: ChatColorScheme): CSSProperties & Record<`--chat-${string}`, string | undefined> {
  const { text, speech, emphasis, quote } = settings.colors[scheme];
  return {
    '--chat-column': `${settings.width / 16}rem`,
    '--chat-text-size': `${settings.fontSize / 16}rem`,
    '--chat-color-text': text,
    '--chat-color-speech': speech,
    '--chat-color-emphasis': emphasis,
    '--chat-color-quote': quote,
  };
}
