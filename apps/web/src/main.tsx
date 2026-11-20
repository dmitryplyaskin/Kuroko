import '@mantine/core/styles.css';
import '@fontsource-variable/onest';
import '@fontsource-variable/literata';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { KurokoThemeProvider } from './theme';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element missing');
}

createRoot(root).render(
  <StrictMode>
    <KurokoThemeProvider>
      <App />
    </KurokoThemeProvider>
  </StrictMode>,
);
