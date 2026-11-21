import { useI18n } from '../../shared/i18n/i18n';
import type { ChatToolCall } from '@kuroko/contracts/chat';
import { Button, Menu, Textarea } from '@mantine/core';
import { Bot, ChevronRight, Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useModuleExtensions } from '../../modules/ModuleExtensions';
import { notify } from '../../shared/notifications/notifications';
import { ChatText } from './ChatText';
import { messageBlocks, type ChatImage, type Message, type ReplyPhase } from './message';
import type { MessageAction, MessageActionContext } from './messageActions';

export function ChatPicture({ image }: { image: ChatImage }) {
  const { t } = useI18n();
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

  if (failed) return <span className="chat-image-error">{t('error.image_load_failed')}</span>;
  if ('file' in image) {
    return <img ref={setFileSource} alt={image.file.name} className="chat-file-image" loading="lazy" decoding="async" onError={() => setFailed(true)} />;
  }
  return <img src={image.src} alt={image.alt} width={image.width} height={image.height} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

function ToolCalls({ calls }: { calls: ChatToolCall[] }) {
  const { t } = useI18n();
  return (
    <ul className="chat-tool-calls" aria-label={t('chat.toolCalls')}>
      {calls.map((call) => (
        <li key={call.id}>
          <details className="chat-tool-call">
            <summary>
              <code>{call.name}</code>{' '}
              <span className="chat-tool-status" data-error={call.isError || undefined}>
                {t(call.isError ? 'chat.toolFailed' : 'chat.toolSucceeded')}
              </span>
            </summary>
            <dl>
              <dt>{t('chat.toolArguments')}</dt>
              <dd><pre>{JSON.stringify(call.arguments, null, 2)}</pre></dd>
              <dt>{t('chat.toolResult')}</dt>
              <dd><pre>{JSON.stringify(call.result, null, 2)}</pre></dd>
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}

type Props = {
  message: Message;
  username: string;
  phase?: ReplyPhase;
  locked?: boolean;
  editor?: { text: string; canSave: boolean };
  reasoningOpen: boolean;
  onToggleReasoning: (id: number, open: boolean) => void;
  onEdit: (id: number) => void;
  onDraftChange: (id: number, value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number) => void;
  onDelete: (message: Message) => void;
  onPreview: (image: ChatImage) => void;
};

export const ChatMessage = memo(function ChatMessage({
  message, username, phase, locked, editor, reasoningOpen, onToggleReasoning,
  onEdit, onDraftChange, onSaveEdit, onCancelEdit, onDelete, onPreview,
}: Props) {
  const { locale, t, clock, date } = useI18n();
  const { id, text, time, image, edited, reasoning, toolCalls } = message;
  const assistant = message.role === 'assistant';
  const author = assistant ? t('common.model') : username;
  const editing = editor !== undefined;
  const actions = useModuleExtensions('chat.message.actions');
  const actionContext: MessageActionContext = { text };
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

  async function runAction(action: MessageAction) {
    try {
      await action.run(actionContext);
    } catch {
      notify({ tone: 'error', title: action.label, message: 'error.message_action_failed' });
    }
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
        {assistant ? <Bot size={19} strokeWidth={1.8} /> : Array.from(username)[0]?.toLocaleUpperCase(locale)}
      </span>
      <div className="chat-message-body">
        <header className="chat-message-header">
          <h2 id={`chat-author-${message.id}`}>{author}</h2>
          <time dateTime={new Date(time).toISOString()} title={date.format(time)}>{clock.format(time)}</time>
          {edited && <span className="chat-edited">{t('chat.edited')}</span>}
          {!phase && (
            <Menu position="bottom-end" returnFocus={!editing} transitionProps={{ duration: 0 }}>
              <Menu.Target>
                <button ref={menuButton} type="button" className="icon-button chat-message-menu" aria-label={t('chat.actions', { author })}>
                  <Ellipsis size={19} aria-hidden="true" />
                </button>
              </Menu.Target>
              <Menu.Dropdown>
                {!editing && (
                  <Menu.Item disabled={locked} leftSection={<Pencil size={15} aria-hidden="true" />} onClick={() => {
                    focusEditor.current = true;
                    onEdit(id);
                  }}>{t('chat.edit')}</Menu.Item>
                )}
                {!editing && actions.map((action) => (action.isVisible?.(actionContext) ?? true) && (
                  <Menu.Item key={action.id} onClick={() => void runAction(action)}>{t(action.label)}</Menu.Item>
                ))}
                <Menu.Item disabled={locked} color="var(--kr-danger)" leftSection={<Trash2 size={15} aria-hidden="true" />} onClick={() => onDelete(message)}>{t('common.delete')}</Menu.Item>
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
                {phase === 'reasoning' ? t('chat.reasoningPending') : t('chat.reasoning')}
              </button>
              <div id={`chat-reasoning-${id}`} className="chat-reasoning-body" hidden={!reasoningOpen}>
                {reasoningOpen && reasoning && <ChatText>{reasoning}</ChatText>}
              </div>
            </div>
          )}
          {editing ? (
            <form className="chat-message-editor" onSubmit={(event) => {
              event.preventDefault();
              if (!editor?.canSave) return;
              onSaveEdit(id);
              menuButton.current?.focus({ preventScroll: true });
            }}>
              <Textarea ref={editInput} aria-label={t('chat.messageText')} placeholder={t('chat.messageText')} variant="unstyled"
                classNames={{ input: 'chat-editor-input' }} autosize minRows={1} maxRows={8}
                value={editor?.text} onChange={(event) => onDraftChange(message.id, event.currentTarget.value)} onKeyDown={(event) => {
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
                <Button type="button" variant="subtle" size="compact-sm" onClick={cancelEdit}>{t('common.cancel')}</Button>
                <Button type="submit" size="compact-sm" disabled={!editor?.canSave}>{t('common.save')}</Button>
              </div>
            </form>
          ) : toolCalls?.length ? (
            <div className="chat-message-blocks">
              {messageBlocks(message).map((block, index) => block.kind === 'tools'
                ? <ToolCalls key={`calls-${block.calls[0]!.id}`} calls={block.calls} />
                : block.text.trim() && <ChatText key={`text-${index}`}>{block.text}</ChatText>)}
            </div>
          ) : text ? <ChatText user={!assistant}>{text}</ChatText> : phase === 'answer' && <p className="chat-typing">{t('chat.answering')}</p>}
          {editing && !!toolCalls?.length && <ToolCalls calls={toolCalls} />}
          {image && (
            <button type="button" className="chat-picture" aria-label={t('chat.openImage')} onClick={() => onPreview(image)}>
              <ChatPicture image={image} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
});
