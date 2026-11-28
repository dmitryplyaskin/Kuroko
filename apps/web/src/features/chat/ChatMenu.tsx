import { Button, Group, Menu, Modal, TextInput } from '@mantine/core';
import { useUnit } from 'effector-react';
import { chatTitleLimit } from '@kuroko/contracts/chat';
import { ArrowDownToLine, ArrowUpToLine, BookOpen, ChevronRight, List, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { TemplateGuideModal } from '../../shared/prompt-templates/TemplateHelp';
import {
  $chatGmMode, $chatId, $chatLocked, $chatManagementError, $chatManager, $chatManaging, $chatTitle, $savedChatList, $unlinkedChat,
  chatCreateRequested, chatDeleteConfirmed, chatGmModeChanged, chatManagementDialogClosed,
  chatManagementDialogOpened, chatOpenRequested, chatRenameChanged, chatRenameSubmitted,
} from './model';
import chatClasses from './Chat.module.css';

export function ChatMenu({ hasMessages, scrollToStart, scrollToEnd }: {
  hasMessages: boolean; scrollToStart: () => void; scrollToEnd: () => void;
}) {
  const { t, date } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialogBack = useRef<HTMLButtonElement>(null);
  const [guideOpened, setGuideOpened] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const {
    id, title, locked, gmMode, chats, unlinkedChat, managing, error, create, open, changeGmMode, show, close, confirmDelete, rename, changeTitle,
    manager: { dialog, draft, invalid },
  } = useUnit({
    id: $chatId, title: $chatTitle, locked: $chatLocked, gmMode: $chatGmMode, chats: $savedChatList, unlinkedChat: $unlinkedChat,
    managing: $chatManaging, error: $chatManagementError, create: chatCreateRequested, open: chatOpenRequested,
    changeGmMode: chatGmModeChanged, manager: $chatManager, show: chatManagementDialogOpened, close: chatManagementDialogClosed,
    confirmDelete: chatDeleteConfirmed, rename: chatRenameSubmitted, changeTitle: chatRenameChanged,
  });

  useEffect(() => {
    if (dialog?.kind === 'rename') titleInput.current?.focus();
    if (dialog?.kind === 'delete' || dialog?.kind === 'list') dialogBack.current?.focus();
  }, [dialog]);
  useEffect(() => { if (invalid) titleInput.current?.focus(); }, [invalid]);

  const dialogTitle = dialog?.kind === 'rename' ? 'chat.rename' : dialog?.kind === 'delete' ? 'chat.deleteChat' : 'chat.savedChats';
  return (
    <>
      <Menu position="top-start" shadow="sm" width={248} withinPortal>
        <Menu.Target>
          <button ref={trigger} type="button" className={['icon-button', chatClasses['chat-menu-button']].join(' ')} aria-label={t('chat.menu')} title={t('chat.menu')}>
            <List size={20} aria-hidden="true" />
          </button>
        </Menu.Target>
        <Menu.Dropdown aria-label={t('chat.menu')}>
          {id && <Menu.Label className={chatClasses['chat-menu-title']}><bdi>{title || t('chat.untitled')}</bdi></Menu.Label>}
          <Menu.Item leftSection={<Plus size={16} aria-hidden="true" />} disabled={locked} onClick={create}>{t('chat.new')}</Menu.Item>
          <Menu.Item leftSection={<List size={16} aria-hidden="true" />} onClick={() => show({ kind: 'list' })}>{t('chat.savedChats')}</Menu.Item>
          {unlinkedChat && <Menu.Item leftSection={<ChevronRight size={16} aria-hidden="true" />} disabled={locked}
            onClick={() => open(unlinkedChat.id)}>{t('chat.openUnlinked')}</Menu.Item>}
          <Menu.Divider />
          <Menu.CheckboxItem checked={gmMode} onChange={changeGmMode} disabled={!id || locked}
            title={t('chat.gmModeDescription')}>{t('chat.gmMode')}</Menu.CheckboxItem>
          {hasMessages && (
            <>
              <Menu.Divider />
              <Menu.Item leftSection={<ArrowUpToLine size={16} aria-hidden="true" />} onClick={scrollToStart}>{t('chat.historyStart')}</Menu.Item>
              <Menu.Item leftSection={<ArrowDownToLine size={16} aria-hidden="true" />} onClick={scrollToEnd}>{t('chat.historyEnd')}</Menu.Item>
            </>
          )}
          <Menu.Divider />
          <Menu.Item leftSection={<BookOpen size={16} aria-hidden="true" />} aria-haspopup="dialog" onClick={() => setGuideOpened(true)}>
            {t('templates.guideTitle')}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <TemplateGuideModal scope="chat" opened={guideOpened} onClose={() => setGuideOpened(false)}
        onExitTransitionEnd={() => trigger.current?.focus({ preventScroll: true })} />

      <Modal opened={Boolean(dialog)} onClose={close}
        onExitTransitionEnd={() => trigger.current?.focus({ preventScroll: true })}
        title={t(dialogTitle)} centered size="lg" returnFocus={false}
        closeButtonProps={{ 'aria-label': t('common.close'), ref: dialog?.kind === 'list' ? dialogBack : undefined }}>
        {dialog?.kind === 'list' && (chats.length ? (
          <ul className={chatClasses['chat-manager-list']}>
            {chats.map((chat) => {
              const name = chat.title || t('chat.untitled');
              return (
                <li key={chat.id} className={chatClasses['chat-manager-row']}>
                  <button type="button" className={chatClasses['chat-manager-open']} aria-current={id === chat.id ? 'true' : undefined}
                    disabled={locked && id !== chat.id} onClick={() => { open(chat.id); close(); }}>
                    <strong><bdi>{name}</bdi></strong>
                    <small>{id === chat.id ? t('chat.current') : date.format(chat.updatedAt)}</small>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                  <button type="button" className="icon-button" aria-label={t('chat.renameNamed', { name })} title={t('chat.rename')}
                    disabled={locked} onClick={() => show({ kind: 'rename', chat })}><Pencil size={16} aria-hidden="true" /></button>
                  <button type="button" className="icon-button" aria-label={t('chat.deleteNamed', { name })} title={t('common.delete')}
                    disabled={locked} onClick={() => show({ kind: 'delete', chat })}><Trash2 size={16} aria-hidden="true" /></button>
                </li>
              );
            })}
          </ul>
        ) : <p className={chatClasses['chat-section-empty']}>{t('chat.noSavedChats')}</p>)}
        {dialog?.kind === 'rename' && (
          <form onSubmit={(event) => { event.preventDefault(); rename(); }}>
            <TextInput ref={titleInput} name="title" label={t('chat.name')} value={draft} disabled={managing}
              onChange={(event) => changeTitle(event.currentTarget.value)}
              error={invalid && t('error.chat_title_invalid', { count: chatTitleLimit })} />
            {error && <p className={chatClasses['chat-manager-error']} role="alert">{t(`error.${error}`, { count: chatTitleLimit })}</p>}
            <Group justify="flex-end" mt="md">
              <Button type="button" variant="default" disabled={managing} onClick={() => show({ kind: 'list' })}>{t('common.cancel')}</Button>
              <Button type="submit" loading={managing} disabled={locked && !managing}>{t('common.save')}</Button>
            </Group>
          </form>
        )}
        {dialog?.kind === 'delete' && (
          <>
            <p>{t('chat.deleteChatWarning', { name: dialog.chat.title || t('chat.untitled') })}</p>
            {error && <p className={chatClasses['chat-manager-error']} role="alert">{t(`error.${error}`)}</p>}
            <Group justify="flex-end" mt="md">
              <Button ref={dialogBack} type="button" variant="default" disabled={managing}
                onClick={() => show({ kind: 'list' })}>{t('common.cancel')}</Button>
              <Button type="button" color="red" loading={managing} disabled={locked && !managing}
                onClick={confirmDelete}>{t('common.delete')}</Button>
            </Group>
          </>
        )}
      </Modal>
    </>
  );
}
