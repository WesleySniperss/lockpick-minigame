/**
 * lockpick-minigame | main.mjs — Foundry VTT v13
 * Uses dynamic imports so errors in other files don't break toolbar buttons.
 */

export const MODULE_ID = 'lockpick-minigame';

// ─── Settings ─────────────────────────────────────────────────────────────────

Hooks.once('init', () => {
  console.log(`%c${MODULE_ID} | LOADED ✓`, 'color:lime;font-weight:bold');

  game.settings.register(MODULE_ID, 'breakOnMiss', {
    name: 'Lose a pick on miss',
    scope: 'world', config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, 'defaultDC', {
    name: 'Default Lock DC',
    scope: 'world', config: true, type: Number, default: 15
  });
});

Hooks.once('ready', () => {
  _patchDoorControl();
  _registerSocket();
});

// ─── VTools integration ───────────────────────────────────────────────────────

Hooks.once('vtools.ready', () => {
  VTools.register({
    name   : `${MODULE_ID}-lock`,
    title  : 'Configure Lock',
    icon   : 'fa-solid fa-lock',
    onClick: () => {
      if (!game.user.isGM) return;
      const wall = canvas.walls?.controlled?.[0];
      if (!wall) { ui.notifications.warn('Select a door on the canvas first.'); return; }
      if (wall.document.door === (CONST.WALL_DOOR_TYPES?.NONE ?? 0)) {
        ui.notifications.warn('Selected wall is not a door.'); return;
      }
      openFlagDialog(wall);
    }
  });

  VTools.register({
    name   : `${MODULE_ID}-puzzle`,
    title  : 'Open Puzzle',
    icon   : 'fa-solid fa-puzzle-piece',
    onClick: () => {
      if (!game.user.isGM) return;
      _openPuzzleDialog();
    }
  });
});

// ─── Socket ───────────────────────────────────────────────────────────────────

function _registerSocket() {
  game.socket.on(`module.${MODULE_ID}`, (data) => {
    const { action, type, difficulty, userId } = data;
    if (action !== 'openPuzzle') return;
    if (!userId || userId === game.user.id) {
      import('./PuzzleApp.mjs').then(m => m.openPuzzle(type, difficulty, data.opts)).catch(console.error);
    }
  });
}

// ─── Puzzle dialog ────────────────────────────────────────────────────────────

async function _openPuzzleDialog() {
  const { PUZZLE_TYPES, DIFFICULTIES } = await import('./PuzzleApp.mjs');

  const typeOpts   = PUZZLE_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('');
  const diffOpts   = DIFFICULTIES.map(d => `<option value="${d.id}">${d.label}</option>`).join('');
  const playerOpts = game.users.filter(u => u.active)
    .map(u => `<option value="${u.id}">${u.name}${u.isGM ? ' (GM)' : ''}</option>`).join('');

  const langOpts = Object.entries({infernal:'Інфернальна',abyssal:'Безоднянська',elvish:'Ельфійська'})
    .map(([k,v])=>`<option value="${k}">${v}</option>`).join('');

  const d = new Dialog({
    title: '🧩 Відкрити головоломку',
    content: `<form id="lpm-puzzle-form" style="padding:4px 0">
      <div class="form-group">
        <label>Тип</label>
        <div class="form-fields"><select id="lpm-ptype" name="ptype" style="width:100%">${typeOpts}</select></div>
      </div>
      <div class="form-group">
        <label>Складність</label>
        <div class="form-fields"><select name="pdiff">${diffOpts}</select></div>
      </div>
      <div id="lpm-cipher-opts" style="display:none">
        <div class="form-group">
          <label>Мова</label>
          <div class="form-fields"><select name="plang" style="width:100%">${langOpts}</select></div>
        </div>
        <div class="form-group">
          <label>Слово / фраза</label>
          <div class="form-fields">
            <input type="text" name="pword" placeholder="Залиш порожнім для рандомного" style="width:100%"
                   autocomplete="off" spellcheck="false">
          </div>
        </div>
        <div class="form-group">
          <label>Зсув Цезаря</label>
          <div class="form-fields">
            <input type="number" name="pshift" value="" min="1" max="25" placeholder="Рандомний" style="width:80px">
          </div>
        </div>
      </div>
      <div class="form-group">
        <label>Кому</label>
        <div class="form-fields">
          <select name="ptarget" style="width:100%">
            <option value="all">👥 Всім гравцям</option>
            <option value="me">🛡️ Тільки мені (GM)</option>
            <optgroup label="─── Конкретний гравець ───">${playerOpts}</optgroup>
          </select>
        </div>
      </div>
    </form>`,
    render: (html) => {
      html.find('#lpm-ptype').on('change', function() {
        html.find('#lpm-cipher-opts').toggle(this.value === 'cipher');
      });
      // Stop keydown propagation so input fields work
      html.find('input').on('keydown', e => e.stopPropagation());
    },
    buttons: {
      open: {
        icon: '<i class="fa-solid fa-puzzle-piece"></i>', label: 'Відкрити',
        callback: async (html) => {
          const { openPuzzle } = await import('./PuzzleApp.mjs');
          const type   = html.find('[name="ptype"]').val();
          const diff   = html.find('[name="pdiff"]').val();
          const target = html.find('[name="ptarget"]').val();
          const opts   = {
            lang      : html.find('[name="plang"]').val() || undefined,
            customWord: html.find('[name="pword"]').val() || undefined,
            shift     : parseInt(html.find('[name="pshift"]').val()) || undefined,
          };
          const emit = (uid) => game.socket.emit(`module.${MODULE_ID}`, { action:'openPuzzle', type, difficulty:diff, userId:uid, opts });
          if (target === 'all') {
            emit(null); openPuzzle(type, diff, opts);
          } else if (target === 'me') {
            openPuzzle(type, diff, opts);
          } else {
            emit(target); if (target === game.user.id) openPuzzle(type, diff, opts);
          }
        }
      },
      cancel: { label: 'Скасувати' }
    },
    default: 'open'
  });
  d.render(true);
}

// ─── Flag dialog ──────────────────────────────────────────────────────────────

export async function openFlagDialog(wall) {
  const doc     = wall.document;
  const enabled = doc.getFlag(MODULE_ID, 'enabled') ?? false;
  const dc      = doc.getFlag(MODULE_ID, 'dc')      ?? game.settings.get(MODULE_ID, 'defaultDC');

  new Dialog({
    title: '🔒 Configure Lock — Lockpick Minigame',
    content: `<form style="padding:4px 0">
      <div class="form-group">
        <label>Enable lockpick mini-game</label>
        <div class="form-fields">
          <input type="checkbox" name="enabled" ${enabled ? 'checked' : ''}>
        </div>
      </div>
      <div class="form-group">
        <label>Lock DC</label>
        <div class="form-fields">
          <input type="number" name="dc" value="${dc}" min="5" max="30" step="1" style="width:80px">
        </div>
      </div>
    </form>`,
    buttons: {
      save: {
        icon: '<i class="fa-solid fa-save"></i>', label: 'Save',
        callback: async (html) => {
          const newEnabled = html.find('[name="enabled"]').is(':checked');
          const newDc      = parseInt(html.find('[name="dc"]').val()) || 15;
          await doc.setFlag(MODULE_ID, 'enabled', newEnabled);
          await doc.setFlag(MODULE_ID, 'dc', newDc);
          ui.notifications.info(newEnabled ? `Lock enabled — DC ${newDc}` : 'Lockpick minigame disabled.');
        }
      },
      remove: {
        icon: '<i class="fa-solid fa-trash"></i>', label: 'Remove',
        callback: async () => {
          await doc.unsetFlag(MODULE_ID, 'enabled');
          await doc.unsetFlag(MODULE_ID, 'dc');
          ui.notifications.info('Lock flag removed.');
        }
      },
      cancel: { label: 'Cancel' }
    },
    default: 'save'
  }).render(true);
}

// ─── Door click patching ──────────────────────────────────────────────────────

function _patchDoorControl() {
  const proto = DoorControl.prototype;
  const _orig = proto._onMouseDown;

  proto._onMouseDown = async function (event) {
    const doc = this.wall.document;
    if (!doc.getFlag(MODULE_ID, 'enabled'))       return _orig.call(this, event);
    if (doc.ds !== CONST.WALL_DOOR_STATES.LOCKED) return _orig.call(this, event);

    event.preventDefault();
    event.stopPropagation();

    const token = canvas.tokens.controlled[0];
    if (!token?.actor)
      return ui.notifications.warn('Select a token to pick this lock.');

    const actor   = token.actor;
    const dc      = doc.getFlag(MODULE_ID, 'dc') ?? game.settings.get(MODULE_ID, 'defaultDC');
    const pickItem = _findLockpicks(actor);

    if (!pickItem)
      return ui.notifications.warn(`🗝️ ${actor.name} не має відмичок в інвентарі!`);
    if ((pickItem.system?.quantity ?? 1) < 1)
      return ui.notifications.warn(`🗝️ ${actor.name} використав всі відмички!`);

    const rollResult = await _rollThievesTools(actor, dc);
    if (!rollResult) return;

    const { LockpickApp } = await import('./LockpickApp.mjs');
    new LockpickApp(this.wall, {
      dc, rollResult,
      pickQty: pickItem.system?.quantity ?? 1,
      async consumePick() {
        const q = pickItem.system?.quantity ?? 1;
        if (q <= 1) await pickItem.delete();
        else        await pickItem.update({ 'system.quantity': q - 1 });
      },
      async onSuccess() {
        await doc.update({ ds: CONST.WALL_DOOR_STATES.OPEN });
        ChatMessage.create({
          content: `<p>🔓 <strong>${token.name}</strong> майстерно зламав замок.</p>`,
          speaker: ChatMessage.getSpeaker({ token })
        });
      },
      async onFailure() {
        ChatMessage.create({
          content: `<p>💥 <strong>${token.name}</strong> зламав всі відмички. Замок тримається.</p>`,
          speaker: ChatMessage.getSpeaker({ token })
        });
      }
    }).render(true);
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _findLockpicks(actor) {
  return actor.items.find(i => {
    const n = i.name.toLowerCase();
    return n.includes('lockpick') || n.includes('lock pick') ||
           n.includes('відмичк')  || n.includes("thieves' tools") ||
           n.includes('thieves tools') ||
           i.system?.type?.baseItem === 'thievesTools';
  }) ?? null;
}

async function _rollThievesTools(actor, dc) {
  const dexMod    = actor.system.abilities?.dex?.mod ?? 0;
  const prof      = actor.system.attributes?.prof    ?? 2;
  const toolVal   = actor.system.tools?.thievesTools?.value ?? 0;
  const profBonus = Math.floor(toolVal * prof);
  const total     = dexMod + profBonus;
  const sign      = total >= 0 ? '+' : '';

  let roll;
  try {
    roll = await new Roll(`1d20${sign}${total}`).evaluate();
  } catch(e) { console.error(e); return null; }

  await roll.toMessage({
    speaker : ChatMessage.getSpeaker({ actor }),
    flavor  : `🗝️ <strong>Thieves' Tools</strong> — DC ${dc}`,
    rollMode: game.settings.get('core', 'rollMode')
  });

  return { total: roll.total, d20: roll.dice[0].results[0].result, dc, margin: roll.total - dc };
}

