import { createEffect, sample } from 'effector';
import { inActiveSession, protectedRequestFailed, type ActiveSession } from '../../platform/session/model';

export const personasPath = '/personas';
export const personaPath = (id: string) => `${personasPath}/${encodeURIComponent(id)}`;

export function personaEffect<Params extends { session: ActiveSession }, Result>(request: (params: Params) => Promise<Result>) {
  const effect = createEffect(request);
  sample({
    clock: inActiveSession(effect.fail, ({ session }) => session),
    fn: ({ params, error }) => ({ session: params.session, error }),
    target: protectedRequestFailed,
  });
  return effect;
}
