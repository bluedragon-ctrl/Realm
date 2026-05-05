export const PLAYER_DEFAULT_STATS = Object.freeze({
  hp: 20, hpMax: 20,
  mp: 5,  mpMax: 5,
  attack: 3,
  defense: 1,
  int: 1,
  magicResist: 0,
  accuracy: 0,
  evasion: 0,
  spd: 6,
});

export const NPC_DEFAULT_STATS = Object.freeze({
  hp: 1, hpMax: 1,
  mp: 0, mpMax: 0,
  attack: 0,
  defense: 0,
  int: 0,
  magicResist: 0,
  accuracy: 0,
  evasion: 0,
  spd: 6,
});

export function normalizeStats(input, defaults) {
  const out = { ...defaults };
  if (input && typeof input === 'object') {
    for (const key of Object.keys(defaults)) {
      if (typeof input[key] === 'number') out[key] = input[key];
    }
  }
  if (out.hp > out.hpMax) out.hp = out.hpMax;
  if (out.mp > out.mpMax) out.mp = out.mpMax;
  return out;
}

export const DEFAULT_COSTS = Object.freeze({
  say: 6,
  emote: 6,
  wait: 12,
  move: 12,
  attack: 12,
  cast: 12,
  interact: 6,
  give_item: 12,
  flee: 12,
});

export const DEFAULT_PLAYER_ATTACK = Object.freeze({
  primitive: 'attack',
  name: { en: 'attack', cs: 'útok' },
  cost: 12,
  damage: '1d3+ATK',
  templates: {
    en: ['{actor} attacks {target}!'],
    cs: ['{actor} útočí na {target}!'],
  },
});
