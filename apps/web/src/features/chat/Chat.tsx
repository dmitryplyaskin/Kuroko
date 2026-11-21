import { useI18n } from '../../shared/i18n/i18n';
import { Button, Group, Modal, NativeSelect, Switch, useComputedColorScheme } from '@mantine/core';
import { createWatch } from 'effector';
import { useProvidedScope, useUnit } from 'effector-react';
import { ArrowDownToLine, ArrowUpToLine, Plus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChatComposer } from './ChatComposer';
import { ChatHistory, type ChatHistoryHandle } from './ChatHistory';
import { ChatMessage, ChatPicture } from './ChatMessage';
import { $activeSession } from '../../platform/session/model';
import { chatDisplayStyle } from './chatDisplayStyle';
import type { ChatImage, Message } from './message';
import {
  $chatAnnouncement, $chatRows, $expandedReasoning, $messageEditor, $replyId,
  $chatGmMode, $chatId, $chatLoadError, $chatLoading, $chatLocked, $chatSaveError, $chats,
  chatCreateRequested, chatGmModeChanged, chatLoadRetryRequested, chatOpenRequested, chatSaveRetryRequested,
  chatHidden, chatShown, keepHistoryAtEndRequested, messageDeleteRequested, messageEditCancelled,
  messageEditChanged, messageEditRequested, messageEditSubmitted, messageSent, reasoningToggled,
} from './model';
import { $appliedChatSettings } from './settings/model';
import './chat.css';

type Preview = { kind: 'preview'; image: ChatImage };
type Delete = { kind: 'delete'; message: Message };

