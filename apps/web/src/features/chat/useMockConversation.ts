import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatImage, Message, ReplyPhase } from './message';
import { createMockHistory, getMockReply } from './mock';

type Reply = { message: Message & { reasoning: string }; phase: ReplyPhase; visible: number };

function partialReply({ message, phase, visible }: Reply): Message {
  return {
    ...message,
    reasoning: phase === 'reasoning' ? message.reasoning.slice(0, visible) : message.reasoning,
    text: phase === 'answer' ? message.text.slice(0, visible) : '',
    image: undefined,
  };
}

export function useMockConversation(keepEndInView: () => void) {
  const [messages, setMessages] = useState(createMockHistory);
  const [reply, setReply] = useState<Reply>();
  const [announcement, setAnnouncement] = useState('');
  const nextId = useRef((messages.at(-1)?.id ?? 0) + 1);
  const rows = useMemo(() => reply ? [...messages, partialReply(reply)] : messages, [messages, reply]);

  useEffect(() => {
    if (!reply) return;
    const timer = window.setTimeout(() => {
      keepEndInView();
      const thinking = reply.phase === 'reasoning';
      const visible = reply.visible + (thinking ? 24 : 18);
      const content = thinking ? reply.message.reasoning : reply.message.text;
      if (visible < content.length) {
        setReply({ ...reply, visible });
      } else if (thinking) {
        setReply({ ...reply, phase: 'answer', visible: 0 });
        setAnnouncement('Модель отвечает.');
      } else {
        setMessages((current) => [...current, reply.message]);
        setReply(undefined);
        setAnnouncement('Ответ модели готов.');
      }
    }, reply.phase === 'reasoning' && reply.visible === 0 ? 350 : 75);
    return () => window.clearTimeout(timer);
  }, [reply, keepEndInView]);

  function send(text: string, image?: ChatImage) {
    if (reply) return false;
    const message: Message = { id: nextId.current++, role: 'user', text, image, time: Date.now() };
    const answer = { ...getMockReply(message), id: nextId.current++, role: 'assistant' as const, time: Date.now() };
    setMessages((current) => [...current, message]);
    setReply({ message: answer, phase: 'reasoning', visible: 0 });
    setAnnouncement('Модель рассуждает.');
    return true;
  }

  function stop() {
    if (!reply) return;
    keepEndInView();
    const partial = partialReply(reply);
    const discarded = !partial.text && !partial.reasoning;
    if (!discarded) setMessages((current) => [...current, partial]);
    setReply(undefined);
    setAnnouncement('Ответ модели остановлен.');
    if (discarded) return partial.id;
  }

  const edit = useCallback((id: number, text: string) => {
    keepEndInView();
    setMessages((current) => current.map((item) => item.id === id ? { ...item, text, edited: true } : item));
    setAnnouncement('Сообщение изменено.');
  }, [keepEndInView]);

  function remove(id: number) {
    setMessages((current) => current.filter((item) => item.id !== id));
    setAnnouncement('Сообщение удалено.');
  }

  return { rows, replyId: reply?.message.id, replyPhase: reply?.phase, announcement, send, stop, edit, remove };
}
