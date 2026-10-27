/**
 * checks.mjs — skill check bonuses, read per system (no Foundry globals at
 * module scope, so it can be tested on its own).
 *
 *   dnd5e: system.skills.<key>.total — prepared ability + proficiency + bonuses
 *   a5e:   system.skills.<key>.mod   — prepared the same way (expertise dice are
 *          rolled separately by a5e and are not included)
 *   other: the ability modifier, plus proficiency if the skill is marked proficient
 */

/** Labelled terms for rollFormula() (tools.mjs), e.g. [{ value: 5, label: 'Arcana' }]. */
export function skillCheckTerms(actor, key = 'arc', label = 'Arcana', fallbackAbility = 'int') {
  const s  = actor?.system ?? {};
  const sk = s.skills?.[key];
  if (sk && Number.isFinite(sk.total)) return [{ value: sk.total, label }];
  if (sk && Number.isFinite(sk.mod) && ('proficient' in sk || 'deterministicBonus' in sk)) {
    return [{ value: sk.mod, label }];
  }
  const ab   = s.abilities?.[sk?.ability || fallbackAbility];
  const mod  = Number(ab?.check?.mod ?? ab?.mod ?? 0) || 0;
  const mult = Number(sk?.value ?? sk?.proficient ?? 0) || 0;
  const prof = Math.floor((Number(s.attributes?.prof) || 0) * mult);
  const terms = [{ value: mod, label: (sk?.ability || fallbackAbility).toUpperCase() }];
  if (prof) terms.push({ value: prof, label: mult >= 2 ? 'Expertise' : 'Prof' });
  return terms;
}
