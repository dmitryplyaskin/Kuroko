import { errorBody } from '@kuroko/contracts/errors';
import { readPresetName } from '@kuroko/contracts/presets';
import { Router, type RequestHandler, type Response } from 'express';

export type PresetWriteResult = 'saved' | 'missing-preset' | 'duplicate' | 'conflict';

type PresetStore = {
  read(userId: number): object;
  applyPreset(userId: number, id: string): boolean;
  renamePreset(userId: number, id: string, name: string): PresetWriteResult;
  copyPreset(userId: number, id: string, name: string): PresetWriteResult;
  removePreset(userId: number, id: string): boolean;
};

export function respondToPresetWrite(
  response: Response, result: PresetWriteResult, read: () => object, status = 200,
) {
  if (result === 'missing-preset') response.status(404).json(errorBody('preset_not_found'));
  else if (result === 'conflict') response.status(409).json(errorBody('preset_conflict'));
  else if (result === 'duplicate') response.status(409).json(errorBody('preset_name_taken', 'name'));
  else response.status(status).json(read());
}

export function createPresetRouter(store: PresetStore) {
  const router = Router();
  function withoutName(operation: PresetStore['applyPreset']): RequestHandler<{ id: string }> {
    return (request, response) => {
      const userId: number = response.locals.user.id;
      respondToPresetWrite(response, operation(userId, request.params.id) ? 'saved' : 'missing-preset', () => store.read(userId));
    };
  }

  function withName(operation: PresetStore['renamePreset'], status: number): RequestHandler<{ id: string }> {
    return (request, response) => {
      const name = readPresetName(request.body?.name);
      if (!name) {
        response.status(400).json(errorBody('preset_name_invalid', 'name'));
        return;
      }
      const userId: number = response.locals.user.id;
      respondToPresetWrite(response, operation(userId, request.params.id, name), () => store.read(userId), status);
    };
  }

  router.put('/:id/apply', withoutName(store.applyPreset));
  router.put('/:id/rename', withName(store.renamePreset, 200));
  router.post('/:id/copy', withName(store.copyPreset, 201));
  router.delete('/:id', withoutName(store.removePreset));
  return router;
}
