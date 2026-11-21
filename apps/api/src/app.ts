import { errorBody } from '@kuroko/contracts/errors';
import type { Database } from 'bun:sqlite';
import { extname, join } from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { createApiRouter } from './http/apiRouter';

const handleError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const status = error instanceof Error && 'status' in error ? error.status : undefined;
  if (error instanceof Error && typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500) {
    const code = status === 413 ? 'payload_too_large' : status === 415 ? 'unsupported_request_format'
      : 'type' in error && error.type === 'entity.parse.failed' ? 'invalid_json' : 'request_failed';
    response.status(status).json(errorBody(code));
    return;
  }

  console.error('server_error', error);
  response.status(500).json(errorBody('server_error'));
};

type AppOptions = { db: Database; vaultKey: Buffer; secureCookie: boolean; trustProxy?: string; webDir?: string };

export function createApp({ db, vaultKey, secureCookie, trustProxy, webDir }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) {
    app.set('trust proxy', trustProxy);
  }
  app.use('/api', (request, response, next) => {
    response.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    // HTML forms cannot set this header, and cross-origin scripts require CORS permission.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.get('X-Kuroko-Request') !== '1') {
      response.status(403).json(errorBody('request_rejected'));
      return;
    }
    next();
  }, createApiRouter(db, vaultKey, secureCookie), (_request, response) => {
    response.status(404).json(errorBody('api_route_not_found'));
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
    response.status(404).json(errorBody('route_not_found'));
  });
  app.use(handleError);
  return app;
}
