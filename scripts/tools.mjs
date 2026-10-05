/**
 * tools.mjs — which tool a character picks a lock with, and the check bonus.
 *
 * Systems rarely carry "lockpicks" as an item: dnd5e and a5e ship Thieves'
 * Tools. The world setting `toolMode` decides what is required:
 *   thieves   — Thieves' Tools; never used up, a failed attempt just fails;
 *   lockpicks — Lockpicks; consumable, a failed attempt snaps one;
 *   either    — Thieves' Tools if carried, otherwise Lockpicks;
 *   none      — nothing required (carried Thieves' Tools still add proficiency).
 *
 * No Foundry globals at module scope, so the logic can be tested on its own.
 */

export const TOOL_MODES = {
  thieves:   "Thieves' Tools — never break",
  lockpicks: 'Lockpicks — one snaps on a failed attempt',
  either:    "Either — Thieves' Tools first, otherwise Lockpicks",
  none:      'Nothing — anyone can try',
};

const THIEVES_RE = /thie(?:f|ve)s?['’`]?\s*tools?|злодійськ|інструменти\s+злодія|воровск/i;
const PICKS_RE   = /lock\s*-?\s*picks?|відмичк|отмычк/i;

/** Thieves' Tools item: dnd5e base item `thief`, otherwise by name (a5e, homebrew, translations). */
export function findThievesTools(actor) {
  return actor?.items?.find(i => {
    const base = i.system?.type?.baseItem;
    return base === 'thief' || base === 'thievesTools' || THIEVES_RE.test(i.name ?? '');
  }) ?? null;
}

/** A stack of lockpicks (anything named so that is not a Thieves' Tools kit). */
export function findLockpicks(actor) {
  return actor?.items?.find(i => PICKS_RE.test(i.name ?? '') && !THIEVES_RE.test(i.name ?? '')) ?? null;
}

const quantity = item => Number(item?.system?.quantity ?? 1);

/**
 * Pick the tool for this attempt according to the mode.
 * @returns {{kind:'thieves'|'lockpicks'|'none', item:object|null, label:string, consumable:boolean}
 *          | {error:string}}
 */
export function resolveTool(actor, mode = 'thieves') {
  const tools = findThievesTools(actor);
  const picks = findLockpicks(actor);
  const name  = actor?.name ?? 'This character';
  const T = tools && { kind: 'thieves', item: tools, label: "Thieves' Tools", consumable: false };
  const P = picks && quantity(picks) >= 1 && { kind: 'lockpicks', item: picks, label: 'Lockpicks', consumable: true };
  switch (mode) {
    case 'none':
      return T || { kind: 'none', item: null, label: 'Bare hands', consumable: false };
    case 'lockpicks':
      return P || { error: picks ? `${name} has used up all their lockpicks.` : `${name} has no lockpicks.` };
    case 'either':
      return T || P || { error: `${name} needs Thieves' Tools or lockpicks to pick this lock.` };
    default:
      return T || { error: `${name} needs Thieves' Tools to pick this lock.` };
  }
}

/**
 * The check bonus as labelled terms, e.g. [{value: 3, label: 'Dex'}, {value: 2, label: 'Prof'}].
 * Lockpicks are the same craft, so Thieves' Tools proficiency applies to both.
 *   dnd5e: system.tools.thief (prepared .total, or raw .value multiplier), or the item's `proficient`;
 *   a5e:   system.abilities.dex.check.mod + prof if system.proficiencies.tools has 'thievesTools'.
 */
export function toolCheckTerms(actor, tool) {
  const s   = actor?.system ?? {};
  const dex = Number(s.abilities?.dex?.check?.mod ?? s.abilities?.dex?.mod ?? 0) || 0;
  const pb  = Number(s.attributes?.prof) || 0;
  const terms = [{ value: dex, label: 'Dex' }];
  if (tool?.kind === 'none' && !tool.item) return terms;

  const t = s.tools?.thief ?? s.tools?.thievesTools;
  if (t && Number(t.value) > 0 && Number.isFinite(t.total)) {
    return [{ value: t.total, label: "Thieves' Tools" }];      // dnd5e: ability + proficiency + bonuses
  }
  let mult = 0;
  if (Array.isArray(s.proficiencies?.tools)) mult = s.proficiencies.tools.includes('thievesTools') ? 1 : 0;
  else if (t) mult = Number(t.value) || 0;
  else if (tool?.item?.system?.proficient !== undefined) mult = Number(tool.item.system.proficient) || 0;
  const prof = Math.floor(pb * mult);
  if (prof) terms.push({ value: prof, label: mult >= 2 ? 'Expertise' : 'Prof' });
  return terms;
}

/** "1d20 + 3[Dex] + 2[Prof]" — the labels show up in the roll tooltip. */
export function rollFormula(terms) {
  const parts = terms.filter(t => t.value)
    .map(t => `${t.value < 0 ? '-' : '+'} ${Math.abs(t.value)}[${t.label}]`);
  return ['1d20', ...parts].join(' ');
}
