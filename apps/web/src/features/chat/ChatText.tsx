import { useI18n } from '../../shared/i18n/i18n';
import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { rehypeChatSpeech } from './chatSpeech';
import './chatText.css';

const markdownPlugins = [remarkGfm];
const htmlPlugins = [rehypeChatSpeech];
const markdownComponents: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
  img: ({ src, alt, title }) => <img src={src} alt={alt ?? ''} title={title} loading="lazy" decoding="async" referrerPolicy="no-referrer" />,
  pre: function CodeBlock({ children }) {
    const { t } = useI18n();
    return (
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Make overflowing code keyboard-scrollable.
      <pre tabIndex={0} aria-label={t('chat.codeBlock')}>{children}</pre>
    );
  },
  table: function ChatTable({ children }) {
    const { t } = useI18n();
    return (
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Make overflowing tables keyboard-scrollable.
      <section className="chat-table" tabIndex={0} aria-label={t('chat.table')}>
        <table>{children}</table>
      </section>
    );
  },
};

export const ChatText = memo(function ChatText({ children, user = false }: { children: string; user?: boolean }) {
  const { t, number } = useI18n();
  return (
    <div className={user ? 'chat-markdown chat-user-text' : 'chat-markdown'}>
      <Markdown remarkPlugins={markdownPlugins} rehypePlugins={htmlPlugins} components={markdownComponents} skipHtml={!user}
        remarkRehypeOptions={{
          footnoteLabel: t('chat.footnotes'),
          footnoteBackLabel: (reference, occurrence) => t(occurrence > 1 ? 'chat.footnoteBackRepeated' : 'chat.footnoteBack', {
            reference: number.format(reference + 1), occurrence: number.format(occurrence),
          }),
        }}>
        {children}
      </Markdown>
    </div>
  );
});
