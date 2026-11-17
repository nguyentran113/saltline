// The match itself: phases (buy, live, planted, over), the round clock, the
// charge — carried, dropped, planted, defused or detonated — the money, and
// the buy menu's rules. Kills and plants arrive through hooks from combat.js;
// this module decides what they mean for the score and starts whatever comes
// next. First to seven rounds takes the match.
import { S, CFG, teamAlive } from './state.js';
import { WEAPONS, GRENADES, makeWeaponState } from './weapons.js';

export function createRounds(world, bots, combat, hud, audio) {
  let playerDied = false;
  let nextBeep = 0;

  function startMatch() {
    S.scores.atk = 0;
    S.scores.def = 0;
    S.lossStreak.atk = 0;
    S.lossStreak.def = 0;
    S.round = 0;
    S.matchWinner = null;
    for (const a of S.actors) {
      a.money = CFG.startMoney;
      a.kills = 0;
      a.deaths = 0;
    }
    playerDied = true; // first round starts from a clean pistol, like any death
    startRound();
  }

  function startRound() {
    S.round += 1;
    S.phase = 'buy';
    S.phaseT = CFG.buyTime;
    S.winner = null;
    S.winReason = '';
    S.plan.site = S.rng() < 0.5 ? 'A' : 'B';
    S.bomb.state = 'carried';
    S.bomb.carrier = S.player;
    S.bomb.site = null;
    S.bomb.timer = 0;
    S.bomb.channel = null;
    S.noises.length = 0;
    // The player: back to full health at the dock spawn. Dying last round
    // costs the loadout; surviving keeps it, magazines topped from reserve.
    const p = S.player;
    const spawn = world.spawns.atk[0];
    p.x = spawn[0]; p.z = spawn[1]; p.y = 0;
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.yaw = 0; p.pitch = 0;
    p.alive = true;
    p.health = 100;
    p.crouch = false;
    p.blindUntil = 0;
    p.drawT = 0;
    if (playerDied) {
      p.weapons.primary = null;
      p.weapons.sidearm = makeWeaponState(WEAPONS.pistol);
      p.slot = 'sidearm';
      p.grenades = { he: 0, flash: 0, smoke: 0 };
      p.hasArmor = false;
      p.armor = 0;
    } else {
      for (const ws of [p.weapons.primary, p.weapons.sidearm]) {
        if (!ws) continue;
        const take = Math.min(ws.def.magSize - ws.mag, ws.reserve);
        ws.mag += take;
        ws.reserve -= take;
        ws.reloading = false;
      }
      if (!p.weapons.primary && p.slot === 'primary') p.slot = 'sidearm';
    }
    playerDied = false;
    bots.resetForRound();
    hud.banner(`ROUND ${S.round}`, S.round === 1 ? 'First to 7 takes the Works' : `Jackals ${S.scores.atk} — ${S.scores.def} Wardens`);
    hud.killfeed(`— Round ${S.round} · the call is site ${S.plan.site} —`, 'sys');
  }

  function endRound(winner, reason) {
    if (S.phase === 'over' || S.phase === 'matchover') return;
    S.phase = 'over';
    S.phaseT = CFG.endTime;
    S.winner = winner;
    S.winReason = reason;
    S.scores[winner] += 1;
    S.bomb.channel = null;
    // Income: winners paid in full; losers get the loss bonus, which grows
    // with their streak. Only the player's purse is tracked to the dollar —
    // the bots' loadouts follow the round table in bots.js.
    const p = S.player;
    const loser = winner === 'atk' ? 'def' : 'atk';
    S.lossStreak[winner] = 0;
    S.lossStreak[loser] += 1;
    if (p.team === winner) p.money = Math.min(CFG.maxMoney, p.money + CFG.winReward);
    else {
      const bonus = Math.min(CFG.lossCap, CFG.lossBase + CFG.lossStep * (S.lossStreak[loser] - 1));
      p.money = Math.min(CFG.maxMoney, p.money + bonus);
    }
    if (!p.alive) playerDied = true;
    hud.banner(winner === p.team ? 'ROUND WON' : 'ROUND LOST', reason);
    audio.sting(winner === p.team);
    if (S.scores.atk >= CFG.roundsToWin || S.scores.def >= CFG.roundsToWin) {
      S.matchWinner = S.scores.atk >= CFG.roundsToWin ? 'atk' : 'def';
    }
  }

  function onKill(victim, attacker, part) {
    hud.killfeed(
      attacker
        ? `${attacker.name}  ▸  ${victim.name}${part === 'head' ? '  (headshot)' : ''}`
        : `${victim.name}  ▸  caught in the blast`,
      victim.team === 'atk' ? 'atk' : 'def',
    );
    if (attacker && attacker.isPlayer && attacker.team !== victim.team) {
      attacker.money = Math.min(CFG.maxMoney, attacker.money + CFG.killReward);
    }
    if (victim === S.bomb.carrier && S.bomb.state === 'carried') {
      S.bomb.state = 'dropped';
      S.bomb.x = victim.x;
      S.bomb.z = victim.z;
      S.bomb.carrier = null;
      S.bomb.channel = null;
      hud.killfeed('— The charge is down —', 'sys');
    }
    if (victim.brain && victim.brain.role === 'defuse') {
      victim.brain.role = 'hold';
      if (S.bomb.channel && S.bomb.channel.actor === victim) S.bomb.channel = null;
    }
    if (victim.isPlayer) audio.hurt();
    if (S.bomb.state === 'exploded') return;
    if (S.phase === 'live') {
      if (teamAlive('def') === 0) endRound('atk', 'Wardens eliminated');
      else if (teamAlive('atk') === 0) endRound('def', 'Jackals eliminated');
    } else if (S.phase === 'planted') {
      if (teamAlive('def') === 0) endRound('atk', 'Wardens eliminated');
      // Attackers wiped with the charge down: the round plays out on the timer.
    }
  }

  function designateDefuser() {
    let best = null, bestD = Infinity;
    for (const a of S.actors) {
      if (a.team !== 'def' || !a.alive || a.isPlayer) continue;
      const d = Math.hypot(a.x - S.bomb.x, a.z - S.bomb.z);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) bots.makeDefuser(best);
    return best;
  }

  function plantComplete(carrier) {
    const site = S.plan.site && Math.hypot(carrier.x - world.sites[S.plan.site].x, carrier.z - world.sites[S.plan.site].z) < world.sites[S.plan.site].r
      ? S.plan.site
      : (Math.hypot(carrier.x - world.sites.A.x, carrier.z - world.sites.A.z) < world.sites.A.r ? 'A' : 'B');
    S.bomb.state = 'planted';
    S.bomb.site = site;
    S.bomb.x = carrier.x;
    S.bomb.z = carrier.z;
    S.bomb.carrier = null;
    S.bomb.channel = null;
    S.bomb.timer = CFG.bombTime;
    S.phase = 'planted';
    nextBeep = 0;
    if (S.player.team === 'atk') S.player.money = Math.min(CFG.maxMoney, S.player.money + CFG.plantReward);
    hud.banner('CHARGE PLANTED', `Site ${site} — ${world.sites[site].name}`);
    hud.killfeed(`— Charge planted at site ${site} —`, 'sys');
    audio.plantStart();
    designateDefuser();
  }

  // Channel progress for planting (carrier standing in a site) and defusing
  // (the designated Warden at the charge). The player plants by holding E;
  // a bot plants whenever it stands in the site with the charge.
  function updateChannels(dt) {
    const bomb = S.bomb;
    if (S.phase === 'live' && bomb.state === 'carried' && bomb.carrier && bomb.carrier.alive) {
      const carrier = bomb.carrier;
      let inSite = null;
      for (const key of ['A', 'B']) {
        const s = world.sites[key];
        if (Math.hypot(carrier.x - s.x, carrier.z - s.z) < s.r) inSite = key;
      }
      const wants = inSite && (carrier.isPlayer ? S.channelHeld : true);
      if (wants) {
        if (!bomb.channel || bomb.channel.actor !== carrier) {
          bomb.channel = { actor: carrier, kind: 'plant', t: 0, need: CFG.plantTime };
          if (carrier.isPlayer) audio.plantStart();
        }
        bomb.channel.t += dt;
        if (bomb.channel.t >= bomb.channel.need) {
          plantComplete(carrier);
          return;
        }
      } else if (bomb.channel && bomb.channel.kind === 'plant') bomb.channel = null;
    }
    if (S.phase === 'planted' && bomb.state === 'planted') {
      // Keep a living defuser designated.
      let defuser = S.actors.find((a) => a.brain && a.brain.role === 'defuse' && a.alive);
      if (!defuser) defuser = designateDefuser();
      if (defuser && Math.hypot(defuser.x - bomb.x, defuser.z - bomb.z) < 1.8) {
        if (!bomb.channel || bomb.channel.actor !== defuser) {
          bomb.channel = { actor: defuser, kind: 'defuse', t: 0, need: CFG.defuseTime };
        }
        bomb.channel.t += dt;
        if (bomb.channel.t >= bomb.channel.need) {
          bomb.state = 'defused';
          bomb.channel = null;
          endRound('def', 'Charge defused');
        }
      } else if (bomb.channel && bomb.channel.kind === 'defuse') bomb.channel = null;
    }
  }

  function update(dt) {
    if (S.phase === 'buy') {
      S.phaseT -= dt;
      if (S.phaseT <= 0) {
        S.phase = 'live';
        S.phaseT = CFG.roundTime;
        hud.banner('LIVE', `Plant the charge at site ${S.plan.site}`);
      }
      return;
    }
    if (S.phase === 'live') {
      S.phaseT -= dt;
      updateChannels(dt);
      // A dropped charge is picked up by the first Jackal to reach it.
      if (S.bomb.state === 'dropped') {
        for (const a of S.actors) {
          if (a.team !== 'atk' || !a.alive) continue;
          if (Math.hypot(a.x - S.bomb.x, a.z - S.bomb.z) < 1.4) {
            S.bomb.state = 'carried';
            S.bomb.carrier = a;
            if (!a.isPlayer) bots.makeCarrier(a);
            hud.killfeed(`— ${a.name} has the charge —`, 'sys');
            break;
          }
        }
      }
      if (S.phase === 'live' && S.phaseT <= 0) endRound('def', 'Time — the Wardens held the Works');
      return;
    }
    if (S.phase === 'planted') {
      S.bomb.timer -= dt;
      updateChannels(dt);
      if (S.phase !== 'planted') return;
      // The beep quickens as the timer runs down.
      nextBeep -= dt;
      if (nextBeep <= 0) {
        audio.beep(S.bomb.timer < 5);
        nextBeep = S.bomb.timer > 10 ? 1 : S.bomb.timer > 5 ? 0.5 : 0.25;
      }
      if (S.bomb.timer <= 0) {
        S.bomb.state = 'exploded';
        combat.explodeCharge(S.bomb.x, S.bomb.z);
        if (S.phase === 'planted') endRound('atk', 'Charge detonated');
      }
      return;
    }
    if (S.phase === 'over') {
      S.phaseT -= dt;
      if (S.phaseT <= 0) {
        if (S.matchWinner) {
          S.phase = 'matchover';
          hud.showMatchEnd(S.matchWinner === S.player.team);
        } else startRound();
      }
    }
  }

  // The buy menu's rules. Returns true when the purchase went through.
  function buy(id) {
    const p = S.player;
    if (S.phase !== 'buy' || !p.alive) return false;
    if (id === 'armor') {
      if (p.hasArmor && p.armor >= 100 || p.money < 650) return false;
      p.money -= 650;
      p.hasArmor = true;
      p.armor = 100;
      return true;
    }
    if (id === 'ammo') {
      if (p.money < 100) return false;
      let changed = false;
      for (const ws of [p.weapons.primary, p.weapons.sidearm]) {
        if (ws && ws.reserve < ws.def.reserveStart) { ws.reserve = ws.def.reserveStart; changed = true; }
      }
      if (!changed) return false;
      p.money -= 100;
      return true;
    }
    if (GRENADES[id]) {
      const caps = { he: 1, flash: 2, smoke: 1 };
      if (p.grenades[id] >= caps[id] || p.money < GRENADES[id].price) return false;
      p.money -= GRENADES[id].price;
      p.grenades[id] += 1;
      return true;
    }
    const def = WEAPONS[id];
    if (def && def.slot === 'primary') {
      if (p.money < def.price) return false;
      if (p.weapons.primary && p.weapons.primary.def.id === id) return false;
      p.money -= def.price;
      p.weapons.primary = makeWeaponState(def);
      p.slot = 'primary';
      p.drawT = 0.35;
      return true;
    }
    return false;
  }

  return { startMatch, startRound, update, buy, onKill };
}
