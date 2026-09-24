/**
 * Long-running worker process: `npm run worker` (dev) or the `worker` service in docker-compose.prod.yml.
 * The same tick() is reachable via POST /api/internal/tick for environments without a resident process.
 */
import { retentionSweep, tick } from './tasks';

let stopping = false;
process.on('SIGINT', () => (stopping = true));
process.on('SIGTERM', () => (stopping = true));

async function main() {
  console.log('[worker] started');
  await retentionSweep().catch((e) => console.error('[worker] retention', e));
  let idle = 0;
  while (!stopping) {
    let did = 0;
    try {
      did = await tick();
    } catch (e) {
      console.error('[worker] tick failed', e);
    }
    idle = did > 0 ? 0 : Math.min(idle + 1, 10);
    await new Promise((r) => setTimeout(r, did > 0 ? 250 : 1000 + idle * 400));
  }
  console.log('[worker] stopped');
  process.exit(0);
}

main();
