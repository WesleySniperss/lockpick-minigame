/**
 * app-window.mjs — the ApplicationV2 window every game and puzzle opens in.
 *
 * Content is an HTML string (no Handlebars templates), rendered once: the
 * games keep live canvases and listeners in it, so a later render() must not
 * replace it. The window is always dark (the games are painted for it) and is
 * never popped out into a separate browser window (v14 "detach"), because the
 * games listen for pointer events and frames on this one.
 *
 * Subclasses provide:
 *   contentHTML()   — the inner HTML of the window
 *   onReady(root)   — wire the DOM once it is in the page (root = .window-content)
 */

const { ApplicationV2 } = foundry.applications.api;

export class GameWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes : ['lockpick-minigame', 'themed', 'theme-dark'],
    window  : { resizable: false },
    position: { width: 'auto', height: 'auto' },
  };

  /** @abstract */
  contentHTML() { return ''; }

  /** @abstract */
  onReady(root) {}

  /** The window's content element, once rendered. */
  get root() { return this.element?.querySelector('.window-content') ?? null; }

  async _renderHTML() {
    const t = document.createElement('template');
    t.innerHTML = this.contentHTML();
    return t.content;
  }

  _replaceHTML(result, content) {
    if (!content.childElementCount) content.replaceChildren(result);
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.onReady(this.root);
  }

  _canDetach() { return false; }
}

/**
 * DialogV2 content: v13+ cleans an HTML string (which can strip form markup)
 * but takes a bare <div> as it is; v12 only knows strings.
 */
export function dialogContent(html) {
  if (Number(game.release?.generation ?? 0) < 13) return html;
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}
