import { s } from '../../i18n.js';
import { setPosition } from '../positionGate.js';
import { actorsInRoom } from '../world.js';
import { getHate } from '../aggro.js';

function inCombat(actor) {
  for (const a of actorsInRoom(actor.location)) {
    if (a.kind !== 'npc') continue;
    if (getHate(a, actor) > 0) return true;
  }
  return false;
}

function changePosition(actor, next) {
  if (actor.position === next) {
    actor.session?.send({ kind: 'system', text: s(`position.already.${next}`, actor.lang) });
    return;
  }
  if ((next === 'sit' || next === 'sleep') && inCombat(actor)) {
    actor.session?.send({ kind: 'error', text: s('position.in_combat', actor.lang) });
    return;
  }
  setPosition(actor, next, 'volitional');
}

export function stand(actor) { changePosition(actor, 'stand'); }
export function sit(actor)   { changePosition(actor, 'sit'); }
export function sleep(actor) { changePosition(actor, 'sleep'); }
