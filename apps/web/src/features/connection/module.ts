import type { WebModule } from '../../modules/contracts';
import { connectionClosed, connectionOpened } from './model';

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
    settingsLifecycle: { opened: connectionOpened, closed: connectionClosed },
  }],
  views: {
    'kuroko.connection.preferences': () => import('./ConnectionSettings'),
  },
} satisfies WebModule;
