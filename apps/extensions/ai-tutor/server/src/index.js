import 'dotenv/config';
import { createApp } from './app.js';
import { initScheduler } from './jobs/scheduler.js';
import { assertCoreUrlConsistency } from './services/urlConsistency.js';

// #225 SEAM-05: warns (or, with EDUAI_ENFORCE_URL_CONSISTENCY=1, throws and
// aborts startup) when CORE_URL and EDUAI_BASE_URL resolve to different
// origins — see services/urlConsistency.js for why that split is dangerous.
assertCoreUrlConsistency();

const app = await createApp();
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API listening on :${PORT}`);
  initScheduler();
});
