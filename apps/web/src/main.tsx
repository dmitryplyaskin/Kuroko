import '@mantine/core/styles.css';
import '@fontsource-variable/onest';
import '@fontsource-variable/literata';
import './shared/styles/base.css';
import './shared/styles/mantine.css';
import './shared/styles/controls.css';
import './shared/styles/page.css';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { NotificationAnnouncements } from './shared/notifications/notifications';
import { KurokoThemeProvider } from './shared/theme/theme';

const AppNotifications = lazy(() => import('./shared/notifications/AppNotifications'));

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element missing');
}

createRoot(root).render(
  <StrictMode>
    <KurokoThemeProvider>
      <App />
      <NotificationAnnouncements />
      <Suspense fallback={null}><AppNotifications /></Suspense>
    </KurokoThemeProvider>
  </StrictMode>,
);
