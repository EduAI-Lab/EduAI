import 'dotenv/config';
import { setDefaultResultOrder } from 'node:dns';
import { createApp } from './app.js';

// Server-side fetches to Core use `localhost` in URLs; on Windows Node often
// tries IPv6 first. If nothing listens on ::1, each hop can stall for seconds.
setDefaultResultOrder('ipv4first');

const app = await createApp();
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
