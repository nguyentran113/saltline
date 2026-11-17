// All sound is synthesised with WebAudio — no audio files, so the game stays
// self-contained and offline. Short filtered-noise bursts and oscillator blips,
// shaped per event. The context unlocks on the first user gesture (the Play
// click); every call is a no-op before that, and distance fades gunfire so a
// player can hear roughly where a fight is.
export function createAudio() {
  let ctx = null;
  let master = null;

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
    }
  }

  function noiseBurst({ at = 0, dur = 0.12, freq = 1800, q = 0.8, gain = 0.5, type = 'lowpass' }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t0);
  }

  function blip({ at = 0, dur = 0.08, freq = 880, gain = 0.2, type = 'square', slide = 0 }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const fade = (distance) => Math.max(0.04, 1 / (1 + distance * 0.09));

  return {
    unlock,
    shot(kind, distance = 0) {
      const g = fade(distance);
      if (kind === 'pistol') noiseBurst({ dur: 0.09, freq: 2400, gain: 0.5 * g });
      else if (kind === 'smg') noiseBurst({ dur: 0.07, freq: 2800, gain: 0.42 * g });
      else if (kind === 'rifle') {
        noiseBurst({ dur: 0.13, freq: 1700, gain: 0.62 * g });
        noiseBurst({ dur: 0.2, freq: 300, gain: 0.3 * g });
      } else if (kind === 'shotgun') {
        noiseBurst({ dur: 0.24, freq: 1100, gain: 0.8 * g });
        noiseBurst({ dur: 0.3, freq: 240, gain: 0.4 * g });
      } else if (kind === 'sniper') {
        noiseBurst({ dur: 0.3, freq: 1300, gain: 0.85 * g });
        noiseBurst({ dur: 0.45, freq: 180, gain: 0.5 * g });
      }
    },
    dryFire() {
      blip({ dur: 0.04, freq: 1400, gain: 0.12 });
    },
    reload() {
      blip({ dur: 0.05, freq: 500, gain: 0.15, type: 'square' });
      blip({ at: 0.22, dur: 0.05, freq: 750, gain: 0.15, type: 'square' });
    },
    draw() {
      noiseBurst({ dur: 0.05, freq: 3200, gain: 0.1, type: 'highpass' });
    },
    hit(kill) {
      blip({ dur: 0.05, freq: kill ? 1560 : 1180, gain: 0.22, type: 'sine' });
      if (kill) blip({ at: 0.06, dur: 0.09, freq: 1980, gain: 0.2, type: 'sine' });
    },
    hurt() {
      noiseBurst({ dur: 0.1, freq: 500, gain: 0.3 });
    },
    throwWhoosh() {
      noiseBurst({ dur: 0.16, freq: 900, gain: 0.12, type: 'bandpass' });
    },
    explosion() {
      noiseBurst({ dur: 0.9, freq: 160, gain: 1.0 });
      noiseBurst({ dur: 0.5, freq: 700, gain: 0.5 });
      blip({ dur: 0.5, freq: 90, gain: 0.5, type: 'sine', slide: -50 });
    },
    flashPop() {
      noiseBurst({ dur: 0.18, freq: 4000, gain: 0.5, type: 'highpass' });
      blip({ dur: 0.3, freq: 5200, gain: 0.1, type: 'sine' });
    },
    beep(final) {
      blip({ dur: final ? 0.4 : 0.09, freq: final ? 1320 : 990, gain: 0.22, type: 'square' });
    },
    plantStart() {
      blip({ dur: 0.06, freq: 700, gain: 0.15, type: 'square' });
      blip({ at: 0.1, dur: 0.06, freq: 940, gain: 0.15, type: 'square' });
    },
    click() {
      blip({ dur: 0.04, freq: 1050, gain: 0.14, type: 'square' });
    },
    denied() {
      blip({ dur: 0.09, freq: 220, gain: 0.16, type: 'square' });
    },
    sting(win) {
      const base = win ? 660 : 392;
      blip({ dur: 0.14, freq: base, gain: 0.2, type: 'triangle' });
      blip({ at: 0.13, dur: 0.14, freq: base * (win ? 1.25 : 0.84), gain: 0.2, type: 'triangle' });
      blip({ at: 0.26, dur: 0.3, freq: base * (win ? 1.5 : 0.66), gain: 0.22, type: 'triangle' });
    },
    step(distance) {
      noiseBurst({ dur: 0.05, freq: 700, gain: 0.1 * fade(distance) });
    },
  };
}
