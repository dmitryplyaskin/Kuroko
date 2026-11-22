import type { PresetManagementAction } from '@kuroko/contracts/presets';
import type { ActiveSession } from './session/model';
import { sessionRequest } from './session/request';

export function requestPresetAction<State>(session: ActiveSession, path: string, action: PresetManagementAction) {
  const presetPath = `${path}/${encodeURIComponent(action.id)}`;
  switch (action.kind) {
    case 'apply':
      return sessionRequest<State>(session, `${presetPath}/apply`, { method: 'PUT' });
    case 'delete':
      return sessionRequest<State>(session, presetPath, { method: 'DELETE' });
    case 'rename':
    case 'copy':
      return sessionRequest<State>(session, `${presetPath}/${action.kind}`, {
        method: action.kind === 'copy' ? 'POST' : 'PUT', body: { name: action.name },
      });
  }
}
