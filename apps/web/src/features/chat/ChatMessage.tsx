import { useI18n } from '../../shared/i18n/i18n';
import type { ChatReplyVariants, ChatReplyVariantSelection, ChatToolCall } from '@kuroko/contracts/chat';
import { readSubagentName } from '@kuroko/contracts/tools';
import { Button, Menu } from '@mantine/core';
import { Bot, ChevronLeft, ChevronRight, Copy, Ellipsis, LoaderCircle, Pencil, RotateCw, Trash2 } from 'lucide-react';
import { memo, useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useModuleExtensions } from '../../modules/ModuleExtensions';
import { notify } from '../../shared/notifications/notifications';
import { ChatText } from './ChatText';
import { messageBlocks, type ActiveSubagent, type ChatImage, type Message, type ReplyPhase } from './message';
import type { MessageAction, MessageActionContext } from './messageActions';

export function ChatMessageFrame({ role, author, time, edited, image, actions, heading: Heading = 'h2', children }: {
  role: Message['role']; author: string; time: number; edited?: boolean; image?: boolean;
  actions?: ReactNode; heading?: 'h2' | 'h3'; children: ReactNode;
}) {
  const { locale, t, clock, date } = useI18n();
  const title = useId();
  return (
    <article className="chat-message" data-author={role} data-image={image || undefined} aria-labelledby={title}>
      <span className="icon-tile account-avatar chat-avatar" aria-hidden="true">
        {role === 'assistant' ? <Bot size={19} strokeWidth={1.8} /> : Array.from(author)[0]?.toLocaleUpperCase(locale)}
      </span>
      <div className="chat-message-body">
        <header className="chat-message-header">
          <Heading id={title}><bdi>{author}</bdi></Heading>
          <time dateTime={new Date(time).toISOString()} title={date.format(time)}>{clock.format(time)}</time>
          {edited && <span className="chat-edited">{t('chat.edited')}</span>}
        </header>
        <div className="chat-message-content">{children}</div>
        {actions}
      </div>
    </article>
  );
}

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
      {calls.map((call) => {
        const name = call.name === 'delegate_task' ? readSubagentName(call.arguments.name) : undefined;
        return <li key={call.id}>
          <details className="chat-tool-call">
            <summary>
              <code>{call.name}</code>{name && <> <bdi>{name}</bdi></>}{' '}
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
        </li>;
      })}
    </ul>
  );
}

function ReplyVariants({ variants: { index, total }, locked, select }: {
  variants: ChatReplyVariants; locked?: boolean; select: (index: number) => void;
}) {
  const { t, number } = useI18n();
  const label = { current: number.format(index + 1), total: number.format(total) };
  const previousDisabled = Boolean(locked || index === 0);
  const nextDisabled = Boolean(locked || index === total - 1);
  const previous = t('chat.previousReplyVariant');
  const next = t('chat.nextReplyVariant');
  return (
    <span className="chat-reply-variants">
      <button type="button" className="icon-button" aria-label={previous} title={previous} aria-disabled={previousDisabled}
        onClick={() => { if (!previousDisabled) select(index - 1); }}>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <span aria-hidden="true">{label.current} / {label.total}</span>
      <output className="chat-sr-only">{t('chat.replyVariantPosition', label)}</output>
      <button type="button" className="icon-button" aria-label={next} title={next} aria-disabled={nextDisabled}
        onClick={() => { if (!nextDisabled) select(index + 1); }}>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    </span>
  );
}

type Props = {
  message: Message;
  username: string;
  phase?: ReplyPhase;
  activeSubagents?: readonly ActiveSubagent[];
  locked?: boolean;
  editor?: { texts: readonly string[]; canSave: boolean };
  reasoningOpen: boolean;
  onToggleReasoning: (id: number, open: boolean) => void;
  onEdit: (id: number) => void;
  onDraftChange: (id: number, index: number, value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number) => void;
  onRegenerate?: (id: number) => void;
  variants?: ChatReplyVariants;
  onSelectVariant?: (selection: ChatReplyVariantSelection) => void;
  onDelete: (message: Message) => void;
  onPreview: (image: ChatImage) => void;
};

