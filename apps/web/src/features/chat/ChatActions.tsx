import type { ChatSummary } from '@kuroko/contracts/chat';
import { ActionIcon, Menu } from '@mantine/core';
import { useUnit } from 'effector-react';
import { Copy, Download, Ellipsis, Globe, List, Pencil, Trash2 } from 'lucide-react';
import { useI18n } from '../../shared/i18n/i18n';
import { chatCopyRequested, chatExportRequested, chatManagementDialogOpened, type ChatManagementSurface } from './model';
import classes from './Chat.module.css';

export function ChatActions({ chat, locked, surface, fromList, realm, onOpenLog }: {
  chat: ChatSummary; locked: boolean; surface: ChatManagementSurface; fromList?: boolean; onOpenLog: () => void;
  realm?: { title: string; disabled: boolean; onOpen: () => void };
}) {
  const { t } = useI18n();
  const { show, copy, download } = useUnit({ show: chatManagementDialogOpened, copy: chatCopyRequested, download: chatExportRequested });
  const name = chat.title || t('chat.untitled');
  const inChatHeader = surface === 'chat' && !fromList;
  const remove = () => show({ kind: 'delete', chat, surface, fromList });
  return <div className={classes['chat-actions']}>
    {!inChatHeader && <ActionIcon type="button" size={40} variant="subtle" color="red" disabled={locked} aria-haspopup="dialog"
      aria-label={t('chat.deleteNamed', { name })} title={t('common.delete')} onClick={remove}>
      <Trash2 size={16} aria-hidden="true" />
    </ActionIcon>}
    <Menu position="bottom-end" shadow="sm" width={224}>
      <Menu.Target>
        <ActionIcon type="button" size={40} variant="subtle" disabled={locked && !inChatHeader}
          aria-label={t('chat.actionsNamed', { name })} title={t('chat.actionsMenu')}>
          <Ellipsis size={18} aria-hidden="true" />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown aria-label={t('chat.actionsNamed', { name })}>
        {inChatHeader && <>
          <Menu.Label className={classes['chat-menu-title']}><bdi>{name}</bdi></Menu.Label>
          {realm && <Menu.Item className={classes['chat-menu-world']} leftSection={<Globe size={16} aria-hidden="true" />}
            disabled={realm.disabled} onClick={realm.onOpen}>
            <bdi>{t('realms.reference', { title: realm.title })}</bdi>
          </Menu.Item>}
          <Menu.Divider />
        </>}
        <Menu.Item leftSection={<Pencil size={16} aria-hidden="true" />} aria-haspopup="dialog" disabled={locked}
          onClick={() => show({ kind: 'rename', chat, surface, fromList })}>{t('chat.rename')}</Menu.Item>
        <Menu.Item leftSection={<Copy size={16} aria-hidden="true" />} disabled={locked} onClick={() => copy(chat)}>{t('chat.copyChat')}</Menu.Item>
        <Menu.Item leftSection={<List size={16} aria-hidden="true" />} onClick={onOpenLog}>{t('chat.openLog')}</Menu.Item>
        <Menu.Item leftSection={<Download size={16} aria-hidden="true" />} disabled={locked} onClick={() => download(chat.id)}>{t('chat.downloadJson')}</Menu.Item>
        {inChatHeader && <>
          <Menu.Divider />
          <Menu.Item leftSection={<Trash2 size={16} aria-hidden="true" />} color="red" aria-haspopup="dialog" disabled={locked}
            onClick={remove}>{t('common.delete')}</Menu.Item>
        </>}
      </Menu.Dropdown>
    </Menu>
  </div>;
}
