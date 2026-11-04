import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './styles.css';
import { App } from './ui/App';

try {
  if (window.self !== window.top) document.documentElement.dataset.embedded = '1';
} catch {
  document.documentElement.dataset.embedded = '1';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
