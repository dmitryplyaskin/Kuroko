import type { WebModule } from '../../modules/contracts';

export const settingsModule = {
  id: 'kuroko.settings',
  contributions: [{
    kind: 'workspace.screen',
    id: 'kuroko.settings.index',
    route: '#settings',
    label: 'Настройки',
    icon: 'settings',
    order: 30,
    loadingLabel: 'Загрузка настроек…',
  }],
  views: {
    'kuroko.settings.index': () => import('./Settings'),
  },
} satisfies WebModule;
