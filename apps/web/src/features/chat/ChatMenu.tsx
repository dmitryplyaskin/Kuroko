import { Button, Group, Menu, Modal, TextInput } from '@mantine/core';
import { createWatch } from 'effector';
import { useProvidedScope, useUnit } from 'effector-react';
import { ArrowDownToLine, ArrowUpToLine, ChevronRight, List, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { chatTitleLimit, type ChatSummary } from '@kuroko/contracts/chat';
import { useI18n } from '../../shared/i18n/i18n';
import {
  $chatGmMode, $chatId, $chatLocked, $chatManagementError, $chatManaging, $chatTitle, $chats,
  chatCreateRequested, chatGmModeChanged, chatManagementErrorCleared, chatManagementRequested,
  chatManagementSucceeded, chatOpenRequested,
} from './model';

type Dialog = { kind: 'list' } | { kind: 'rename' | 'delete'; chat: ChatSummary };

export function ChatMenu({ hasMessages, scrollToStart, scrollToEnd }: {
  hasMessages: boolean; scrollToStart: () => void; scrollToEnd: () => void;
}) {
  const { t, date } = useI18n();
  const scope = useProvidedScope();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialogBack = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<Dialog>();
  const [draft, setDraft] = useState('');
  const [invalidTitle, setInvalidTitle] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const { id, title, locked, gmMode, chats, managing, error, create, open, changeGmMode, manage, clearError } = useUnit({
    id: $chatId, title: $chatTitle, locked: $chatLocked, gmMode: $chatGmMode, chats: $chats,
    managing: $chatManaging, error: $chatManagementError, create: chatCreateRequested, open: chatOpenRequested,
    changeGmMode: chatGmModeChanged, manage: chatManagementRequested, clearError: chatManagementErrorCleared,
  });

  useEffect(() => {
    if (scope) return createWatch({
      unit: chatManagementSucceeded, scope, fn: () => setDialog((current) => current && { kind: 'list' }),
    });
  }, [scope]);
  useEffect(() => {
    if (dialog?.kind === 'rename') titleInput.current?.focus();
    if (dialog?.kind === 'delete' || dialog?.kind === 'list') dialogBack.current?.focus();
  }, [dialog]);

  function show(next: Dialog) {
    clearError();
    setInvalidTitle(false);
    if (next.kind === 'rename') setDraft(next.chat.title);
    setDialog(next);
  }

  function rename(event: SubmitEvent<HTMLFormElement>, chat: ChatSummary) {
    event.preventDefault();
    if (locked) return;
    const title = draft.trim();
    if (!title || Array.from(title).length > chatTitleLimit) {
      setInvalidTitle(true);
      titleInput.current?.focus();
      return;
    }
    manage({ action: 'rename', id: chat.id, title });
  }

  const dialogTitle = dialog?.kind === 'rename' ? 'chat.rename' : dialog?.kind === 'delete' ? 'chat.deleteChat' : 'chat.savedChats';
  return (
    <>
      <Menu position="top-start" shadow="sm" width={248} withinPortal>
        <Menu.Target>
          <button ref={trigger} type="button" className="icon-button chat-menu-button" aria-label={t('chat.menu')} title={t('chat.menu')}>
            <List size={20} aria-hidden="true" />
          </button>
        </Menu.Target>
        <Menu.Dropdown aria-label={t('chat.menu')}>
          {id && <Menu.Label className="chat-menu-title"><bdi>{title || t('chat.untitled')}</bdi></Menu.Label>}
          <Menu.Item leftSection={<Plus size={16} aria-hidden="true" />} disabled={locked} onClick={create}>{t('chat.new')}</Menu.Item>
          <Menu.Item leftSection={<List size={16} aria-hidden="true" />} onClick={() => show({ kind: 'list' })}>{t('chat.savedChats')}</Menu.Item>
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
        </Menu.Dropdown>
      </Menu>

      <Modal opened={Boolean(dialog)} onClose={() => setDialog(undefined)}
        onExitTransitionEnd={() => trigger.current?.focus({ preventScroll: true })}
        title={t(dialogTitle)} centered size="lg" returnFocus={false}
        closeButtonProps={{ 'aria-label': t('common.close'), ref: dialog?.kind === 'list' ? dialogBack : undefined }}>
        {dialog?.kind === 'list' && (chats.length ? (
          <ul className="chat-manager-list">
            {chats.map((chat) => {
              const name = chat.title || t('chat.untitled');
              return (
                <li key={chat.id} className="chat-manager-row">
                  <button type="button" className="chat-manager-open" aria-current={id === chat.id ? 'true' : undefined}
                    disabled={locked && id !== chat.id} onClick={() => { open(chat.id); setDialog(undefined); }}>
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
        ) : <p className="chat-section-empty">{t('chat.noSavedChats')}</p>)}
        {dialog?.kind === 'rename' && (
          <form onSubmit={(event) => rename(event, dialog.chat)}>
            <TextInput ref={titleInput} name="title" label={t('chat.name')} value={draft} disabled={managing}
              onChange={(event) => { setDraft(event.currentTarget.value); setInvalidTitle(false); }}
              error={invalidTitle && t('chat.titleLength', { count: chatTitleLimit })} />
            {error && <p className="chat-manager-error" role="alert">{t(`error.${error}`)}</p>}
            <Group justify="flex-end" mt="md">
              <Button type="button" variant="default" disabled={managing} onClick={() => show({ kind: 'list' })}>{t('common.cancel')}</Button>
              <Button type="submit" loading={managing} disabled={locked && !managing}>{t('common.save')}</Button>
            </Group>
          </form>
        )}
        {dialog?.kind === 'delete' && (
          <>
            <p>{t('chat.deleteChatWarning', { name: dialog.chat.title || t('chat.untitled') })}</p>
            {error && <p className="chat-manager-error" role="alert">{t(`error.${error}`)}</p>}
            <Group justify="flex-end" mt="md">
              <Button ref={dialogBack} type="button" variant="default" disabled={managing}
                onClick={() => show({ kind: 'list' })}>{t('common.cancel')}</Button>
              <Button type="button" color="red" loading={managing} disabled={locked && !managing}
                onClick={() => manage({ action: 'delete', id: dialog.chat.id })}>{t('common.delete')}</Button>
            </Group>
          </>
        )}
      </Modal>
    </>
  );
}
