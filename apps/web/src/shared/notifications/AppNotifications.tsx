import { MantineThemeProvider, Notification } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useMemo } from 'react';
import { useI18n } from '../i18n/i18n';
import '@mantine/notifications/styles.css';
import classes from './notifications.module.css';

export default function AppNotifications() {
  const { t } = useI18n();
  const theme = useMemo(() => ({
    components: { Notification: Notification.extend({ defaultProps: { closeButtonProps: { 'aria-label': t('notifications.close') } } }) },
  }), [t]);

  return (
    <MantineThemeProvider theme={theme}>
      <Notifications className={classes.container} position="top-right" containerWidth="24rem"
        transitionDuration={140} limit={3} pauseResetOnHover="notification" allowScrollDismiss={false} />
    </MantineThemeProvider>
  );
}
