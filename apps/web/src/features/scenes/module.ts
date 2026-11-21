import type { WebModule } from '../../modules/contracts';

export const scenesModule = {
  id: 'kuroko.scenes',
  contributions: [{
    kind: 'workspace.screen',
    id: 'kuroko.scenes.index',
    route: '#scenes',
    label: 'scenes.label',
    icon: 'panels',
    order: 10,
    loadingLabel: 'scenes.loading',
  }],
  views: {
    'kuroko.scenes.index': () => import('./Scenes'),
  },
} satisfies WebModule;
