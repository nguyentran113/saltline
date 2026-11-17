// Every DOM readout in the game: vitals, ammunition, money, the clock, the
// score, the kill feed, banners, the buy panel, the channel bar, damage and
// flash feedback and the marksman's scope. One sync() per frame copies the
// state into the page, writing only what changed; events (kills, banners,
// radio calls) arrive through their own small methods.
import { S, CFG, currentWeapon, teamAlive, angleDelta } from './state.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const els = {
    hud: $('hud'), health: $('health'), healthFill: $('health-fill'), armor: $('armor'),
    money: $('money'), ammo: $('ammo'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'), grenades: $('grenades'),
    timer: $('timer'), scoreAtk: $('score-atk'), scoreDef: $('score-def'), alive: $('alive'),
    bombbar: $('bombbar'), bombFill: $('bomb-fill'), bombLabel: $('bomb-label'),
    feed: $('feed'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    channel: $('channel'), channelFill: $('channel-fill'), channelLabel: $('channel-label'),
    hint: $('hint'), buymenu: $('buymenu'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    dmg: $('dmg'), dmgArc: $('dmg-arc'), flashfx: $('flashfx'), scope: $('scope'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'), play: $('play'),
  };
  const buyRows = new Map();
  for (const row of els.buymenu.querySelectorAll('.row')) buyRows.set(row.dataset.item, row);

  let bannerUntil = 0;
  let markerUntil = 0;
  let dmgUntil = 0;
  let dmgYaw = 0;
  let flashLevel = 0;
  let flashDecay = 1;
  let lastPhase = '';
  const feedItems = []; // { el, until }
  const cache = new Map();
  function setText(el, key, value) {
    if (cache.get(key) !== value) {
      cache.set(key, value);
      el.textContent = value;
    }
  }
  function fmtClock(t) {
    const s = Math.max(0, Math.ceil(t));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  const api = {
    els,
    onPlay(cb) {
      els.play.addEventListener('click', cb);
    },
    showOverlay(kind, won) {
      els.overlay.hidden = false;
      if (kind === 'start') {
        els.overlayTitle.innerHTML = 'SALT<span>LINE</span>';
        els.play.textContent = 'Click to play';
      } else if (kind === 'pause') {
        els.overlayTitle.textContent = 'Paused';
        els.overlayCopy.textContent = 'The round waits for no one — except now. Click to jump back in.';
        els.play.textContent = 'Resume';
      } else if (kind === 'end') {
        els.overlayTitle.textContent = won ? 'THE WORKS IS YOURS' : 'THE WARDENS HOLD';
        els.overlayCopy.textContent = `Final score — Jackals ${S.scores.atk}, Wardens ${S.scores.def}. The salt, the kilns and the pump house change hands tonight.`;
        els.play.textContent = 'Play again';
      }
    },
    hideOverlay() {
      els.overlay.hidden = true;
    },
    showMatchEnd(won) {
      api.showOverlay('end', won);
      if (document.pointerLockElement) document.exitPointerLock();
    },
    banner(title, sub = '') {
      els.bannerTitle.textContent = title;
      els.bannerSub.textContent = sub;
      els.banner.classList.add('on');
      bannerUntil = performance.now() + 2600;
    },
    killfeed(text, cls = 'sys') {
      const div = document.createElement('div');
      div.className = cls;
      div.textContent = text;
      els.feed.appendChild(div);
      feedItems.push({ el: div, until: performance.now() + 5200 });
      while (feedItems.length > 6) {
        const old = feedItems.shift();
        old.el.remove();
      }
    },
    clearFeed() {
      for (const item of feedItems) item.el.remove();
      feedItems.length = 0;
    },
    radio(from, text) {
      api.killfeed(`📻 ${from}: ${text}`, 'radio');
    },
    hitmarker(kill) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', !!kill);
      markerUntil = performance.now() + (kill ? 220 : 110);
    },
    damageFrom(worldYaw) {
      dmgYaw = worldYaw;
      dmgUntil = performance.now() + 700;
      els.dmg.style.opacity = '1';
    },
    flash(strength) {
      flashLevel = Math.min(1, Math.max(flashLevel, strength));
      flashDecay = 0.25 + strength * 0.3; // a full flash takes seconds to clear
      els.flashfx.style.opacity = String(flashLevel);
    },
    // One call per rendered frame: copy state into the page.
    sync(viewYaw, spreadPx) {
      const p = S.player;
      const now = performance.now();
      els.hud.hidden = S.phase === 'menu';
      if (bannerUntil && now > bannerUntil) {
        els.banner.classList.remove('on');
        bannerUntil = 0;
      }
      if (markerUntil && now > markerUntil) {
        els.hitmarker.classList.remove('on');
        markerUntil = 0;
      }
      if (dmgUntil && now > dmgUntil) {
        els.dmg.style.opacity = '0';
        els.dmgArc.style.opacity = '0';
        dmgUntil = 0;
      } else if (dmgUntil) {
        const rel = angleDelta(viewYaw, dmgYaw);
        els.dmgArc.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
        els.dmgArc.style.opacity = '1';
      }
      if (flashLevel > 0) {
        flashLevel = Math.max(0, flashLevel - 0.016 * flashDecay * 3.2);
        els.flashfx.style.opacity = String(flashLevel);
      }
      for (let i = feedItems.length - 1; i >= 0; i -= 1) {
        if (now > feedItems[i].until) {
          feedItems[i].el.remove();
          feedItems.splice(i, 1);
        }
      }
      if (!p) return;
      // Vitals and kit.
      setText(els.health, 'hp', String(Math.max(0, Math.ceil(p.health))));
      els.health.classList.toggle('low', p.health <= 30);
      els.healthFill.style.width = `${Math.max(0, p.health)}%`;
      setText(els.armor, 'armor', p.hasArmor ? `🛡 VEST ${Math.ceil(p.armor)}` : '');
      setText(els.money, 'money', `$${p.money.toLocaleString('en-US')}`);
      const ws = currentWeapon(p);
      if (ws) {
        setText(els.ammoMag, 'mag', String(ws.mag));
        setText(els.ammoReserve, 'res', `/ ${ws.reserve}`);
        setText(els.weaponName, 'wname', ws.reloading ? `${ws.def.name} — RELOADING` : ws.def.name);
        els.ammo.classList.toggle('empty', ws.mag === 0);
      } else {
        setText(els.ammoMag, 'mag', '—');
        setText(els.ammoReserve, 'res', '');
        setText(els.weaponName, 'wname', `${p.grenadeType.toUpperCase()} CHARGE IN HAND`);
        els.ammo.classList.remove('empty');
      }
      const g = p.grenades;
      setText(els.grenades, 'nades', `FRAG ${g.he} · FLASH ${g.flash} · SMOKE ${g.smoke}${S.bomb.carrier === p ? ' · ◆ CHARGE' : ''}`);
      els.crosshair.style.setProperty('--gap', `${Math.round(spreadPx)}px`);
      els.scope.hidden = !(p.scoped && p.alive);
      els.crosshair.style.visibility = p.scoped ? 'hidden' : 'visible';
      // Clock and score.
      setText(els.scoreAtk, 'sa', String(S.scores.atk));
      setText(els.scoreDef, 'sd', String(S.scores.def));
      setText(els.alive, 'alive', `${teamAlive('atk')} v ${teamAlive('def')}`);
      if (S.phase === 'buy') setText(els.timer, 'timer', `BUY ${fmtClock(S.phaseT)}`);
      else if (S.phase === 'planted') setText(els.timer, 'timer', fmtClock(S.bomb.timer));
      else setText(els.timer, 'timer', fmtClock(S.phaseT));
      els.timer.classList.toggle('hot', (S.phase === 'planted' && S.bomb.timer < 10) || (S.phase === 'live' && S.phaseT < 15));
      // The planted charge's own bar.
      const planted = S.bomb.state === 'planted';
      els.bombbar.hidden = !planted;
      if (planted) {
        els.bombFill.style.width = `${(S.bomb.timer / CFG.bombTime) * 100}%`;
        setText(els.bombLabel, 'blabel', `CHARGE AT SITE ${S.bomb.site} — ${fmtClock(S.bomb.timer)}`);
      }
      // Channel progress and the plant hint.
      const ch = S.bomb.channel;
      if (ch) {
        els.channel.hidden = false;
        els.channelFill.style.width = `${(ch.t / ch.need) * 100}%`;
        setText(els.channelLabel, 'chlabel', ch.kind === 'plant' ? 'PLANTING THE CHARGE' : ch.actor.isPlayer ? 'DEFUSING' : 'THE WARDENS ARE DEFUSING');
      } else els.channel.hidden = true;
      // Context hint: plant, pick up, buy.
      let hint = '';
      if (S.phase === 'live' && p.alive && S.bomb.carrier === p) {
        for (const key of ['A', 'B']) {
          const s = S.worldSites[key];
          if (Math.hypot(p.x - s.x, p.z - s.z) < s.r) hint = 'Hold E to plant the charge';
        }
      }
      if (S.phase === 'buy') hint = 'Buy phase — the round starts when the clock runs out';
      if (!p.alive && (S.phase === 'live' || S.phase === 'planted')) hint = 'You are down — your Jackals fight on';
      setText(els.hint, 'hint', hint);
      els.hint.hidden = !hint;
      // The buy panel.
      const buying = S.phase === 'buy';
      if (buying !== (lastPhase === 'buy')) els.buymenu.hidden = !buying;
      if (buying) refreshBuy(p);
      lastPhase = S.phase;
    },
  };

  function refreshBuy(p) {
    const price = { smg: 1100, shotgun: 1200, rifle: 2500, sniper: 4300, armor: 650, he: 300, flash: 200, smoke: 300, ammo: 100 };
    for (const [id, row] of buyRows) {
      const owned =
        (id === 'armor' && p.hasArmor && p.armor >= 100) ||
        (['smg', 'shotgun', 'rifle', 'sniper'].includes(id) && p.weapons.primary && p.weapons.primary.def.id === id) ||
        (id === 'he' && p.grenades.he >= 1) || (id === 'flash' && p.grenades.flash >= 2) || (id === 'smoke' && p.grenades.smoke >= 1);
      row.classList.toggle('owned', owned);
      row.classList.toggle('cant', !owned && p.money < price[id]);
      const priceEl = row.querySelector('.price');
      priceEl.textContent = owned ? 'OWNED' : `$${price[id].toLocaleString('en-US')}`;
    }
  }

  return api;
}
