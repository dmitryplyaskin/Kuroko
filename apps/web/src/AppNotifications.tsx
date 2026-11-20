import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import './notifications.css';

export default function AppNotifications() {
  return (
    <Notifications className="app-notifications" position="top-right" containerWidth="24rem"
      transitionDuration={140} limit={3} pauseResetOnHover="notification" allowScrollDismiss={false} />
  );
}
