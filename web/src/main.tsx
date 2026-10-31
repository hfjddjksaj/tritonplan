import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root';
import './styles/app.css';
import './styles/auth.css';
import './styles/share.css';
import { installBridgeHub } from './lib/bridge';
import { installBfcacheReload } from './lib/nav';

// Before anything renders: the extension pushes once at document_idle, and the planner
// may not mount until sign-in finishes.
installBridgeHub();
installBfcacheReload();

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
