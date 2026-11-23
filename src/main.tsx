import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { setupPwa } from './pwa';
import { migrateLegacyLocalStorage } from './db/backup';
import { ensurePersisted } from './db/storage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

setupPwa();
void ensurePersisted();
void migrateLegacyLocalStorage();
