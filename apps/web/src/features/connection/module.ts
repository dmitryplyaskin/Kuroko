import type { WebModule } from '../../modules/contracts';

export const connectionModule = {
  id: 'kuroko.connection',
  contributions: [{
    kind: 'settings.tab',
    id: 'kuroko.connection.preferences',
    key: 'connection',
    label: 'Подключение',
    icon: 'plug',
    description: 'Сохраняйте провайдера, модель и параметры генерации в пресеты.',
    order: 30,
    loadingLabel: 'Загружаем настройки подключения…',
  }],
  views: {
    'kuroko.connection.preferences': () => import('./ConnectionSettings'),
  },
} satisfies WebModule;
