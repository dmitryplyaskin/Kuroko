import type { ChatSummary } from '@kuroko/contracts/chat';
import { ActionIcon, Menu } from '@mantine/core';
import { useUnit } from 'effector-react';
import { Copy, Download, Ellipsis, List, Pencil, Trash2 } from 'lucide-react';
import { useI18n } from '../../shared/i18n/i18n';
import { chatCopyRequested, chatExportRequested, chatManagementDialogOpened, type ChatManagementSurface } from './model';
import classes from './Chat.module.css';

export function ChatActions({ chat, locked, surface, fromList, onOpenLog }: {
  chat: ChatSummary; locked: boolean; surface: ChatManagementSurface; fromList?: boolean; onOpenLog: () => void;
}) {
  const { t } = useI18n();
  const { show, copy, download } = useUnit({ show: chatManagementDialogOpened, copy: chatCopyRequested, download: chatExportRequested });
  const name = chat.title || t('chat.untitled');
  return <div className={classes['chat-actions']}>
    <ActionIcon type="button" size={40} variant="subtle" color="red" disabled={locked} aria-haspopup="dialog"
      aria-label={t('chat.deleteNamed', { name })} title={t('common.delete')}
      onClick={() => show({ kind: 'delete', chat, surface, fromList })}>
      <Trash2 size={16} aria-hidden="true" />
    </ActionIcon>
    <Menu position="bottom-end" shadow="sm" width={224}>
      <Menu.Target>
        <ActionIcon type="button" size={40} variant="subtle" disabled={locked}
          aria-label={t('chat.actionsNamed', { name })} title={t('chat.actionsMenu')}>
          <Ellipsis size={18} aria-hidden="true" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown aria-label={t('chat.actionsNamed', { name })}>
        <Menu.Item leftSection={<Pencil size={16} aria-hidden="true" />} aria-haspopup="dialog"
          onClick={() => show({ kind: 'rename', chat, surface, fromList })}>{t('chat.rename')}</Menu.Item>
        <Menu.Item leftSection={<Copy size={16} aria-hidden="true" />} onClick={() => copy(chat)}>{t('chat.copyChat')}</Menu.Item>
        <Menu.Item leftSection={<List size={16} aria-hidden="true" />} onClick={onOpenLog}>{t('chat.openLog')}</Menu.Item>
        <Menu.Item leftSection={<Download size={16} aria-hidden="true" />} onClick={() => download(chat.id)}>{t('chat.downloadJson')}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  </div>;
}
