import type { WebModule } from '../../modules/contracts';

export const instructionsModule = {
  id: 'kuroko.instructions',
  contributions: [{
    kind: 'workspace.screen',
    id: 'kuroko.instructions.index',
    route: '#instructions',
    label: 'instructions.label',
    icon: 'instructions',
    order: 23,
    loadingLabel: 'instructions.loading',
  }],
  views: { 'kuroko.instructions.index': () => import('./Instructions') },
} satisfies WebModule;
