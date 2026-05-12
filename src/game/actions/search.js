import { getRoom, broadcastToRoom, world } from '../world.js';
import { describeRoomToAll } from './look.js';
import { s, t, dirName } from '../../i18n.js';
import { requireStanding } from '../positionGate.js';

export default function search(actor) {
  const gate = requireStanding(actor);
  if (!gate.ok) {
    actor.session?.send({ kind: 'error', text: gate.msg });
    return;
  }
  const room = getRoom(actor.location);
  if (!room) return;
  const lang = actor.lang;
  const found = new Set(actor.record?.foundSecrets ?? []);
  const reveals = [];

  const hiddenExits = room.hiddenExits ?? {};
  for (const [exitKey, meta] of Object.entries(hiddenExits)) {
    if (found.has(meta.id)) continue;
    if (actor.stats.perception >= meta.dc) {
      actor.record.foundSecrets.push(meta.id);
      found.add(meta.id);
      reveals.push(s('search.found_exit', lang, {
        direction: dirName(exitKey, lang) || exitKey,
      }));
    }
  }

  const hiddenFixtures = room.hiddenFixtures ?? {};
  for (const [defId, meta] of Object.entries(hiddenFixtures)) {
    const id = meta.id ?? defId;
    if (found.has(id)) continue;
    if (actor.stats.perception >= meta.dc) {
      actor.record.foundSecrets.push(id);
      found.add(id);
      const def = world.itemDefs.get(defId);
      const targetName = def ? t(def.name, lang) : defId;
      reveals.push(s('search.found_fixture', lang, { target: targetName }));
    }
  }

  broadcastToRoom(actor.location, (recipient) => ({
    kind: 'emote',
    source: 'ambient',
    text: s('search.others', recipient.lang, { actor: actor.name }),
  }), actor);

  if (reveals.length === 0) {
    actor.session.send({ kind: 'system', text: s('search.nothing', lang) });
    return;
  }

  actor.dirty = true;
  for (const line of reveals) {
    actor.session.send({ kind: 'system', text: line });
  }
  describeRoomToAll(actor.location);
}
