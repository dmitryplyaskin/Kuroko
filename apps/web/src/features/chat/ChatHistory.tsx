import { useI18n } from '../../shared/i18n/i18n';
import { observeElementRect, useVirtualizer, type VirtualizerOptions } from '@tanstack/react-virtual';
import { memo, useCallback, useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react';
import type { Message } from './message';

export type ChatHistoryHandle = {
  scrollToStart: () => void;
  scrollToEnd: () => void;
  keepEndInView: () => void;
  focus: () => void;
};

type Props = {
  messages: Message[];
  renderMessage: (message: Message) => ReactNode;
  ref: Ref<ChatHistoryHandle>;
};

const endThreshold = 8;

const observeHistorySize: VirtualizerOptions<HTMLElement, HTMLDivElement>['observeElementRect'] = (list, onRect) => {
  let previousHeight = 0;
  return observeElementRect(list, (rect) => {
    const element = list.scrollElement;
    // Check the old viewport height before the composer takes space away from the history.
    const wasAtEnd = element && rect.height > 0 && rect.height < previousHeight &&
      element.scrollHeight - element.scrollTop - previousHeight <= endThreshold;
    previousHeight = rect.height;
    onRect(rect);
    if (wasAtEnd) list.scrollToEnd();
  });
};

export const ChatHistory = memo(function ChatHistory({ messages, renderMessage, ref }: Props) {
  const { t } = useI18n();
  const viewport = useRef<HTMLElement>(null);
  const opened = useRef(false);
  const keepEndInView = useRef(false);
  const getItemKey = useCallback((index: number) => messages[index]!.id, [messages]);
  const list = useVirtualizer({
    count: messages.length,
    getScrollElement: () => viewport.current,
    getItemKey,
    estimateSize: (index) => {
      const message = messages[index]!;
      return 85 + 24 * Math.floor(message.text.length / 90) + (message.image ? 255 : 0) + (message.reasoning !== undefined ? 44 : 0);
    },
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: endThreshold,
    observeElementRect: observeHistorySize,
    overscan: 6,
    directDomUpdates: true,
  });

  useLayoutEffect(() => {
    if (opened.current) return;
    list.scrollToEnd();
    const frame = requestAnimationFrame(() => { opened.current = true; });
    return () => cancelAnimationFrame(frame);
  }, [list]);

  useLayoutEffect(() => {
    if (!keepEndInView.current) return;
    keepEndInView.current = false;
    list.scrollToEnd();
  }, [list, messages]);

  useImperativeHandle(ref, () => ({
    scrollToStart: () => list.scrollToOffset(0),
    scrollToEnd: () => list.scrollToEnd(),
    keepEndInView: () => { keepEndInView.current = list.isAtEnd(); },
    focus: () => viewport.current?.focus({ preventScroll: true }),
  }), [list]);

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- The message history scrolls independently via keyboard.
    <section ref={viewport} className="chat-history" aria-label={t('chat.history')} tabIndex={0}>
      <div ref={list.containerRef} className="chat-timeline">
        {list.getVirtualItems().map((item) => (
          <div key={item.key} ref={list.measureElement} className="chat-virtual-row" data-index={item.index}>
            {renderMessage(messages[item.index]!)}
          </div>
        ))}
      </div>
    </section>
  );
});
