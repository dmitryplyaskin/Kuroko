import type { Database } from 'bun:sqlite';
import { Router } from 'express';
import { createAuth } from './auth';
import { createSecretsRouter } from './secrets';

export function createApiRouter(db: Database, vaultKey: Buffer, secureCookie: boolean) {
  const router = Router();
  const { router: authRouter, requireUser } = createAuth(db, secureCookie);

  router.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  router.use('/auth', authRouter);
  router.use('/secrets', requireUser, createSecretsRouter(db, vaultKey));

  return router;
}
