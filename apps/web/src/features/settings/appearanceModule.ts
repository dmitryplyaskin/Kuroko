import type { WebModule } from '../../modules/contracts';

export const appearanceModule = {
  id: 'kuroko.appearance',
  contributions: [{
    kind: 'settings.tab',
    id: 'kuroko.appearance.preferences',
    key: 'appearance',
    label: 'Внешний вид',
    icon: 'palette',
    description: 'Тема и цвет акцента сохраняются в этом браузере.',
    order: 10,
    loadingLabel: 'Загрузка настроек внешнего вида…',
  }],
  views: {
    'kuroko.appearance.preferences': () => import('./Appearance'),
  },
} satisfies WebModule;
