import type { Database } from 'bun:sqlite';
import { Router } from 'express';
import { createAccountStore } from '../auth/accountStore';
import { createAuthRouter } from '../auth/authRouter';
import { createChatSettingsStore } from '../chat-settings/chatSettingsStore';
import { createChatSettingsRouter } from '../chat-settings/chatSettingsRouter';
import { createConnectionStore } from '../connection/connectionStore';
import { createConnectionRouter } from '../connection/connectionRouter';
import { createProviderKeyStore } from '../connection/providerKeyStore';

export function createApiRouter(db: Database, vaultKey: Buffer, secureCookie: boolean) {
  const router = Router();
  const { router: authRouter, requireUser } = createAuthRouter(createAccountStore(db), secureCookie);
  const keys = createProviderKeyStore(db, vaultKey);

  router.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  router.use('/auth', authRouter);
  router.use('/settings/chat', requireUser, createChatSettingsRouter(createChatSettingsStore(db)));
  router.use('/settings/connection', requireUser, createConnectionRouter(createConnectionStore(db, keys), keys));

  return router;
}
