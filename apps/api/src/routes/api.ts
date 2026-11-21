import type { Database } from 'bun:sqlite';
import { Router } from 'express';
import { createProviderKeyStore } from '../secretStore';
import { createAuth } from './auth';
import { createChatSettingsRouter } from './chatSettings';
import { createConnectionSettingsRouter } from './connectionSettings';

export function createApiRouter(db: Database, vaultKey: Buffer, secureCookie: boolean) {
  const router = Router();
  const { router: authRouter, requireUser } = createAuth(db, secureCookie);
  const keys = createProviderKeyStore(db, vaultKey);

  router.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  router.use('/auth', authRouter);
  router.use('/settings/chat', requireUser, createChatSettingsRouter(db));
  router.use('/settings/connection', requireUser, createConnectionSettingsRouter(db, keys));

  return router;
}
