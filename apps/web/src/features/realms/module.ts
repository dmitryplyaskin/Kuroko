import type { WebModule } from '../../modules/contracts';
import { createLibraryViewPreference } from '../../shared/library/viewPreference';
import { $realmEditorHasUnsavedChanges } from './model';

export const realmLibraryView = createLibraryViewPreference('kuroko-realms-view');

export const realmsModule = {
  id: 'kuroko.realms',
  hasUnsavedChanges: $realmEditorHasUnsavedChanges,
  contributions: [{
    kind: 'workspace.screen',
    id: 'kuroko.realms.index',
    route: '#realms',
    label: 'realms.label',
    icon: 'globe',
    order: 15,
    retainAfterVisit: true,
    loadingLabel: 'realms.loading',
  }],
  views: {
    'kuroko.realms.index': () => import('./Realms'),
  },
} satisfies WebModule;
