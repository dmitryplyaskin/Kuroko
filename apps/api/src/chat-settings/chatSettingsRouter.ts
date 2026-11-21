import { errorBody } from '@kuroko/contracts/errors';
import { Router } from 'express';
import { readChatSettings, type ChatSettingsResponse } from '@kuroko/contracts/chatSettings';
import type { createChatSettingsStore } from './chatSettingsStore';

export function createChatSettingsRouter(store: ReturnType<typeof createChatSettingsStore>) {
  const router = Router();
  router.get('/', (_request, response) => {
    const settings = store.read(response.locals.user.id);
    response.json({ settings } satisfies ChatSettingsResponse);
  });

  router.put('/', (request, response) => {
    const settings = readChatSettings(request.body);
    if (!settings) {
      response.status(400).json(errorBody('chat_settings_invalid'));
      return;
    }

    store.save(response.locals.user.id, settings);
    response.json({ settings } satisfies ChatSettingsResponse);
  });

  return router;
}
