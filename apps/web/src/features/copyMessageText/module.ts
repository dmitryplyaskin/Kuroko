import type { WebModule } from '../../modules/contracts';
import { notify } from '../../shared/notifications/notifications';
import type { MessageAction } from '../chat/messageActions';

const copyMessageText: MessageAction = {
  kind: 'chat.message.actions',
  id: 'kuroko.copy-message-text.copy',
  label: 'Копировать текст',
  order: 10,
  isVisible: ({ text }) => text.trim().length > 0,
  async run({ text }) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      notify({ tone: 'error', message: 'Не удалось скопировать текст.' });
      return;
    }
    notify({ tone: 'success', message: 'Текст скопирован.' });
  },
};

export const copyMessageTextModule = {
  id: 'kuroko.copy-message-text',
  contributions: [copyMessageText],
} satisfies WebModule;
