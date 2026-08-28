/**
 * compat.mjs — cross-version Foundry API shims (v12 → v14).
 *
 * What changed in v14 (verified against Foundry 14 build 365):
 *   • globalThis.Application / globalThis.Dialog were REMOVED — they are not in
 *     v14's backwards-compatibility global mapping, so referencing the bare
 *     globals throws ReferenceError. The V1 classes still exist, namespaced
 *     under foundry.appv1.api.* and deprecated until v16.
 *   • globalThis.DoorControl is deprecated (until v15) → foundry.canvas.containers.DoorControl
 *   • CONST.CHAT_MESSAGE_TYPES was removed → CONST.CHAT_MESSAGE_STYLES, and the
 *     ChatMessage `type` field is now the document subtype (a string); the
 *     OOC/IC value lives in the `style` field.
 *
 * Every lookup falls back to the old global, so v12/v13 keep working.
 */

/**
 * V1 Application base class. Resolved at module-evaluation time because it is
 * needed for `class X extends AppV1`. Safe: foundry.* is fully populated before
 * module ESModules are imported.
 */
export const AppV1 = foundry?.appv1?.api?.Application ?? globalThis.Application;

/** V1 Dialog class (v14: foundry.appv1.api.Dialog). */
export const DialogV1 = foundry?.appv1?.api?.Dialog ?? globalThis.Dialog;

/** DoorControl class — resolved lazily (canvas namespace, used on 'ready'). */
export function getDoorControlClass() {
  return foundry?.canvas?.containers?.DoorControl ?? globalThis.DoorControl;
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
