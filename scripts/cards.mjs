/**
 * cards.mjs — one look for every result the module posts to chat: the lock
 * check flavour, "lock picked", "lock holds" and "puzzle solved".
 * Dark iron card with a coloured edge, Modesto Condensed title, Signika body
 * (both ship with core). Styles live in styles/lockpick.css (.lpm-card).
 */

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    + `<div class="lpm-card__head">`
    +   `<span class="lpm-card__icon"><i class="fa-solid ${icon}"></i></span>`
    +   `<span class="lpm-card__titles"><span class="lpm-card__title">${esc(title)}</span>`
    +   (subtitle ? `<span class="lpm-card__sub">${esc(subtitle)}</span>` : '')
    +   `</span>`
    + `</div>`
    + (body ? `<div class="lpm-card__body">${body}</div>` : '')
    + `</div>`;
}

/** Flavour line above the check roll. */
export function checkFlavor(toolLabel, dc) {
  return `<span class="lpm-flavor"><i class="fa-solid fa-key"></i>`
    + `<span class="lpm-flavor__what">${esc(toolLabel)} check</span>`
    + `<span class="lpm-flavor__dc">DC ${esc(dc)}</span></span>`;
}
