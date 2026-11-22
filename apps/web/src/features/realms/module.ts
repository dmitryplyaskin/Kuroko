import type { WebModule } from '../../modules/contracts';

export const realmsModule = {
  id: 'kuroko.realms',
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
