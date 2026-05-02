import { sendStats } from './messages.js';
import { s, t } from '../i18n.js';

const EFFECTS = {
  damage({ amount }, { actor, target }) {
    const recipient = target ?? actor;
    if (!recipient.stats) return { dealt: 0 };
    const dealt = Math.min(recipient.stats.hp, Math.max(0, amount ?? 0));
    recipient.stats.hp -= dealt;
    return { dealt };
  },
  heal({ amount, hp, mp }, { actor, target }) {
    const recipient = target ?? actor;
    if (!recipient.stats) return { hpRestored: 0, mpRestored: 0 };
    const hpAmount = hp ?? amount ?? 0;
    const mpAmount = mp ?? 0;
    const hpBefore = recipient.stats.hp;
    const mpBefore = recipient.stats.mp;
    recipient.stats.hp = Math.min(recipient.stats.hpMax, recipient.stats.hp + hpAmount);
    recipient.stats.mp = Math.min(recipient.stats.mpMax, recipient.stats.mp + mpAmount);
    return {
      hpRestored: recipient.stats.hp - hpBefore,
      mpRestored: recipient.stats.mp - mpBefore,
    };
  },
};

export function applyEffect(effectDef, ctx) {
  if (!effectDef) return null;
  const fn = EFFECTS[effectDef.type];
  if (!fn) return null;
  try {
    return fn(effectDef, ctx);
  } catch (err) {
    console.error(`effect '${effectDef.type}' failed:`, err);
    return null;
  }
}

function actorDisplayName(a, lang) {
  const n = a.kind === 'npc' ? (a.nameAcc ?? a.name) : a.name;
  return t(n, lang);
}

function healSelfMessage(lang, hp, mp) {
  if (hp > 0 && mp > 0) return s('heal.you_were_restored', lang, { hp, mp });
  if (hp > 0) return s('heal.you_were_healed', lang, { amount: hp });
  if (mp > 0) return s('heal.you_were_refreshed', lang, { amount: mp });
  return null;
}

function healTargetMessage(lang, targetName, hp, mp) {
  if (hp > 0 && mp > 0) return s('heal.you_restored_target', lang, { target: targetName, hp, mp });
  if (hp > 0) return s('heal.you_healed_target', lang, { target: targetName, amount: hp });
  if (mp > 0) return s('heal.you_refreshed_target', lang, { target: targetName, amount: mp });
  return null;
}

export function sendHealFeedback(actor, target, result) {
  const hp = result?.hpRestored ?? 0;
  const mp = result?.mpRestored ?? 0;
  const recipient = target ?? actor;

  if (hp === 0 && mp === 0) {
    actor.session?.send({ kind: 'system', tone: 'flavor', text: s('heal.no_effect', actor.lang) });
    return;
  }
  if (actor !== recipient) {
    const text = healTargetMessage(actor.lang, actorDisplayName(recipient, actor.lang), hp, mp);
    if (text) actor.session?.send({ kind: 'system', tone: 'good', text });
  }
  if (recipient.session) {
    const text = healSelfMessage(recipient.lang, hp, mp);
    if (text) recipient.session.send({ kind: 'system', tone: 'good', text });
  }
  if (actor.kind === 'player') sendStats(actor);
  if (recipient !== actor && recipient.kind === 'player') sendStats(recipient);
}
