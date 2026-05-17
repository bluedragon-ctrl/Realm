import { loadWorld, setNpcRespawnHandler } from './src/game/world.js';
import { loadStrings } from './src/persist/contentLoader.js';
import { setStringTables } from './src/i18n.js';
import { startWsServer } from './src/net/wsServer.js';
import { startTick, flushDirty } from './src/game/tick.js';
import { startWanderTick } from './src/game/wandering.js';
import { describeRoomToAll } from './src/game/actions/look.js';
// Side-effect import: registers content-specific event subscribers at module load.
import './src/game/quests.js';

const PORT = Number(process.env.PORT ?? 8080);

async function main() {
  setStringTables(await loadStrings());
  await loadWorld();
  setNpcRespawnHandler((npc) => {
    if (npc?.location) describeRoomToAll(npc.location);
  });
  await startWsServer(PORT);
  startTick();
  startWanderTick();

  const shutdown = async () => {
    console.log('\nshutting down...');
    try { await flushDirty(); } catch (err) { console.error(err); }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('fatal:', err);
  process.exit(1);
});
