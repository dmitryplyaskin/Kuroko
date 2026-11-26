import { useI18n } from '../../shared/i18n/i18n';
import { Button, Textarea } from '@mantine/core';
import { ArrowUp, Square } from 'lucide-react';
import { useUnit } from 'effector-react';
import { useRef, type ReactNode, type SubmitEvent } from 'react';
import { $toolSettingsLoadFailed, toolSettingsRetried } from '../tools/model';
import {
  $chatError, $chatCanSend, $chatDraft, $replyId,
  chatDraftChanged, chatSendRequested, chatStopRequested,
} from './model';
import chatClasses from './Chat.module.css';

export function ChatComposer({ menu }: { menu: ReactNode }) {
  const { t } = useI18n();
  const { draft, error, canSend, replyId, toolsLoadFailed, retryTools, setDraft, send, stop } = useUnit({
    draft: $chatDraft, error: $chatError, canSend: $chatCanSend, replyId: $replyId,
    toolsLoadFailed: $toolSettingsLoadFailed, retryTools: toolSettingsRetried,
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
    <footer className={chatClasses['chat-footer']}>
      <div className={[chatClasses['chat-composer'], chatClasses['chat-column']].join(' ')}>
        {menu}
        <form className={chatClasses['chat-composer-box']} onSubmit={submit}>
          <Textarea
            ref={textarea}
            aria-label={t('chat.message')}
            placeholder={t('chat.message')}
            variant="unstyled"
            classNames={{ input: chatClasses['chat-composer-input'] }}
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
            <button type="button" className={['icon-button', chatClasses['chat-send-button']].join(' ')} data-stop aria-label={t('chat.stop')} title={t('chat.stop')}
              onClick={() => {
                stop();
                textarea.current?.focus({ preventScroll: true });
              }}>
              <Square size={14} aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className={['icon-button', chatClasses['chat-send-button']].join(' ')} disabled={!canSend} aria-label={t('chat.send')} title={t('chat.send')}>
              <ArrowUp size={19} aria-hidden="true" />
            </button>
          )}
        </form>
        {toolsLoadFailed && <div className={chatClasses['chat-status']}>
          <p role="alert">{t('chat.toolsLoadFailed')}</p>
          <Button type="button" size="compact-sm" variant="default" onClick={retryTools}>{t('common.retryLoad')}</Button>
        </div>}
        {error && <p className={chatClasses['chat-input-error']} role="alert">{t(`error.${error}`)}</p>}
      </div>
    </footer>
  );
}
