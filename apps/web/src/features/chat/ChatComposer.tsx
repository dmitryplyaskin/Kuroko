import { Textarea } from '@mantine/core';
import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import { useUnit } from 'effector-react';
import { useRef, type SubmitEvent } from 'react';
import {
  $chatAttachment, $chatAttachmentError, $chatCanSend, $chatDraft, $replyId, chatAttachmentRemoved,
  chatAttachmentSelected, chatDraftChanged, chatSendRequested, chatStopRequested,
} from './model';

export function ChatComposer() {
  const { draft, file, error, canSend, replyId, setDraft, attach, remove, send, stop } = useUnit({
    draft: $chatDraft, file: $chatAttachment, error: $chatAttachmentError, canSend: $chatCanSend, replyId: $replyId,
    setDraft: chatDraftChanged, attach: chatAttachmentSelected, remove: chatAttachmentRemoved,
    send: chatSendRequested, stop: chatStopRequested,
  });
  const input = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    send();
    textarea.current?.focus({ preventScroll: true });
  }

  return (
    <footer className="chat-footer">
      <form className="chat-composer chat-column" onSubmit={submit}>
        <input ref={input} type="file" accept="image/*" hidden onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) attach(file);
          event.currentTarget.value = '';
        }} />
        {file && (
          <div className="chat-attachment">
            <span>{file.name}</span>
            <button type="button" className="icon-button" aria-label="Убрать вложение" onClick={() => {
              remove();
              textarea.current?.focus({ preventScroll: true });
            }}><X size={16} aria-hidden="true" /></button>
          </div>
        )}
        <button type="button" className="icon-button chat-composer-action" aria-label="Прикрепить изображение"
          title="Прикрепить изображение" onClick={() => input.current?.click()}>
          <Paperclip size={19} aria-hidden="true" />
        </button>
        <Textarea
          ref={textarea}
          aria-label="Сообщение"
          placeholder="Сообщение"
          variant="unstyled"
          classNames={{ input: 'chat-composer-input' }}
          autosize minRows={1} maxRows={6}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        {replyId !== null ? (
          <button type="button" className="icon-button chat-send-button" data-stop aria-label="Остановить" title="Остановить"
            onClick={() => {
              stop();
              textarea.current?.focus({ preventScroll: true });
            }}>
            <Square size={14} aria-hidden="true" />
          </button>
        ) : (
          <button type="submit" className="icon-button chat-send-button" disabled={!canSend} aria-label="Отправить" title="Отправить">
            <ArrowUp size={19} aria-hidden="true" />
          </button>
        )}
        {error && <p className="chat-input-error" role="alert">{error}</p>}
      </form>
    </footer>
  );
}
