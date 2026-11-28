import type { ChatMessage, SavedChat } from '@kuroko/contracts/chat';
import { toLlmMessages } from '@kuroko/tool-runtime/chatHistory';
import type { createInstructionStore } from './instructionStore';
import { PromptTemplateError, type createPromptRenderer } from './promptTemplate';

export function createChatTemplate(store: ReturnType<typeof createInstructionStore>, renderer: ReturnType<typeof createPromptRenderer>) {
  return (userId: number, chat: SavedChat) => {
    const draft = store.active(userId);
    const first = chat.messages[0];
    const opening = first?.realmStart ? first : undefined;
    const startId = chat.realmId ? opening?.realmStart?.id : undefined;
    const render = renderer(userId, { chat: { title: chat.title, gm_mode: chat.gmMode } }, chat.realmId ?? draft?.worldId, startId,
      draft ? undefined : opening?.text.trim());
    return { draft, render };
  };
}

export function createChatPrompt(chatTemplate: ReturnType<typeof createChatTemplate>) {
  return (userId: number, chat: SavedChat, history: ChatMessage[], notes?: ReadonlyMap<number, string>) => {
    const { draft, render } = chatTemplate(userId, chat);
    const rendered = new Map<string, string>();
    const renderText = (text: string) => {
      const cached = rendered.get(text);
      if (cached !== undefined) return cached;
      const result = render(text);
      rendered.set(text, result);
      return result;
    };
    const latest = history.at(-1);
    if (latest?.role === 'user' && !(latest.renderedText ?? renderText(latest.text)).trim()) throw new PromptTemplateError();
    const instruction = renderText(draft?.text ?? (chat.realmId ? '{{ world().context }}' : '')).trim();
    return { text: instruction || null, messages: toLlmMessages(history, notes, renderText) };
  };
}
