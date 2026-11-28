import type { WebModule } from '../../modules/contracts';
import { chatSettingsInitialized } from './settings/model';

export const chatModule = {
  id: 'kuroko.chat',
  initialize: chatSettingsInitialized,
  contributions: [{
    kind: 'workspace.screen',
    id: 'kuroko.chat.index',
    route: '#chat',
    label: 'chat.label',
    title: 'chat.title',
    icon: 'message',
    order: 11,
    layout: 'viewport',
    retainAfterVisit: true,
    loadingLabel: 'chat.loading',
  }, {
    kind: 'workspace.screen',
    id: 'kuroko.chat.history',
    route: '#history',
    label: 'chatHistory.label',
    icon: 'history',
    order: 12,
    loadingLabel: 'chatHistory.loading',
  }, {
    kind: 'settings.tab',
    id: 'kuroko.chat.preferences',
    key: 'chat',
    label: 'chat.label',
    icon: 'message',
    description: 'chatSettings.description',
    order: 20,
    loadingLabel: 'chatSettings.loading',
  }],
  views: {
    'kuroko.chat.index': () => import('./Chat'),
    'kuroko.chat.history': () => import('./history/ChatHistoryPage'),
    'kuroko.chat.preferences': () => import('./settings/ChatPreferences'),
  },
} satisfies WebModule;
