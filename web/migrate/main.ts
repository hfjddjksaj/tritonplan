import './migrate.css';
import { runOldSite } from './old-site';

const now = new Date().toISOString();
const payload = runOldSite(document, window, now);
// Decoration only, after the card is up: if the backdrop cannot load or draw, the page works without it.
if (payload) {
  import('./backdrop')
    .then((m) => m.mountBackdrop(document, payload, now))
    .catch(() => {});
}
