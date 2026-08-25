import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { DataSourceProvider } from './data-source.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from index.html');

/**
 * basename comes from Vite's BASE_URL, which is set by the `base` build option.
 *
 * That is what lets the same application be served from the root during local
 * development and from a subdirectory of an existing site when published,
 * without any route in the app knowing where it lives.
 */
const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter basename={basename || '/'}>
      <DataSourceProvider>
        <App />
      </DataSourceProvider>
    </BrowserRouter>
  </StrictMode>,
);
