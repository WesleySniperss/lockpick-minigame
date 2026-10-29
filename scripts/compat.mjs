/**
 * compat.mjs — cross-version Foundry API shims (v12 → v14).
 *
 * Every window is an ApplicationV2 (app-window.mjs), so the V1 Application and
 * Dialog that v14 deprecates (and v16 removes) are no longer used anywhere.
 *
 * What still differs between versions:
 *   • CONST.CHAT_MESSAGE_TYPES is gone in v14 → CONST.CHAT_MESSAGE_STYLES,
 *     and the ChatMessage `type` field is now the document subtype (a string);
 *     the OOC/IC value lives in the `style` field.
 *   • fromUuidSync moved to foundry.utils in v13.
 *
 * Every lookup falls back to the old global, so v12 keeps working.
 */

/**
 * Synchronous document lookup by UUID (v13+: foundry.utils.fromUuidSync; v12: global).
 * Works for unlinked token actors too ("Scene.x.Token.y.Actor.z").
 */
export function docFromUuid(uuid) {
  if (!uuid) return null;
  const fn = foundry?.utils?.fromUuidSync ?? globalThis.fromUuidSync;
  try { return fn ? fn(uuid) : null; } catch (e) { return null; }
}

/** Chat message style enum — resolved lazily so CONST is guaranteed populated. */
export function chatStyles() {
  return CONST.CHAT_MESSAGE_STYLES ?? CONST.CHAT_MESSAGE_TYPES
      ?? { OTHER: 0, OOC: 1, IC: 2, EMOTE: 3 };
}

/**
 * Build the correct OOC chat payload for the running core version.
 * v13+ expects {style}; v12 expected {type}.
 */
export function oocChatData(data = {}) {
  const key = CONST.CHAT_MESSAGE_STYLES ? 'style' : 'type';
  return { ...data, [key]: chatStyles().OOC };
}

/** Foundry major generation currently running (0 before `game` exists). */
export function generation() {
  return Number(game?.release?.generation ?? 0);
}
