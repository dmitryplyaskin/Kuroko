import type { WebModule } from '../../modules/contracts';
import { $agentEditorDirty } from './model';

export const agentsModule = {
  id: 'kuroko.agents',
  hasUnsavedChanges: $agentEditorDirty,
  contributions: [{
    kind: 'workspace.screen',
    id: 'kuroko.agents.index',
    route: '#agents',
    label: 'agents.label',
    icon: 'agents',
    order: 27,
    loadingLabel: 'agents.loading',
    retainAfterVisit: true,
  }],
  views: { 'kuroko.agents.index': () => import('./Agents') },
} satisfies WebModule;
