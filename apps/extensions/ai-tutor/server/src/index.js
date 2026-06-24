import 'dotenv/config';
import { createApp } from './app.js';
import { initScheduler } from './jobs/scheduler.js';

const app = await createApp();
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
  initScheduler();
});
