/**
 * rolls.mjs — the check that decides how hard a challenge is, rolled the way
 * the game system rolls it whenever it can. dnd5e and a5e open their own roll
 * dialog (advantage, expertise dice, Reliable Talent, situational bonuses) and
 * post their own roll card. Any other system, or a system API that throws,
 * gets 1d20 + the bonus this module reads from the sheet (checks.mjs, tools.mjs).
 *
 * Every roll resolves to { total, d20, message } or null when the player
 * cancelled the system's roll dialog. It waits for Dice So Nice, so a game
 * never opens under a rolling die.
 */

import { skillCheckTerms } from './checks.mjs';
import { toolCheckTerms, rollFormula } from './tools.mjs';
import { checkFlavor } from './cards.mjs';

const MODULE_ID = 'lockpick-minigame';

/** Arcana check. */
export async function rollArcana(actor, { dc, hideDC = false, icon } = {}) {
  const native = await tryNative(async () => {
    if (game.system?.id === 'dnd5e' && typeof actor.rollSkill === 'function') {
      return fromRolls(await actor.rollSkill({ skill: 'arc', ...target(dc, hideDC) }));
    }
    if (game.system?.id === 'a5e' && typeof actor.rollSkillCheck === 'function') {
      return fromMessage(await actor.rollSkillCheck('arc', {}));
    }
  });
  if (native !== undefined) return native;
  return plainRoll(actor, rollFormula(skillCheckTerms(actor, 'arc', 'Arcana')),
    checkFlavor('Arcana', hideDC ? null : dc, icon));
}

/**
 * Lockpicking check: Thieves' Tools (lockpicks are the same craft), or a bare
 * Dexterity check when the character has nothing to pick with.
 */
export async function rollLockpicking(actor, tool, { dc, hideDC = false } = {}) {
  const bare = tool.kind === 'none' && !tool.item;
  const native = await tryNative(async () => {
    if (game.system?.id === 'dnd5e' && typeof actor.rollToolCheck === 'function') {
      return fromRolls(bare
        ? await actor.rollAbilityCheck({ ability: 'dex', ...target(dc, hideDC) })
        : await actor.rollToolCheck({ tool: 'thief', ...target(dc, hideDC) }));
    }
    if (game.system?.id === 'a5e' && typeof actor.rollAbilityCheck === 'function') {
      // a5e has no tool check on the actor: a Dexterity check with the tool
      // proficiency pre-filled as a situational bonus the player can see and change.
      const prof = bare ? 0 : toolCheckTerms(actor, tool).filter(t => t.label !== 'Dex').reduce((s, t) => s + t.value, 0);
      return fromMessage(await actor.rollAbilityCheck('dex', prof ? { situationalMods: String(prof) } : {}));
    }
  });
  if (native !== undefined) return native;
  return plainRoll(actor, rollFormula(toolCheckTerms(actor, tool)),
    checkFlavor(bare ? 'Dexterity' : tool.label, hideDC ? null : dc));
}

/** dnd5e shows success or failure on its card when it knows the DC. */
const target = (dc, hideDC) => (hideDC ? {} : { target: Number(dc) });

/** undefined = no native roll for this system (or it broke): use the plain roll. */
async function tryNative(fn) {
  try { return await fn(); }
  catch (e) { console.warn(`${MODULE_ID} | the system roll failed, rolling 1d20 + bonus instead:`, e); return undefined; }
}

/** dnd5e: D20Roll[] linked to their message, or null when cancelled. */
async function fromRolls(rolls) {
  const roll = rolls?.[0];
  if (!roll) return null;
  return settle(roll, roll.parent ?? null);
}

/** a5e: the roll message, or null when cancelled. */
async function fromMessage(message) {
  const roll = message?.rolls?.[0];
  if (!roll) return null;
  return settle(roll, message);
}

async function plainRoll(actor, formula, flavor) {
  const roll = await new Roll(formula).evaluate();
  const message = await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor });
  return settle(roll, message);
}

/** Wait for Dice So Nice, then read the total and the kept d20. */
async function settle(roll, message) {
  try { if (message?.id) await game.dice3d?.waitFor3DAnimationByMessageID?.(message.id); } catch (e) {}
  const die = roll.dice?.find(d => d.faces === 20) ?? roll.dice?.[0];
  const d20 = die?.results?.find(r => r.active !== false && !r.discarded)?.result ?? die?.total ?? 10;
  return { total: Number(roll.total), d20: Number(d20), message };
}
