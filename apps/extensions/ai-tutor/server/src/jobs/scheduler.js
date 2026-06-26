import cron from 'node-cron';
import { runReconciliation } from './reconcile.js';

export function initScheduler() {
  cron.schedule('0 2 * * *', () => {
    runReconciliation().catch((err) => console.error('[reconcile] Cron failed:', err));
  });
}
