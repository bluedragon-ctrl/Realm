import { s } from '../i18n.js';

export function parseCommand(line) {
  const parts = line.trim().split(/\s+/);
  return { verb: parts[0]?.toLowerCase() ?? '', args: parts.slice(1) };
}

export async function executeHandler(handler, actor, args, opts) {
  const { logLabel, errorKey, errorParams } = opts;
  try {
    await handler(actor, args);
  } catch (err) {
    console.error(`${logLabel} failed:`, err);
    actor.session.send({
      kind: 'error',
      text: s(errorKey, actor.lang, { ...(errorParams ?? {}), message: err.message }),
    });
  }
}