export const ChatMessage = memo(function ChatMessage({
  message, username, phase, activeSubagents, locked, editor, reasoningOpen, onToggleReasoning,
  onEdit, onDraftChange, onSaveEdit, onCancelEdit, onRegenerate, variants, onSelectVariant, onDelete, onPreview,
}: Props) {
  const { t, number } = useI18n();
  const { id, text, time, image, edited, reasoning } = message;
  const assistant = message.role === 'assistant';
  const author = assistant ? t('common.model') : username;
  const editing = editor !== undefined;
  const actions = useModuleExtensions('chat.message.actions');
  const actionContext: MessageActionContext = { text };
  const visibleActions = actions.filter((action) => action.isVisible?.(actionContext) ?? true);
  const copyAction = visibleActions.find((action) => action.placement === 'copy');
  const menuActions = visibleActions.filter((action) => action !== copyAction);
  const toolbar = useRef<HTMLDivElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const editInput = useRef<HTMLTextAreaElement>(null);
  const editFormId = useId();
  const moveFocus = useRef(false);

  useLayoutEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    if (!editing) {
      (editButton.current?.disabled ? toolbar.current : editButton.current)?.focus({ preventScroll: true });
      return;
    }
    const input = editInput.current;
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(input.value.length, input.value.length);
    input?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [editing]);

  function cancelEdit() {
    moveFocus.current = true;
    onCancelEdit();
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

  const blocks = messageBlocks(message);
  if (editing && !blocks.some((block) => block.kind === 'text')) blocks.push({ kind: 'text', text: '' });
  const content: ReactNode[] = [];
  let textIndex = 0;
  for (const block of blocks) {
    if (block.kind === 'tools') {
      content.push(<ToolCalls key={`calls-${block.calls[0]!.id}`} calls={block.calls} />);
      continue;
    }
    const index = textIndex++;
    const draft = editor?.texts[index];
    if (!block.text.trim() && !editor) continue;
    content.push(
      <div key={`text-${index}`} className="chat-message-text" data-draft={draft}>
        <ChatText user={!assistant}>{block.text}</ChatText>
        {editor && <textarea ref={index === 0 ? editInput : undefined} form={editFormId} rows={1} className="chat-editor-input"
          aria-label={editor.texts.length === 1 ? t('chat.messageText') : t('chat.messageTextPart', { number: number.format(index + 1) })}
          value={draft} onChange={(event) => onDraftChange(id, index, event.currentTarget.value)} onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelEdit();
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }} />}
      </div>
    );
  }
  const copyLabel = t(copyAction?.label ?? 'chat.copy');
  const ellipsis = <Ellipsis size={17} aria-hidden="true" />;

  return (
    <ChatMessageFrame role={message.role} author={author} time={time} edited={edited} image={Boolean(image)}
      actions={editor ? (
        <form id={editFormId} className="chat-editor-actions" onSubmit={(event) => {
          event.preventDefault();
          if (!editor.canSave) return;
          moveFocus.current = true;
          onSaveEdit(id);
        }}>
          <Button type="button" variant="subtle" size="compact-sm" onClick={cancelEdit}>{t('common.cancel')}</Button>
          <Button type="submit" size="compact-sm" disabled={!editor.canSave}>{t('common.save')}</Button>
        </form>
      ) : !phase && (
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- This groups message commands outside the editor form.
        <div ref={toolbar} className="chat-message-actions" role="group" aria-label={t('chat.actions', { author })} tabIndex={-1}>
          <button type="button" className="icon-button" aria-label={copyLabel} title={copyLabel} disabled={!copyAction}
            onClick={copyAction && (() => void runAction(copyAction))}>
            <Copy size={16} aria-hidden="true" />
          </button>
          <button ref={editButton} type="button" className="icon-button" aria-label={t('chat.edit')} title={t('chat.edit')}
            disabled={locked} onClick={() => {
              moveFocus.current = true;
              onEdit(id);
            }}>
            <Pencil size={16} aria-hidden="true" />
          </button>
          {onRegenerate && (
            <button type="button" className="icon-button" aria-label={t('chat.regenerate')} title={t('chat.regenerate')}
              disabled={locked} onClick={() => onRegenerate(id)}>
              <RotateCw size={16} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="icon-button chat-message-delete" aria-label={t('common.delete')} title={t('common.delete')}
            disabled={locked} onClick={() => onDelete(message)}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
          {menuActions.length ? (
            <Menu position="bottom-end" transitionProps={{ duration: 0 }}>
              <Menu.Target>
                <button type="button" className="icon-button" aria-label={t('chat.moreActions')} title={t('chat.moreActions')}>{ellipsis}</button>
              </Menu.Target>
              <Menu.Dropdown>
                {menuActions.map((action) => <Menu.Item key={action.id} onClick={() => void runAction(action)}>{t(action.label)}</Menu.Item>)}
              </Menu.Dropdown>
            </Menu>
          ) : <button type="button" className="icon-button" aria-label={t('chat.moreActions')} title={t('chat.moreActions')} disabled>{ellipsis}</button>}
          {variants && onSelectVariant && <ReplyVariants variants={variants} locked={locked}
            select={(index) => onSelectVariant({ replyId: id, index })} />}
        </div>
      )}>
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
      {blocks.length ? (
        <div className="chat-message-blocks">{content}</div>
      ) : phase === 'answer' && <p className="chat-typing">{t('chat.answering')}</p>}
      {activeSubagents?.map(({ id, name }) => (
        <p key={id} className="chat-tool-call chat-subagent-progress">
          <LoaderCircle size={16} className="chat-subagent-spinner" aria-hidden="true" />
          {name ? t('chat.namedSubagentWorking', { name }) : t('chat.subagentWorking')}
        </p>
      ))}
      {image && (
        <button type="button" className="chat-picture" aria-label={t('chat.openImage')} onClick={() => onPreview(image)}>
          <ChatPicture image={image} />
        </button>
      )}
    </ChatMessageFrame>
  );
});
