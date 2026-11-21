import { VisuallyHidden } from '@mantine/core';
import { notifications, useNotifications, type NotificationData } from '@mantine/notifications';
import { Check, CircleX, Info, TriangleAlert } from 'lucide-react';
import classes from './notifications.module.css';

const tones = {
  success: { Icon: Check, color: 'var(--kr-accent)' },
  info: { Icon: Info, color: 'var(--kr-accent)' },
  warning: { Icon: TriangleAlert, color: 'var(--kr-notification-warning)' },
  error: { Icon: CircleX, color: 'var(--kr-danger)' },
};

type Notice = {
  tone: keyof typeof tones;
  message: string;
  title?: string;
  id?: string;
  autoClose?: number | false;
};

export function notify({ tone, message, title, id, autoClose }: Notice) {
  const { Icon, color } = tones[tone];
  const duration = autoClose ?? (tone === 'error' ? false : 5000);
  const notificationId: string = notifications.show({
    id, title, message, color,
    autoClose: duration,
    icon: <Icon size={18} aria-hidden="true" />,
    closeButtonProps: { 'aria-label': 'Закрыть уведомление' },
    classNames: {
      root: classes.notification,
      icon: classes.icon,
      title: classes.title,
      description: classes.description,
      closeButton: classes.closeButton,
    },
    'data-tone': tone,
    withBorder: true,
    role: 'group',
    onFocusCapture: (event) => {
      if (duration !== false && !event.currentTarget.contains(event.relatedTarget)) {
        notifications.update({ id: notificationId, message, autoClose: false });
      }
    },
    onBlurCapture: (event) => {
      if (duration !== false && !event.currentTarget.contains(event.relatedTarget)) {
        notifications.update({ id: notificationId, message, autoClose: duration });
      }
    },
  });
  return notificationId;
}

function announcement({ id, title, message }: NotificationData) {
  return <div key={id}>{title && <>{title}. </>}{message}</div>;
}

export function NotificationAnnouncements() {
  const { notifications: visible } = useNotifications();

  return (
    <>
      <VisuallyHidden aria-live="polite" aria-relevant="additions text">
        {visible.filter((notice) => notice['data-tone'] !== 'error').map(announcement)}
      </VisuallyHidden>
      <VisuallyHidden aria-live="assertive" aria-relevant="additions text">
        {visible.filter((notice) => notice['data-tone'] === 'error').map(announcement)}
      </VisuallyHidden>
    </>
  );
}
