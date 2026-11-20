import { extname, join } from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { apiRouter } from './routes/api';

const handleError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const status = error instanceof Error && 'status' in error ? error.status : undefined;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500) {
    response.status(status).json({ error: 'Request failed' });
    return;
  }

  console.error(error);
  response.status(500).json({ error: 'Internal server error' });
};

export function createApp(webDir?: string) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', express.json(), apiRouter, (_request, response) => {
    response.status(404).json({ error: 'API route not found' });
  });

  if (webDir) {
    const indexFile = join(webDir, 'index.html');
    app.use(express.static(webDir));
    app.get('/{*path}', (request, response, next) => {
      if (!request.accepts('html') || extname(request.path)) {
        next();
        return;
      }

      response.sendFile(indexFile);
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: 'Route not found' });
  });
  app.use(handleError);
  return app;
}
