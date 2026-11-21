import type { WebModule } from '../../modules/contracts';

export const appearanceModule = {
  id: 'kuroko.appearance',
  contributions: [{
    kind: 'settings.tab',
    id: 'kuroko.appearance.preferences',
    key: 'appearance',
    label: 'appearance.label',
    icon: 'palette',
    description: 'appearance.description',
    order: 10,
    loadingLabel: 'appearance.loading',
  }],
  views: {
    'kuroko.appearance.preferences': () => import('./Appearance'),
  },
} satisfies WebModule;
