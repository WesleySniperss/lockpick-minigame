/**
 * cards.mjs — one look for everything the module posts to chat: the request
 * card the GM sends, the check flavour, "lock picked", "lock holds" and
 * "puzzle solved".
 * Dark iron card with a coloured edge, Modesto Condensed title, Signika body
 * (both ship with core). Styles live in styles/lockpick.css (.lpm-card).
 */

import { CHALLENGES } from './challenges.mjs';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cardHead(icon, title, subtitle) {
  return `<div class="lpm-card__head">`
    +   `<span class="lpm-card__icon"><i class="fa-solid ${icon}"></i></span>`
    +   `<span class="lpm-card__titles"><span class="lpm-card__title">${esc(title)}</span>`
    +   (subtitle ? `<span class="lpm-card__sub">${esc(subtitle)}</span>` : '')
    +   `</span>`
    + `</div>`;
}

/**
 * @param {object} o
 * @param {'success'|'failure'|'neutral'} [o.tone]
 * @param {string} o.icon      Font Awesome name without the prefix, e.g. 'fa-lock-open'
 * @param {string} o.title     plain text
 * @param {string} [o.subtitle] plain text
 * @param {string} [o.body]    HTML (escape names before passing them in)
 */
export function resultCard({ tone = 'success', icon = 'fa-lock-open', title, subtitle = '', body = '' }) {
  return `<div class="lpm-card lpm-card--${tone}">`
    + cardHead(icon, title, subtitle)
    + (body ? `<div class="lpm-card__body">${body}</div>` : '')
    + `</div>`;
}

/**
 * The GM's request: "<character> is asked to …". The button and the status
 * line are filled in on render from the message flags (requests.mjs), so the
 * same card shows the right thing to the owner, the table and later readers.
 */
export function requestCard({ kind = 'lock', name, dc, label = '' }) {
  const c = CHALLENGES[kind] ?? CHALLENGES.lock;
  const check = c.group === 'Arcana' ? 'Arcana' : '';
  const subtitle = [label, check, `DC ${dc}`].filter(Boolean).join(' · ');
  const what = label ? `${c.on} <em>${esc(label)}</em>` : c.none;
  return `<div class="lpm-card lpm-card--neutral lpm-request" data-kind="${kind}">`
    + cardHead(c.icon, c.title, subtitle)
    + `<div class="lpm-card__body"><strong>${esc(name)}</strong> ${c.ask} ${what}.`
    +   ` The roll decides how hard it will be.</div>`
    + `<div class="lpm-card__actions">`
    +   `<button type="button" class="lpm-card__button" data-lpm-action="pick">`
    +     `<i class="fa-solid fa-dice-d20"></i> ${c.button}</button>`
    +   `<span class="lpm-card__status"></span>`
    + `</div>`
    + `</div>`;
}

/** Flavour line above the check roll. */
export function checkFlavor(toolLabel, dc, icon = 'fa-key') {
  return `<span class="lpm-flavor"><i class="fa-solid ${icon}"></i>`
    + `<span class="lpm-flavor__what">${esc(toolLabel)} check</span>`
    + `<span class="lpm-flavor__dc">DC ${esc(dc)}</span></span>`;
}
