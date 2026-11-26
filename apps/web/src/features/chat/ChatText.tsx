import { useI18n } from '../../shared/i18n/i18n';
import { memo, useId } from 'react';
import type { Element, Root } from 'hast';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { rehypeChatSpeech } from './chatSpeech';
import textClasses from './ChatText.module.css';

const markdownPlugins = [remarkGfm];
const htmlPlugins = [rehypeChatSpeech];
const markdownComponents: Components = {
  a: ({ node, href, children, ...props }) => {
    if (href?.startsWith('#') && (node?.properties.dataFootnoteRef || node?.properties.dataFootnoteBackref !== undefined)) {
      return <a {...props} href={href} onClick={(event) => {
        const target = document.getElementById(href.slice(1));
        event.preventDefault();
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'nearest' });
      }}>{children}</a>;
    }
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
  },
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
      <section className={textClasses['chat-table']} tabIndex={0} aria-label={t('chat.table')}>
        <table>{children}</table>
      </section>
    );
  },
};

function scopeFootnotes(prefix: string) {
  return (tree: Root) => {
    function visit(parent: Root | Element) {
      for (const child of parent.children) {
        if (child.type !== 'element') continue;
        const props = child.properties;
        if (props.id === 'footnote-label') props.id = `${prefix}label`;
        if (props.dataFootnoteRef) props.ariaDescribedBy = [`${prefix}label`];
        if (child.tagName === 'li' && typeof props.id === 'string' && props.id.startsWith(prefix)) props.tabIndex = -1;
        visit(child);
      }
    }
    visit(tree);
  };
}

export const ChatText = memo(function ChatText({ children, user = false }: { children: string; user?: boolean }) {
  const { t, number } = useI18n();
  const footnotePrefix = `chat-${useId()}-footnote-`;
  return (
    <div data-chat-markdown={user ? "user" : "assistant"}>
      <Markdown remarkPlugins={markdownPlugins} rehypePlugins={[...htmlPlugins, [scopeFootnotes, footnotePrefix]]} components={markdownComponents} skipHtml={!user}
        remarkRehypeOptions={{
          clobberPrefix: footnotePrefix,
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
