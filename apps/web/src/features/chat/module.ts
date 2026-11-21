import type { WebModule } from '../../modules/contracts';
import { chatSettingsInitialized } from './settings/model';

export const chatModule = {
  id: 'kuroko.chat',
  initialize: chatSettingsInitialized,
  contributions: [{
    kind: 'workspace.screen',
    id: 'kuroko.chat.index',
    route: '#chat',
    label: 'Чат',
    title: 'Тестовый чат',
    icon: 'message',
    order: 20,
    layout: 'viewport',
    retainAfterVisit: true,
    loadingLabel: 'Загрузка чата…',
  }, {
    kind: 'settings.tab',
    id: 'kuroko.chat.preferences',
    key: 'chat',
    label: 'Чат',
    icon: 'message',
    description: 'Настройки чата применяются после сохранения.',
    order: 20,
    loadingLabel: 'Загрузка настроек чата…',
  }],
  views: {
    'kuroko.chat.index': () => import('./Chat'),
    'kuroko.chat.preferences': () => import('./settings/ChatPreferences'),
  },
} satisfies WebModule;
