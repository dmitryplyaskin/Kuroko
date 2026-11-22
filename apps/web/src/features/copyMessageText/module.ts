import type { WebModule } from '../../modules/contracts';
import { notify } from '../../shared/notifications/notifications';
import type { MessageAction } from '../chat/messageActions';

const copyMessageText: MessageAction = {
  kind: 'chat.message.actions',
  id: 'kuroko.copy-message-text.copy',
  label: 'chat.copy',
  order: 10,
  placement: 'copy',
  isVisible: ({ text }) => text.trim().length > 0,
  async run({ text }) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      notify({ tone: 'error', message: 'error.clipboard_write_failed' });
      return;
    }
    notify({ tone: 'success', message: 'chat.copied' });
  },
};

export const copyMessageTextModule = {
  id: 'kuroko.copy-message-text',
  contributions: [copyMessageText],
} satisfies WebModule;
