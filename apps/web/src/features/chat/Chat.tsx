import { Button, Group, Modal, useComputedColorScheme } from '@mantine/core';
import { ArrowDownToLine, ArrowUpToLine } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChatComposer } from './ChatComposer';
import { ChatHistory, type ChatHistoryHandle } from './ChatHistory';
import { ChatMessage, ChatPicture } from './ChatMessage';
import type { ChatSettings } from '@kuroko/contracts/chatSettings';
import { chatDisplayStyle } from './chatDisplayStyle';
import type { ChatImage, Message } from './message';
import { useMockConversation } from './useMockConversation';
import './chat.css';

type Preview = { kind: 'preview'; image: ChatImage };
type Edit = { id: number; text: string };
type Delete = { kind: 'delete'; message: Message };

const number = new Intl.NumberFormat('ru');
const plural = new Intl.PluralRules('ru');
const messageForms = { one: 'сообщение', few: 'сообщения', many: 'сообщений', other: 'сообщения', zero: 'сообщений', two: 'сообщения' };

export default function Chat({ username, active, settings }: { username: string; active: boolean; settings: ChatSettings }) {
  const scheme = useComputedColorScheme('light');
  const [dialog, setDialog] = useState<Preview | Delete>();
  const [editor, setEditor] = useState<Edit>();
  const [expandedReasoning, setExpandedReasoning] = useState(() => new Set<number>());
  const title = useRef<HTMLHeadingElement>(null);
  const history = useRef<ChatHistoryHandle>(null);
  const jumpOnSend = useRef(false);
  const focusAfterDelete = useRef(false);

  const keepEndInView = useCallback(() => history.current?.keepEndInView(), []);
  const { rows, replyId, replyPhase, announcement, send, stop, edit, remove } = useMockConversation(keepEndInView);

  const openEditor = useCallback((message: Message) => {
    setEditor((current) => current?.id === message.id ? current : { id: message.id, text: message.text });
  }, []);
  const changeDraft = useCallback((id: number, text: string) => {
    setEditor((current) => current?.id === id ? { id, text } : current);
  }, []);
  const closeEditor = useCallback(() => setEditor(undefined), []);
  const saveEdit = useCallback((id: number, text: string) => {
    edit(id, text);
    setEditor(undefined);
  }, [edit]);
  const openDelete = useCallback((message: Message) => setDialog({ kind: 'delete', message }), []);
  const openPreview = useCallback((image: ChatImage) => setDialog({ kind: 'preview', image }), []);
  const setReasoningOpen = useCallback((id: number, open: boolean) => {
    setExpandedReasoning((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const renderMessage = useCallback((message: Message) => (
    <ChatMessage message={message} username={username} phase={message.id === replyId ? replyPhase : undefined}
      draft={editor?.id === message.id ? editor.text : undefined}
      reasoningOpen={expandedReasoning.has(message.id)} onToggleReasoning={setReasoningOpen}
      onEdit={openEditor} onDraftChange={changeDraft} onCancelEdit={closeEditor} onSaveEdit={saveEdit}
      onDelete={openDelete} onPreview={openPreview} />
  ), [username, replyId, replyPhase, editor, expandedReasoning, setReasoningOpen, openEditor, changeDraft, closeEditor, saveEdit, openDelete, openPreview]);

  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (!jumpOnSend.current) return;
    jumpOnSend.current = false;
    history.current?.scrollToEnd();
  }, [replyId]);

  function sendMessage(text: string, image?: ChatImage) {
    if (send(text, image)) jumpOnSend.current = true;
  }

  function stopReply() {
    const discardedId = stop();
    if (discardedId !== undefined) setReasoningOpen(discardedId, false);
  }

  function removeMessage(message: Message) {
    focusAfterDelete.current = true;
    remove(message.id);
    setReasoningOpen(message.id, false);
    if (editor?.id === message.id) closeEditor();
    setDialog(undefined);
  }

  return (
    <section className="chat-panel" hidden={!active} aria-labelledby="chat-title" data-user-side={settings.userSide}
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
      ) : <p className="chat-empty">История пуста. Напишите сообщение, чтобы начать диалог.</p>}
      <ChatComposer streaming={replyId !== undefined} onSend={sendMessage} onStop={stopReply} />
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
