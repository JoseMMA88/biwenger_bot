import 'dotenv/config';

try { require('dotenv').config(); } catch {}

import { Logger } from './utils/logger.js';
import { createApp } from './bootstrap.js';

(async function bootstrap() {
  try {
    const app = createApp();
    const result = await app.run();

    console.log(JSON.stringify({
      type: 'schedule',
      hasCandidates: result.hasCandidates,
      candidateCount: result.candidateCount,
      nextRunSeconds: result.schedule.nextRunSeconds,
      nextRunHuman: result.schedule.nextRunHuman
    }));
  } catch (err) {
    Logger.error(err);
    process.exit(1);
  }
})();
