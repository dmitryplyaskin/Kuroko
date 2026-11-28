import type { WebModule } from '../../modules/contracts';

export const homeModule = {
  id: 'kuroko.home',
  contributions: [{
    kind: 'workspace.screen',
    id: 'kuroko.home.index',
    route: '#home',
    label: 'home.label',
    icon: 'home',
    order: 10,
    loadingLabel: 'home.loading',
  }],
  views: {
    'kuroko.home.index': () => import('./Home'),
  },
} satisfies WebModule;
