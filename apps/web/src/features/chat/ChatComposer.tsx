import { useI18n } from '../../shared/i18n/i18n';
import { Textarea } from '@mantine/core';
import { ArrowUp, Square } from 'lucide-react';
import { useUnit } from 'effector-react';
import { useRef, type ReactNode, type SubmitEvent } from 'react';
import {
  $chatError, $chatCanSend, $chatDraft, $chatNoToolsCalled, $replyId,
  chatDraftChanged, chatSendRequested, chatStopRequested,
} from './model';

export function ChatComposer({ menu }: { menu: ReactNode }) {
  const { t } = useI18n();
  const { draft, error, canSend, replyId, noToolsCalled, setDraft, send, stop } = useUnit({
    draft: $chatDraft, error: $chatError, canSend: $chatCanSend, replyId: $replyId,
    noToolsCalled: $chatNoToolsCalled,
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
      <div className="chat-composer chat-column">
        {menu}
        <form className="chat-composer-box" onSubmit={submit}>
          <Textarea
            ref={textarea}
            aria-label={t('chat.message')}
            placeholder={t('chat.message')}
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
            <button type="button" className="icon-button chat-send-button" data-stop aria-label={t('chat.stop')} title={t('chat.stop')}
              onClick={() => {
                stop();
                textarea.current?.focus({ preventScroll: true });
              }}>
              <Square size={14} aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className="icon-button chat-send-button" disabled={!canSend} aria-label={t('chat.send')} title={t('chat.send')}>
              <ArrowUp size={19} aria-hidden="true" />
            </button>
          )}
        </form>
        {error && <p className="chat-input-error" role="alert">{t(`error.${error}`)}</p>}
      </div>
      <div className="chat-tool-feedback chat-column">
        <output>{noToolsCalled && t('chat.noToolsCalled')}</output>
      </div>
    </footer>
  );
}
