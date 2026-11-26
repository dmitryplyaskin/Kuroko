import type { SavedChat } from '@kuroko/contracts/chat';
import { errorBody } from '@kuroko/contracts/errors';
import { isWorldBinding, readInstructionText, type ActiveChatInstruction } from '@kuroko/contracts/instructions';
import { readPresetName } from '@kuroko/contracts/presets';
import { Router, type RequestHandler } from 'express';
import { createPresetRouter, respondToPresetWrite } from '../http/presetRouter';
import type { createInstructionStore } from './instructionStore';
import type { createChatPrompt } from './chatPrompt';
import { PromptTemplateError, validatePromptTemplate, type createPromptRenderer } from './promptTemplate';

export function createInstructionRouter(
  store: ReturnType<typeof createInstructionStore>,
  findChat: (userId: number, id: string) => SavedChat | null,
  worldExists: (userId: number, id: string) => boolean,
  render: ReturnType<typeof createPromptRenderer>,
  preparePrompt: ReturnType<typeof createChatPrompt>,
) {
  const router = Router();
  router.get('/', (_request, response) => { response.json(store.read(response.locals.user.id)); });
  router.get('/active', (request, response) => {
    const userId: number = response.locals.user.id;
    const chatId = request.query.chat;
    if (chatId === undefined) {
      response.json({ text: store.active(userId)?.text ?? null } satisfies ActiveChatInstruction);
      return;
    }
    if (typeof chatId !== 'string' || !chatId) { response.status(400).json(errorBody('invalid_request')); return; }
    const chat = findChat(userId, chatId);
    if (!chat) { response.status(404).json(errorBody('chat_not_found')); return; }
    const replace = request.query.replace;
    if (replace !== undefined && (typeof replace !== 'string' || !/^\d+$/.test(replace) ||
        chat.messages.at(-1)?.role !== 'assistant' || chat.messages.at(-1)?.id !== Number(replace))) {
      response.status(409).json(errorBody('chat_conflict'));
      return;
    }
    try {
      response.json(preparePrompt(userId, chat, replace === undefined ? chat.messages : chat.messages.slice(0, -1)));
    } catch (error) {
      if (!(error instanceof PromptTemplateError)) throw error;
      response.status(422).json(error.body);
    }
  });
  router.post('/preview', (request, response) => {
    const text = readInstructionText(request.body?.text);
    const { chatTitle, gmMode, agentName, worldId } = request.body ?? {};
    if (!text || !isWorldBinding(worldId) || (agentName !== undefined && (typeof agentName !== 'string' || agentName.length > 128 || !agentName.isWellFormed())) ||
        (chatTitle !== undefined && (typeof chatTitle !== 'string' || chatTitle.length > 128 || !chatTitle.isWellFormed())) ||
        (gmMode !== undefined && typeof gmMode !== 'boolean')) {
      response.status(400).json(errorBody('instruction_text_invalid', 'text'));
      return;
    }
    const userId: number = response.locals.user.id;
    if (worldId && !worldExists(userId, worldId)) { response.status(404).json(errorBody('realm_not_found')); return; }
    const context = agentName !== undefined ? { agent: { name: agentName } }
      : { chat: { title: chatTitle ?? 'Example scene', gm_mode: gmMode ?? false } };
    try {
      response.json({ text: render(userId, context, worldId)(text).trim() });
    } catch (error) {
      if (!(error instanceof PromptTemplateError)) throw error;
      response.status(422).json(error.body);
    }
  });
  router.delete('/active', (_request, response) => {
    const userId: number = response.locals.user.id;
    store.clearActive(userId);
    response.json(store.read(userId));
  });

  const save: RequestHandler<{ id?: string }> = (request, response) => {
    const userId: number = response.locals.user.id;
    const { id } = request.params;
    const worldId = request.body?.worldId;
    const text = readInstructionText(request.body?.text);
    if (!text || !isWorldBinding(worldId)) {
      response.status(400).json(errorBody('instruction_text_invalid', 'text'));
      return;
    }
    if (worldId && !worldExists(userId, worldId)) { response.status(404).json(errorBody('realm_not_found')); return; }
    const draft = { text, worldId };
    try {
      validatePromptTemplate(text);
    } catch (error) {
      if (!(error instanceof PromptTemplateError)) throw error;
      response.status(422).json(error.body);
      return;
    }
    if (id) {
      respondToPresetWrite(response, store.savePreset(userId, id, draft), () => store.read(userId));
      return;
    }
    const name = readPresetName(request.body?.name);
    if (!name) {
      response.status(400).json(errorBody('preset_name_invalid', 'name'));
      return;
    }
    respondToPresetWrite(response, store.createPreset(userId, name, draft), () => store.read(userId), 201);
  };

  router.post('/presets', save);
  router.put('/presets/:id', save);
  router.use('/presets', createPresetRouter(store));
  return router;
}
