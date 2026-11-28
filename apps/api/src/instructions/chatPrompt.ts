import type { ChatMessage, SavedChat } from '@kuroko/contracts/chat';
import { toLlmMessages } from '@kuroko/tool-runtime/chatHistory';
import type { createInstructionStore } from './instructionStore';
import { PromptTemplateError, type createPromptRenderer } from './promptTemplate';

export function createChatPrompt(store: ReturnType<typeof createInstructionStore>, renderer: ReturnType<typeof createPromptRenderer>) {
  return (userId: number, chat: SavedChat, history: ChatMessage[], notes?: ReadonlyMap<number, string>) => {
    const draft = store.active(userId);
    const first = chat.messages[0];
    const opening = first?.realmStart ? first : undefined;
    const startId = chat.realmId ? opening?.realmStart?.id : undefined;
    const render = renderer(userId, { chat: { title: chat.title, gm_mode: chat.gmMode } }, chat.realmId ?? draft?.worldId, startId);
    const rendered = new Map<string, string>();
    const renderText = (text: string) => {
      const cached = rendered.get(text);
      if (cached !== undefined) return cached;
      const result = render(text);
      rendered.set(text, result);
      return result;
    };
    const latest = history.at(-1);
    if (latest?.role === 'user' && !renderText(latest.text).trim()) throw new PromptTemplateError();
    const instruction = renderText(draft?.text ?? (chat.realmId ? '{{ world().context }}' : '')).trim();
    // Model histories begin with a user turn, so carry the opening in the system context.
    const openingText = opening?.text.trim();
    const text = [instruction, openingText && `Opening message:\n${openingText}`].filter(Boolean).join('\n\n');
    return { text: text || null, messages: toLlmMessages(history, notes, renderText) };
  };
}
