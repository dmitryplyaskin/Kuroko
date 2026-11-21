import { Textarea } from '@mantine/core';
import { ArrowUp, Square } from 'lucide-react';
import { useUnit } from 'effector-react';
import { useRef, type SubmitEvent } from 'react';
import {
  $chatError, $chatCanSend, $chatDraft, $replyId, chatDraftChanged, chatSendRequested, chatStopRequested,
} from './model';

export function ChatComposer() {
  const { draft, error, canSend, replyId, setDraft, send, stop } = useUnit({
    draft: $chatDraft, error: $chatError, canSend: $chatCanSend, replyId: $replyId,
    setDraft: chatDraftChanged, send: chatSendRequested, stop: chatStopRequested,
  });
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
