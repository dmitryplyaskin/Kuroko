import type { Database } from 'bun:sqlite';
import { json, Router } from 'express';
import { createAccountStore } from '../auth/accountStore';
import { createAuthRouter } from '../auth/authRouter';
import { createChatSettingsStore } from '../chat-settings/chatSettingsStore';
import { createChatSettingsRouter } from '../chat-settings/chatSettingsRouter';
import { createChatRouter } from '../chat/chatRouter';
import { createChatStore } from '../chat/chatStore';
import { createConnectionStore } from '../connection/connectionStore';
import { createConnectionRouter } from '../connection/connectionRouter';
import { createProviderConnections } from '../connection/providerConnections';
import { createProviderKeyStore } from '../connection/providerKeyStore';
import { createLlmRouter } from '../llm/llmRouter';
import { createLlmService } from '../llm/llmService';

export function createApiRouter(db: Database, vaultKey: Buffer, secureCookie: boolean) {
  const router = Router();
  const { router: authRouter, requireUser } = createAuthRouter(createAccountStore(db), secureCookie);
  const keys = createProviderKeyStore(db, vaultKey);
  const presets = createConnectionStore(db, keys);
  const connections = createProviderConnections();

  router.use('/llm', requireUser, json({ limit: '4mb' }), createLlmRouter(createLlmService(presets, keys, connections)));
  router.use('/chats', requireUser, json({ limit: '8mb' }), createChatRouter(createChatStore(db)));
  router.use(json({ limit: '128kb' }));
  router.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  router.use('/auth', authRouter);
  router.use('/settings/chat', requireUser, createChatSettingsRouter(createChatSettingsStore(db)));
  router.use('/settings/connection', requireUser, createConnectionRouter(presets, keys, connections));

  return router;
}
