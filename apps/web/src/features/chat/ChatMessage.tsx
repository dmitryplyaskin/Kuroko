import { Button, Menu, Textarea } from '@mantine/core';
import { Bot, ChevronRight, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { ChatText } from './ChatText';
import type { ChatImage, Message, ReplyPhase } from './message';

const clock = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat('ru', { dateStyle: 'long', timeStyle: 'short' });

export function ChatPicture({ image }: { image: ChatImage }) {
  const file = 'file' in image ? image.file : undefined;
  const [failed, setFailed] = useState(false);
  const setFileSource = useCallback((element: HTMLImageElement | null) => {
    if (!file || !element) return;
    const url = URL.createObjectURL(file);
    element.src = url;
    return () => {
      element.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [file]);

  if (failed) return <span className="chat-image-error">Не удалось открыть изображение.</span>;
  if ('file' in image) {
    return <img ref={setFileSource} alt={image.file.name} className="chat-file-image" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  }
  return <img src={image.src} alt={image.alt} width={image.width} height={image.height} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

type Props = {
  message: Message;
  username: string;
  phase?: ReplyPhase;
  draft?: string;
  reasoningOpen: boolean;
  onToggleReasoning: (id: number, open: boolean) => void;
  onEdit: (message: Message) => void;
  onDraftChange: (id: number, value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number, text: string) => void;
  onDelete: (message: Message) => void;
  onPreview: (image: ChatImage) => void;
};

export const ChatMessage = memo(function ChatMessage({
  message, username, phase, draft, reasoningOpen, onToggleReasoning,
  onEdit, onDraftChange, onSaveEdit, onCancelEdit, onDelete, onPreview,
}: Props) {
  const { id, text, time, image, edited, reasoning } = message;
  const assistant = message.role === 'assistant';
  const author = assistant ? 'Мок-модель' : username;
  const editing = draft !== undefined;
  const editedText = draft?.trim() ?? '';
  const canSave = Boolean(editedText || image) && editedText !== text;
  const menuButton = useRef<HTMLButtonElement>(null);
  const editInput = useRef<HTMLTextAreaElement>(null);
  const focusEditor = useRef(false);

  useLayoutEffect(() => {
    if (!editing || !focusEditor.current) return;
    focusEditor.current = false;
    const input = editInput.current;
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(input.value.length, input.value.length);
    input?.form?.scrollIntoView({ block: 'nearest' });
  }, [editing]);

  function cancelEdit() {
    onCancelEdit();
    menuButton.current?.focus({ preventScroll: true });
  }

  function toggleReasoning(button: HTMLButtonElement) {
    onToggleReasoning(id, !reasoningOpen);
    if (reasoningOpen) return;
    requestAnimationFrame(() => {
      // Let the virtualizer apply the expanded row height before revealing its toggle.
      requestAnimationFrame(() => {
        if (button.isConnected && button.getAttribute('aria-expanded') === 'true') {
          button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      });
    });
  }

  return (
    <article className="chat-message" data-author={message.role} data-editing={editing || undefined} data-image={Boolean(image) || undefined}
      aria-labelledby={`chat-author-${message.id}`}>
      <span className="icon-tile account-avatar chat-avatar" aria-hidden="true">
        {assistant ? <Bot size={19} strokeWidth={1.8} /> : Array.from(username)[0]?.toLocaleUpperCase('ru')}
      </span>
      <div className="chat-message-body">
        <header className="chat-message-header">
          <h2 id={`chat-author-${message.id}`}>{author}</h2>
          <time dateTime={new Date(time).toISOString()} title={date.format(time)}>{clock.format(time)}</time>
          {edited && <span className="chat-edited">Изменено</span>}
          {!phase && (
            <Menu position="bottom-end" returnFocus={!editing} transitionProps={{ duration: 0 }}>
              <Menu.Target>
                <button ref={menuButton} type="button" className="icon-button chat-message-menu" aria-label={`Действия с сообщением · ${author}`}>
                  <Ellipsis size={19} aria-hidden="true" />
                </button>
              </Menu.Target>
              <Menu.Dropdown>
                {!editing && (
                  <Menu.Item leftSection={<Pencil size={15} aria-hidden="true" />} onClick={() => {
                    focusEditor.current = true;
                    onEdit(message);
                  }}>Редактировать</Menu.Item>
                )}
                <Menu.Item color="var(--kr-danger)" leftSection={<Trash2 size={15} aria-hidden="true" />} onClick={() => onDelete(message)}>Удалить</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </header>
        <div className="chat-message-content">
          {assistant && reasoning !== undefined && (
            <div className="chat-reasoning">
              <button type="button" className="chat-reasoning-toggle" aria-expanded={reasoningOpen}
                aria-controls={`chat-reasoning-${id}`} onClick={(event) => toggleReasoning(event.currentTarget)}>
                <ChevronRight size={16} aria-hidden="true" />
                {phase === 'reasoning' ? 'Модель рассуждает…' : 'Ход рассуждений'}
              </button>
              <div id={`chat-reasoning-${id}`} className="chat-reasoning-body" hidden={!reasoningOpen}>
                {reasoningOpen && reasoning && <ChatText>{reasoning}</ChatText>}
              </div>
            </div>
          )}
          {editing ? (
            <form className="chat-message-editor" onSubmit={(event) => {
              event.preventDefault();
              if (!canSave) return;
              onSaveEdit(message.id, editedText);
              menuButton.current?.focus({ preventScroll: true });
            }}>
              <Textarea ref={editInput} aria-label="Текст сообщения" placeholder="Текст сообщения" variant="unstyled"
                classNames={{ input: 'chat-editor-input' }} autosize minRows={1} maxRows={8}
                value={draft} onChange={(event) => onDraftChange(message.id, event.currentTarget.value)} onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelEdit();
                  } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }} />
              <div className="chat-editor-actions">
                <Button type="button" variant="subtle" size="compact-sm" onClick={cancelEdit}>Отмена</Button>
                <Button type="submit" size="compact-sm" disabled={!canSave}>Сохранить</Button>
              </div>
            </form>
          ) : text ? <ChatText user={!assistant}>{text}</ChatText> : phase === 'answer' && <p className="chat-typing">Модель отвечает…</p>}
          {image && (
            <button type="button" className="chat-picture" aria-label="Открыть изображение" onClick={() => onPreview(image)}>
              <ChatPicture image={image} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
});
