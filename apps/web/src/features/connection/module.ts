import type { WebModule } from '../../modules/contracts';

export const connectionModule = {
  id: 'kuroko.connection',
  contributions: [{
    kind: 'settings.tab',
    id: 'kuroko.connection.preferences',
    key: 'connection',
    label: 'connection.label',
    icon: 'plug',
    description: 'connection.description',
    order: 30,
    loadingLabel: 'connection.loading',
  }],
  views: {
    'kuroko.connection.preferences': () => import('./ConnectionSettings'),
  },
} satisfies WebModule;
