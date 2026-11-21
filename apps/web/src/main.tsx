import '@mantine/core/styles.css';
import '@fontsource-variable/onest';
import '@fontsource-variable/literata';
import './shared/styles/base.css';
import './shared/styles/controls.css';
import './shared/styles/page.css';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { fork, scopeBind } from 'effector';
import { Provider } from 'effector-react';
import { corePlugin } from './core';
import { createModuleRegistry } from './modules/registry';
import { startApplication } from './app/startApplication';
import { createWorkspaceModel } from './app/workspaceModel';
import { browserStorageChanged } from './shared/browser/preferences';
import { App } from './app/App';
import { NotificationAnnouncements } from './shared/notifications/notifications';
import { KurokoThemeProvider } from './shared/theme/theme';

const AppNotifications = lazy(() => import('./shared/notifications/AppNotifications'));

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element missing');
}

const registry = createModuleRegistry(corePlugin);
const workspace = createWorkspaceModel(registry);
const scope = fork();
const syncHash = scopeBind(workspace.workspaceHashChanged, { scope });
const syncStorage = scopeBind(browserStorageChanged, { scope });
const handleHashChange = () => syncHash(window.location.hash);
const handleStorage = (event: StorageEvent) => {
  if (event.storageArea === window.localStorage) {
    syncStorage({ key: event.key, value: event.newValue });
  }
};

window.addEventListener('hashchange', handleHashChange);
window.addEventListener('storage', handleStorage);
handleHashChange();
startApplication(registry, scope);

const appRoot = createRoot(root);
appRoot.render(
  <StrictMode>
    <Provider value={scope}>
      <KurokoThemeProvider>
        <App registry={registry} workspace={workspace} />
        <NotificationAnnouncements />
        <Suspense fallback={null}><AppNotifications /></Suspense>
      </KurokoThemeProvider>
    </Provider>
  </StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener('storage', handleStorage);
    appRoot.unmount();
  });
}
