import { Router } from 'express';

export const apiRouter = Router();

apiRouter.get('/health', (_request, response) => {
  response.set('Cache-Control', 'no-store').json({ status: 'ok' });
});
