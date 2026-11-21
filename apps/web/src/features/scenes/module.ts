import type { WebModule } from '../../modules/contracts';

export const scenesModule = {
  id: 'kuroko.scenes',
  contributions: [{
    kind: 'workspace.screen',
    id: 'kuroko.scenes.index',
    route: '#scenes',
    label: 'Сцены',
    icon: 'panels',
    order: 10,
    loadingLabel: 'Загрузка сцен…',
  }],
  views: {
    'kuroko.scenes.index': () => import('./Scenes'),
  },
} satisfies WebModule;
