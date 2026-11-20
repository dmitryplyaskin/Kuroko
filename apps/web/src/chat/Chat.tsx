import { Button, Group, Modal } from '@mantine/core';
import { ArrowDownToLine, ArrowUpToLine } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChatComposer } from './ChatComposer';
import { ChatHistory, type ChatHistoryHandle } from './ChatHistory';
import { ChatMessage, ChatPicture, type ReplyPhase } from './ChatMessage';
import { createMockHistory, getMockReply, historySize, type ChatImage, type Message } from './mock';
import './chat.css';

type Preview = { kind: 'preview'; image: ChatImage };
type Edit = { id: number; text: string };
type Delete = { kind: 'delete'; message: Message };
type Reply = { message: Message & { reasoning: string }; phase: ReplyPhase; visible: number };

const number = new Intl.NumberFormat('ru');
const plural = new Intl.PluralRules('ru');
const messageForms = { one: 'сообщение', few: 'сообщения', many: 'сообщений', other: 'сообщения', zero: 'сообщений', two: 'сообщения' };

function partialReply({ message, phase, visible }: Reply): Message {
  return {
    ...message,
    reasoning: phase === 'reasoning' ? message.reasoning.slice(0, visible) : message.reasoning,
    text: phase === 'answer' ? message.text.slice(0, visible) : '',
    image: undefined,
  };
}

export default function Chat({ username, active }: { username: string; active: boolean }) {
  const [messages, setMessages] = useState(createMockHistory);
  const [reply, setReply] = useState<Reply>();
  const [dialog, setDialog] = useState<Preview | Delete>();
  const [editor, setEditor] = useState<Edit>();
  const [expandedReasoning, setExpandedReasoning] = useState(() => new Set<number>());
  const [announcement, setAnnouncement] = useState('');
  const nextId = useRef(historySize + 1);
  const title = useRef<HTMLHeadingElement>(null);
  const history = useRef<ChatHistoryHandle>(null);
  const jumpOnSend = useRef(false);
  const focusAfterDelete = useRef(false);

  const rows = useMemo(() => reply ? [...messages, partialReply(reply)] : messages, [messages, reply]);
  const replyId = reply?.message.id;
  const replyPhase = reply?.phase;

  const openEditor = useCallback((message: Message) => {
    setEditor((current) => current?.id === message.id ? current : { id: message.id, text: message.text });
  }, []);
  const changeDraft = useCallback((id: number, text: string) => {
    setEditor((current) => current?.id === id ? { id, text } : current);
  }, []);
  const closeEditor = useCallback(() => setEditor(undefined), []);
  const saveEdit = useCallback((id: number, text: string) => {
    history.current?.keepEndInView();
    setMessages((current) => current.map((item) => item.id === id ? { ...item, text, edited: true } : item));
    setEditor(undefined);
    setAnnouncement('Сообщение изменено.');
  }, []);
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

  useEffect(() => {
    if (!reply) return;
    const timer = window.setTimeout(() => {
      history.current?.keepEndInView();
      const thinking = reply.phase === 'reasoning';
      const visible = reply.visible + (thinking ? 24 : 18);
      const content = thinking ? reply.message.reasoning : reply.message.text;
      if (visible < content.length) {
        setReply({ ...reply, visible });
      } else if (thinking) {
        setReply({ ...reply, phase: 'answer', visible: 0 });
        setAnnouncement('Модель отвечает.');
      } else {
        setMessages((current) => [...current, reply.message]);
        setReply(undefined);
        setAnnouncement('Ответ модели готов.');
      }
    }, reply.phase === 'reasoning' && reply.visible === 0 ? 350 : 75);
    return () => window.clearTimeout(timer);
  }, [reply]);

  function send(text: string, image?: ChatImage) {
    if (reply) return;
    const message: Message = { id: nextId.current++, role: 'user', text, image, time: Date.now() };
    setMessages((current) => [...current, message]);
    jumpOnSend.current = true;
    setReply({ message: { ...getMockReply(message), id: nextId.current++, role: 'assistant', time: Date.now() }, phase: 'reasoning', visible: 0 });
    setAnnouncement('Модель рассуждает.');
  }

  function stop() {
    if (!reply) return;
    history.current?.keepEndInView();
    const partial = partialReply(reply);
    if (partial.text || partial.reasoning) {
      setMessages((current) => [...current, partial]);
    } else {
      setReasoningOpen(partial.id, false);
    }
    setReply(undefined);
    setAnnouncement('Ответ модели остановлен.');
  }

  function remove(message: Message) {
    focusAfterDelete.current = true;
    setMessages((current) => current.filter((item) => item.id !== message.id));
    setReasoningOpen(message.id, false);
    if (editor?.id === message.id) closeEditor();
    setDialog(undefined);
    setAnnouncement('Сообщение удалено.');
  }

  return (
    <section className="chat-panel" hidden={!active} aria-labelledby="chat-title">
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
      <ChatComposer streaming={Boolean(reply)} onSend={send} onStop={stop} />
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
              <Button type="button" color="red" onClick={() => remove(dialog.message)}>Удалить</Button>
            </Group>
          </>
        )}
      </Modal>
    </section>
  );
}
