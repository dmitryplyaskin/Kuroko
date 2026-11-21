import { createEffect } from 'effector';

export const abortFx = createEffect((controller: AbortController) => controller.abort());
