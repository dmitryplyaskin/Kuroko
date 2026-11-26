import type { ChatMessage, SavedChat } from '@kuroko/contracts/chat';
import { toLlmMessages } from '@kuroko/tool-runtime/chatHistory';
import type { createInstructionStore } from './instructionStore';
import { PromptTemplateError, type createPromptRenderer } from './promptTemplate';

export function createChatPrompt(store: ReturnType<typeof createInstructionStore>, renderer: ReturnType<typeof createPromptRenderer>) {
  return (userId: number, chat: SavedChat, history: ChatMessage[], notes?: ReadonlyMap<number, string>) => {
    const draft = store.active(userId);
    const render = renderer(userId, { chat: { title: chat.title, gm_mode: chat.gmMode } }, draft?.worldId);
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
    return { text: draft ? renderText(draft.text).trim() || null : null, messages: toLlmMessages(history, notes, renderText) };
  };
}
