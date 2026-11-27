import type { WebModule } from '../../modules/contracts';
import { createLibraryViewPreference } from '../../shared/library/viewPreference';
import { $personaDirty } from './editorModel';

export const personaLibraryView = createLibraryViewPreference('kuroko-personas-view');

export const personasModule = {
  id: 'kuroko.personas',
  hasUnsavedChanges: $personaDirty,
  contributions: [{
    kind: 'workspace.screen',
    id: 'kuroko.personas.index',
    route: '#personas',
    label: 'personas.label',
    icon: 'personas',
    order: 16,
    retainAfterVisit: true,
    loadingLabel: 'personas.loading',
  }],
  views: { 'kuroko.personas.index': () => import('./Personas') },
} satisfies WebModule;
