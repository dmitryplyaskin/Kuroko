import '@mantine/core/styles.css';
import '@fontsource-variable/onest';
import '@fontsource-variable/literata';
import './styles.css';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { NotificationAnnouncements } from './notifications';
import { KurokoThemeProvider } from './theme';

const AppNotifications = lazy(() => import('./AppNotifications'));

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
