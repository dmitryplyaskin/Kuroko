import { Button, Group, Modal, useComputedColorScheme } from '@mantine/core';
import { createWatch } from 'effector';
import { useProvidedScope, useUnit } from 'effector-react';
import { ArrowDownToLine, ArrowUpToLine } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChatComposer } from './ChatComposer';
import { ChatHistory, type ChatHistoryHandle } from './ChatHistory';
import { ChatMessage, ChatPicture } from './ChatMessage';
import { $activeSession } from '../../platform/session/model';
import { chatDisplayStyle } from './chatDisplayStyle';
import type { ChatImage, Message } from './message';
import {
  $chatAnnouncement, $chatInitialized, $chatRows, $expandedReasoning, $messageEditor, $replyId, $replyPhase,
  chatHidden, chatShown, keepHistoryAtEndRequested, messageDeleteRequested, messageEditCancelled,
  messageEditChanged, messageEditRequested, messageEditSubmitted, messageSent, reasoningToggled,
} from './model';
import { $appliedChatSettings } from './settings/model';
import './chat.css';

type Preview = { kind: 'preview'; image: ChatImage };
type Delete = { kind: 'delete'; message: Message };

const number = new Intl.NumberFormat('ru');
const plural = new Intl.PluralRules('ru');
const messageForms = { one: 'сообщение', few: 'сообщения', many: 'сообщений', other: 'сообщения', zero: 'сообщений', two: 'сообщения' };

export default function Chat() {
  const scheme = useComputedColorScheme('light');
  const [dialog, setDialog] = useState<Preview | Delete>();
  const scope = useProvidedScope();
  const {
    session, settings, initialized, rows, replyId, replyPhase, announcement, editor, expandedReasoning, show, hide, openEditor,
    changeDraft, closeEditor, saveEdit, remove, toggleReasoning,
  } = useUnit({
    session: $activeSession, settings: $appliedChatSettings,
    initialized: $chatInitialized, rows: $chatRows, replyId: $replyId, replyPhase: $replyPhase, announcement: $chatAnnouncement,
    editor: $messageEditor, expandedReasoning: $expandedReasoning, show: chatShown, hide: chatHidden,
    openEditor: messageEditRequested, changeDraft: messageEditChanged, closeEditor: messageEditCancelled,
    saveEdit: messageEditSubmitted, remove: messageDeleteRequested, toggleReasoning: reasoningToggled,
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
    <ChatMessage message={message} username={username} phase={message.id === replyId ? replyPhase ?? undefined : undefined}
      editor={editor?.id === message.id ? editor : undefined}
      reasoningOpen={expandedReasoning.has(message.id)} onToggleReasoning={setReasoningOpen}
      onEdit={openEditor} onDraftChange={updateMessageDraft} onCancelEdit={closeEditor} onSaveEdit={saveEdit}
      onDelete={openDelete} onPreview={openPreview} />
  ), [username, replyId, replyPhase, editor, expandedReasoning, setReasoningOpen, openEditor, updateMessageDraft, closeEditor, saveEdit, openDelete, openPreview]);

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
            <h1 id="chat-title" ref={title} tabIndex={-1}>Тестовый чат</h1>
            <p>Мок-модель <span aria-hidden="true">·</span> {number.format(rows.length)} {messageForms[plural.select(rows.length)]}</p>
          </div>
          <div className="chat-navigation">
            <button type="button" className="icon-button" aria-label="К началу истории" title="К началу истории"
              disabled={!rows.length} onClick={() => history.current?.scrollToStart()}>
              <ArrowUpToLine size={18} aria-hidden="true" />
            </button>
            <button type="button" className="icon-button" aria-label="К концу истории" title="К концу истории"
              disabled={!rows.length} onClick={() => history.current?.scrollToEnd()}>
              <ArrowDownToLine size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>
      {rows.length ? (
        <ChatHistory ref={history} messages={rows} renderMessage={renderMessage} />
      ) : initialized ? <p className="chat-empty">История пуста. Напишите сообщение, чтобы начать диалог.</p> : <output className="chat-loading">Загрузка чата…</output>}
      <ChatComposer />
      <output className="chat-sr-only">{announcement}</output>

      <Modal opened={Boolean(dialog)} onClose={() => setDialog(undefined)} onExitTransitionEnd={() => {
        if (!focusAfterDelete.current) return;
        focusAfterDelete.current = false;
        if (history.current) history.current.focus();
        else title.current?.focus({ preventScroll: true });
      }}
        title={dialog?.kind === 'delete' ? 'Удалить сообщение?' : 'Изображение'}
        size={dialog?.kind === 'preview' ? 'xl' : 'md'} centered closeButtonProps={{ 'aria-label': 'Закрыть' }}>
        {dialog?.kind === 'preview' && <div className="chat-preview"><ChatPicture image={dialog.image} /></div>}
        {dialog?.kind === 'delete' && (
          <>
            <p>Сообщение исчезнет из истории этого чата.</p>
            <Group justify="flex-end" mt="md">
              <Button type="button" variant="default" data-autofocus onClick={() => setDialog(undefined)}>Отмена</Button>
              <Button type="button" color="red" onClick={() => removeMessage(dialog.message)}>Удалить</Button>
            </Group>
          </>
        )}
      </Modal>
    </section>
  );
}
