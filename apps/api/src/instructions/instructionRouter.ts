import { errorBody } from '@kuroko/contracts/errors';
import { readInstructionText, type ActiveChatInstruction } from '@kuroko/contracts/instructions';
import { readPresetName } from '@kuroko/contracts/presets';
import { Router, type RequestHandler } from 'express';
import { createPresetRouter, respondToPresetWrite } from '../http/presetRouter';
import type { createInstructionStore } from './instructionStore';

export function createInstructionRouter(store: ReturnType<typeof createInstructionStore>) {
  const router = Router();
  router.get('/', (_request, response) => { response.json(store.read(response.locals.user.id)); });
  router.get('/active', (_request, response) => {
    response.json({ text: store.activeText(response.locals.user.id) } satisfies ActiveChatInstruction);
  });
  router.delete('/active', (_request, response) => {
    const userId: number = response.locals.user.id;
    store.clearActive(userId);
    response.json(store.read(userId));
  });

  const save: RequestHandler<{ id?: string }> = (request, response) => {
    const userId: number = response.locals.user.id;
    const { id } = request.params;
    const text = readInstructionText(request.body?.text);
    if (!text) {
      response.status(400).json(errorBody('instruction_text_invalid', 'text'));
      return;
    }
    if (id) {
      respondToPresetWrite(response, store.savePreset(userId, id, text), () => store.read(userId));
      return;
    }
    const name = readPresetName(request.body?.name);
    if (!name) {
      response.status(400).json(errorBody('preset_name_invalid', 'name'));
      return;
    }
    respondToPresetWrite(response, store.createPreset(userId, name, text), () => store.read(userId), 201);
  };

  router.post('/presets', save);
  router.put('/presets/:id', save);
  router.use('/presets', createPresetRouter(store));
  return router;
}
