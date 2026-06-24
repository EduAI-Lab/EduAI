import cron from 'node-cron';
import { runReconciliation } from './reconcile.js';
import { logger } from '../utils/logger.js';

export function initScheduler() {
  cron.schedule('0 2 * * *', () => {
    runReconciliation().catch((err) => logger.error({ err }, '[reconcile] Cron failed'));
  });
}
