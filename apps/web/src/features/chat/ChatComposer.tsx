import { Textarea } from '@mantine/core';
import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import { useRef, useState, type SubmitEvent } from 'react';
import type { ChatImage } from './message';

type Props = {
  streaming: boolean;
  onSend: (text: string, image?: ChatImage) => void;
  onStop: () => void;
};

export function ChatComposer({ streaming, onSend, onStop }: Props) {
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File>();
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const canSend = Boolean(draft.trim() || file) && !streaming;

  function attach(next?: File) {
    if (!next) return;
    if (!next.type.startsWith('image/') || next.size > 10 * 1024 * 1024) {
      setError('Выберите изображение размером до 10 МБ.');
      return;
    }
    setError('');
    setFile(next);
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    onSend(draft.trim(), file && { file });
    setDraft('');
    setFile(undefined);
    setError('');
    textarea.current?.focus({ preventScroll: true });
  }

  return (
    <footer className="chat-footer">
      <form className="chat-composer chat-column" onSubmit={submit}>
        <input ref={input} type="file" accept="image/*" hidden onChange={(event) => {
          attach(event.currentTarget.files?.[0]);
          event.currentTarget.value = '';
        }} />
        {file && (
          <div className="chat-attachment">
            <span>{file.name}</span>
            <button type="button" className="icon-button" aria-label="Убрать вложение" onClick={() => {
              setFile(undefined);
              setError('');
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
        {streaming ? (
          <button type="button" className="icon-button chat-send-button" data-stop aria-label="Остановить" title="Остановить"
            onClick={() => {
              onStop();
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
