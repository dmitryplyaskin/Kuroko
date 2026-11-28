import { chatTitleLimit } from '@kuroko/contracts/chat';
import { Button, Group, Modal, TextInput } from '@mantine/core';
import { useUnit } from 'effector-react';
import { ChevronRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useI18n } from '../../shared/i18n/i18n';
import { ChatActions } from './ChatActions';
import {
  $chatId, $chatLocked, $chatManagementError, $chatManager, $chatManaging, $savedChatList,
  chatDeleteConfirmed, chatLogOpenRequested, chatManagementDialogClosed, chatManagementDialogOpened, chatOpenRequested,
  chatRenameChanged, chatRenameSubmitted, type ChatManagementSurface,
} from './model';
import classes from './Chat.module.css';

export function ChatManagementDialog({ surface, onExit }: { surface: ChatManagementSurface; onExit?: () => void }) {
  const { t, date } = useI18n();
  const back = useRef<HTMLButtonElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const { id, locked, chats, managing, error, open, openLog, show, close, confirmDelete, rename, changeTitle, manager } = useUnit({
    id: $chatId, locked: $chatLocked, chats: $savedChatList, managing: $chatManaging, error: $chatManagementError,
    open: chatOpenRequested, openLog: chatLogOpenRequested, manager: $chatManager, show: chatManagementDialogOpened,
    close: chatManagementDialogClosed, confirmDelete: chatDeleteConfirmed, rename: chatRenameSubmitted, changeTitle: chatRenameChanged,
  });
  const { draft, invalid } = manager;
  const dialogSurface = (manager.dialog?.kind !== 'list' && manager.dialog?.surface) || 'chat';
  const dialog = dialogSurface === surface ? manager.dialog : undefined;

  useEffect(() => {
    if (dialog?.kind === 'rename') titleInput.current?.focus();
    if (dialog?.kind === 'delete' || dialog?.kind === 'list') back.current?.focus();
  }, [dialog]);
  useEffect(() => { if (invalid) titleInput.current?.focus(); }, [invalid]);

  function cancel() {
    if (dialog && dialog.kind !== 'list' && dialog.fromList) show({ kind: 'list' });
    else close();
  }

  const title = dialog?.kind === 'rename' ? 'chat.rename' : dialog?.kind === 'delete' ? 'chat.deleteChat' : 'chat.savedChats';
  return <Modal opened={Boolean(dialog)} onClose={close} onExitTransitionEnd={onExit} title={t(title)} centered size="lg"
    closeOnEscape={!managing} closeOnClickOutside={!managing}
    closeButtonProps={{ 'aria-label': t('common.close'), disabled: managing, ref: dialog?.kind === 'list' ? back : undefined }}>
    {dialog?.kind === 'list' && (chats.length ? <ul className={classes['chat-manager-list']}>
      {chats.map((chat) => <li key={chat.id} className={classes['chat-manager-row']}>
        <button type="button" className={classes['chat-manager-open']} aria-current={id === chat.id ? 'true' : undefined}
          disabled={locked && id !== chat.id} onClick={() => { open(chat.id); close(); }}>
          <strong><bdi>{chat.title || t('chat.untitled')}</bdi></strong>
          <small>{id === chat.id ? t('chat.current') : date.format(chat.updatedAt)}</small>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <ChatActions chat={chat} surface="chat" fromList locked={locked} onOpenLog={() => { openLog(chat.id); close(); }} />
      </li>)}
    </ul> : <p className={classes['chat-section-empty']}>{t('chat.noSavedChats')}</p>)}
    {dialog?.kind === 'rename' && <form onSubmit={(event) => { event.preventDefault(); rename(); }}>
      <TextInput ref={titleInput} data-autofocus name="title" label={t('chat.name')} value={draft} disabled={managing}
        onChange={(event) => changeTitle(event.currentTarget.value)}
        error={invalid && t('error.chat_title_invalid', { count: chatTitleLimit })} />
      {error && <p className={classes['chat-manager-error']} role="alert">{t(`error.${error}`, { count: chatTitleLimit })}</p>}
      <Group justify="flex-end" mt="md">
        <Button type="button" variant="default" disabled={managing} onClick={cancel}>{t('common.cancel')}</Button>
        <Button type="submit" loading={managing} disabled={locked && !managing}>{t('common.save')}</Button>
      </Group>
    </form>}
    {dialog?.kind === 'delete' && <>
      <p>{t('chat.deleteChatWarning', { name: dialog.chat.title || t('chat.untitled') })}</p>
      {error && <p className={classes['chat-manager-error']} role="alert">{t(`error.${error}`)}</p>}
      <Group justify="flex-end" mt="md">
        <Button ref={back} data-autofocus type="button" variant="default" disabled={managing} onClick={cancel}>{t('common.cancel')}</Button>
        <Button type="button" color="red" loading={managing} disabled={locked && !managing} onClick={confirmDelete}>{t('common.delete')}</Button>
      </Group>
    </>}
  </Modal>;
}