export default function Chat() {
  const { t, number, plural } = useI18n();
  const scheme = useComputedColorScheme('light');
  const [dialog, setDialog] = useState<Preview | Delete>();
  const scope = useProvidedScope();
  const {
    session, settings, rows, replyId, announcement, editor, expandedReasoning, show, hide, openEditor,
    changeDraft, closeEditor, saveEdit, remove, toggleReasoning,
    chatId, chats, gmMode, loading, locked, loadError, saveError, createChat, changeGmMode, openChat, retryLoad, retrySave,
  } = useUnit({
    session: $activeSession, settings: $appliedChatSettings,
    rows: $chatRows, replyId: $replyId, announcement: $chatAnnouncement,
    editor: $messageEditor, expandedReasoning: $expandedReasoning, show: chatShown, hide: chatHidden,
    openEditor: messageEditRequested, changeDraft: messageEditChanged, closeEditor: messageEditCancelled,
    saveEdit: messageEditSubmitted, remove: messageDeleteRequested, toggleReasoning: reasoningToggled,
    chatId: $chatId, chats: $chats, gmMode: $chatGmMode, loading: $chatLoading, locked: $chatLocked, loadError: $chatLoadError, saveError: $chatSaveError,
    changeGmMode: chatGmModeChanged,
    createChat: chatCreateRequested, openChat: chatOpenRequested, retryLoad: chatLoadRetryRequested, retrySave: chatSaveRetryRequested,
  });
  const username = session?.user.username ?? '';
  const title = useRef<HTMLHeadingElement>(null);
  const history = useRef<ChatHistoryHandle>(null);
  const jumpOnSend = useRef(false);
  const focusAfterDelete = useRef(false);

  const openDelete = useCallback((message: Message) => setDialog({ kind: 'delete', message }), []);
  const openPreview = useCallback((image: ChatImage) => setDialog({ kind: 'preview', image }), []);
  const setReasoningOpen = useCallback((id: number, open: boolean) => toggleReasoning({ id, open }), [toggleReasoning]);
  const updateMessageDraft = useCallback((id: number, text: string) => changeDraft({ id, text }), [changeDraft]);
  const renderMessage = useCallback((message: Message) => (
    <ChatMessage message={message} username={username} phase={message.id === replyId ? 'answer' : undefined} locked={locked}
      editor={editor?.id === message.id ? editor : undefined}
      reasoningOpen={expandedReasoning.has(message.id)} onToggleReasoning={setReasoningOpen}
      onEdit={openEditor} onDraftChange={updateMessageDraft} onCancelEdit={closeEditor} onSaveEdit={saveEdit}
      onDelete={openDelete} onPreview={openPreview} />
  ), [username, replyId, locked, editor, expandedReasoning, setReasoningOpen, openEditor, updateMessageDraft, closeEditor, saveEdit, openDelete, openPreview]);

  useEffect(() => {
    if (!scope) return;
    const unwatchScroll = createWatch({ unit: keepHistoryAtEndRequested, scope, fn: () => history.current?.keepEndInView() });
    const unwatchSend = createWatch({ unit: messageSent, scope, fn: () => { jumpOnSend.current = true; } });
    show();
    return () => {
      unwatchScroll();
      unwatchSend();
      hide();
    };
  }, [scope, show, hide]);

  useLayoutEffect(() => {
    if (!jumpOnSend.current) return;
    jumpOnSend.current = false;
    history.current?.scrollToEnd();
  }, [replyId]);

  const countCategory = plural.select(rows.length);
  const countKey = countCategory === 'one' ? 'chat.countOne' : countCategory === 'few' ? 'chat.countFew' : 'chat.countOther';

  function removeMessage(message: Message) {
    focusAfterDelete.current = true;
    remove(message.id);
    setDialog(undefined);
  }

  return (
    <section className="chat-panel" aria-labelledby="chat-title" data-user-side={settings.userSide}
      style={chatDisplayStyle(settings, scheme)}>
      <header className="chat-header">
        <div className="chat-header-inner chat-column">
          <div>
            <h1 id="chat-title" ref={title} tabIndex={-1}>{t('chat.title')}</h1>
            <p>{t(countKey, { count: number.format(rows.length) })}</p>
          </div>
          <div className="chat-navigation">
            <button type="button" className="icon-button" aria-label={t('chat.historyStart')} title={t('chat.historyStart')}
              disabled={!rows.length} onClick={() => history.current?.scrollToStart()}>
              <ArrowUpToLine size={18} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label={t('chat.historyEnd')} title={t('chat.historyEnd')}
              disabled={!rows.length} onClick={() => history.current?.scrollToEnd()}>
              <ArrowDownToLine size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="chat-switcher chat-column">
          <NativeSelect aria-label={t('chat.savedChats')} value={chatId} disabled={locked || !chats.length}
            data={chats.map(({ id, title }) => ({ value: id, label: title || t('chat.untitled') }))}
            onChange={(event) => openChat(event.currentTarget.value)} />
          <Button type="button" variant="default" disabled={locked} leftSection={<Plus size={16} aria-hidden="true" />} onClick={createChat}>
            {t('chat.new')}
          </Button>
        </div>
        {chatId && (
          <div className="chat-mode chat-column">
            <Switch label={t('chat.gmMode')} description={t('chat.gmModeDescription')} checked={gmMode} disabled={locked}
              onChange={(event) => changeGmMode(event.currentTarget.checked)} />
          </div>
        )}
        {(loadError || saveError) && (
          <div className="chat-status chat-column">
            <p role="alert">{t(`error.${loadError ?? saveError!}`)}</p>
            <Button type="button" size="compact-sm" variant="default" disabled={loading} onClick={loadError ? retryLoad : retrySave}>
              {t(loadError || saveError === 'chat_conflict' ? 'common.retryLoad' : 'chat.retrySave')}
            </Button>
          </div>
        )}
      </header>
      {rows.length ? (
        <ChatHistory key={chatId} ref={history} messages={rows} renderMessage={renderMessage} />
      ) : <p className="chat-empty">{loading ? t('chat.loading') : chatId && t('chat.empty')}</p>}
      <ChatComposer />
      <output className="chat-sr-only">{announcement && t(announcement)}</output>

      <Modal opened={Boolean(dialog)} onClose={() => setDialog(undefined)} onExitTransitionEnd={() => {
        if (!focusAfterDelete.current) return;
        focusAfterDelete.current = false;
        if (history.current) history.current.focus();
        else title.current?.focus({ preventScroll: true });
      }}
        title={dialog?.kind === 'delete' ? t('chat.deleteMessage') : t('chat.image')}
        size={dialog?.kind === 'preview' ? 'xl' : 'md'} centered closeButtonProps={{ 'aria-label': t('common.close') }}>
        {dialog?.kind === 'preview' && <div className="chat-preview"><ChatPicture image={dialog.image} /></div>}
        {dialog?.kind === 'delete' && (
          <>
            <p>{t('chat.deleteWarning')}</p>
            <Group justify="flex-end" mt="md">
              <Button type="button" variant="default" data-autofocus onClick={() => setDialog(undefined)}>{t('common.cancel')}</Button>
              <Button type="button" color="red" disabled={locked} onClick={() => removeMessage(dialog.message)}>{t('common.delete')}</Button>
            </Group>
          </>
        )}
      </Modal>
    </section>
  );
}
