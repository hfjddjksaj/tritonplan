import './migrate.css';
import { runOldSite } from './old-site';

runOldSite(document, window, new Date().toISOString());
