import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
import classes from './notifications.module.css';

export default function AppNotifications() {
  return (
    <Notifications className={classes.container} position="top-right" containerWidth="24rem"
      transitionDuration={140} limit={3} pauseResetOnHover="notification" allowScrollDismiss={false} />
  );
}
