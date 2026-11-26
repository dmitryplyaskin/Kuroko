import type { WebModule } from '../../modules/contracts';
import { $temporaryAgentToolsDirty, toolsInitialized } from './model';

export const toolsModule = {
  id: 'kuroko.tools',
  initialize: toolsInitialized,
  hasUnsavedChanges: $temporaryAgentToolsDirty,
  contributions: [{
    kind: 'workspace.screen',
    id: 'kuroko.tools.index',
    route: '#tools',
    label: 'tools.label',
    icon: 'tools',
    order: 25,
    loadingLabel: 'tools.loading',
  }],
  views: { 'kuroko.tools.index': () => import('./ToolManager') },
} satisfies WebModule;
