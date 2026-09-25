// Entry point: menus, the fixed-timestep game loop and event plumbing
// between the simulation, renderer, audio and HUD.

import { Vector3 } from '../vendor/three.js';
import { Game, TICK } from './sim/game.js';
import { buildMap } from './sim/map.js';
import { NavGraph } from './sim/nav.js';
import { Renderer } from './render/renderer.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Hud, CROSSHAIR_COUNT } from './hud.js';
import { loadSettings, saveSettings } from './settings.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;

const settings = loadSettings();
const map = buildMap();
const nav = new NavGraph(map);
const canvas = $('game');

let renderer;
try {
  renderer = new Renderer(canvas, map, settings);
} catch (err) {
  $('loading').innerHTML = `<div class="error">WebGL is not available in this browser.<br><small>${String(err.message || err)}</small></div>`;
  throw err;
}
const audio = new Audio(settings);
const input = new Input(canvas, settings);
const hud = new Hud(settings);

// mode: 'menu' (bots fight in the background), 'play', 'paused', 'over'
let mode = 'menu';
let game = null;

function demoGame() {
  return new Game({ map, nav, spectator: true, botCount: 5, skill: 3, fragLimit: 0, timeLimit: 0 });
}

function setGame(g) {
  game = g;
  renderer.setGame(g);
  hud.reset();
}

setGame(demoGame());
// skip the demo's countdown
game.time = game.phaseEnd;

// ---- menus ----------------------------------------------------------------

function show(id, on) {
  $(id).classList.toggle('hidden', !on);
}

function startMatch() {
  audio.init();
  readMenu();
  saveSettings(settings);
  renderer.setViewColor(settings.color);
  setGame(
    new Game({
      map,
      nav,
      botCount: settings.bots,
      skill: settings.skill,
      fragLimit: settings.fragLimit,
      timeLimit: settings.timeLimit * 60,
      playerName: settings.name.trim() || 'Player',
      playerColor: settings.color,
    }),
  );
  mode = 'play';
  show('menu', false);
  show('pause', false);
  show('intermission', false);
  hud.show(true);
  input.enabled = true;
  input.lock();
}

function toMenu() {
  mode = 'menu';
  input.enabled = false;
  input.unlock();
  setGame(demoGame());
  game.time = game.phaseEnd;
  hud.show(false);
  show('pause', false);
  show('intermission', false);
  show('scoreboard', false);
  show('menu', true);
}

function pause() {
  if (mode !== 'play') return;
  mode = 'paused';
  show('pause', true);
}

function resume() {
  if (mode !== 'paused') return;
  audio.init();
  mode = 'play';
  show('pause', false);
  input.lock();
}

input.onLockChange = (locked, failed) => {
  if (!locked && mode === 'play' && game.phase !== 'intermission') pause();
  if (failed && mode === 'play') pause();
};

input.onLook = (dx, dy) => {
  if (mode !== 'play' || !game.local || !game.local.alive || game.phase === 'intermission') return;
  const zoomScale = input.zoom ? 30 / settings.fov : 1;
  const k = settings.sensitivity * 0.022 * DEG * zoomScale;
  const ps = game.local.ps;
  ps.yaw -= dx * k;
  ps.pitch -= dy * k * (settings.invert ? -1 : 1);
  ps.pitch = Math.max(-89 * DEG, Math.min(89 * DEG, ps.pitch));
  if (ps.yaw > Math.PI) ps.yaw -= Math.PI * 2;
  if (ps.yaw < -Math.PI) ps.yaw += Math.PI * 2;
};

input.onKey = (code) => {
  if (code === 'KeyF' && mode === 'play') settings.showFps = !settings.showFps;
};

// settings form <-> settings object
const SLIDERS = [
  ['opt-sens', 'sensitivity', (v) => v.toFixed(1)],
  ['opt-fov', 'fov', (v) => `${v}°`],
  ['opt-volume', 'volume', (v) => `${Math.round(v * 100)}%`],
];
const CHECKS = [
  ['opt-invert', 'invert'],
  ['opt-announcer', 'announcer'],
  ['opt-bloom', 'bloom'],
  ['opt-speed', 'showSpeed'],
  ['opt-fps', 'showFps'],
  ['opt-gun', 'drawGun'],
];

function writeMenu() {
  $('opt-name').value = settings.name;
  $('opt-bots').value = settings.bots;
  $('opt-skill').value = settings.skill;
  $('opt-frag').value = settings.fragLimit;
  $('opt-time').value = settings.timeLimit;
  $('opt-quality').value = settings.quality;
  for (const [id, key, fmt] of SLIDERS) {
    $(id).value = settings[key];
    $(id + '-v').textContent = fmt(settings[key]);
  }
  for (const [id, key] of CHECKS) $(id).checked = settings[key];
  document.querySelectorAll('.swatches button').forEach((b) => b.classList.toggle('on', b.dataset.color === settings.color));
  document.querySelectorAll('.xhair button').forEach((b) => b.classList.toggle('on', +b.dataset.idx === settings.crosshair));
}

function readMenu() {
  settings.name = $('opt-name').value.slice(0, 16);
  settings.bots = +$('opt-bots').value;
  settings.skill = +$('opt-skill').value;
  settings.fragLimit = +$('opt-frag').value;
  settings.timeLimit = +$('opt-time').value;
  settings.quality = $('opt-quality').value;
  for (const [id, key] of SLIDERS) settings[key] = +$(id).value;
  for (const [id, key] of CHECKS) settings[key] = $(id).checked;
}

function buildMenu() {
  const colors = ['#33ff77', '#ff3b3b', '#3bb4ff', '#ffd23b', '#ff3bf2', '#3bffe8', '#ff8a1f', '#b46bff', '#f0f0f0'];
  $('swatches').innerHTML = colors.map((c) => `<button type="button" data-color="${c}" style="--c:${c}" aria-label="Rail colour ${c}"></button>`).join('');
  $('swatches').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.color = b.dataset.color;
    renderer.setViewColor(settings.color);
    writeMenu();
    saveSettings(settings);
  });
  $('xhair').innerHTML = Array.from({ length: CROSSHAIR_COUNT }, (_, i) => `<button type="button" data-idx="${i}" aria-label="Crosshair ${i + 1}"></button>`).join('');
  const prev = settings.crosshair;
  document.querySelectorAll('.xhair button').forEach((b) => {
    settings.crosshair = +b.dataset.idx;
    hud.applyCrosshair();
    b.innerHTML = $('crosshair').innerHTML;
  });
  settings.crosshair = prev;
  hud.applyCrosshair();
  $('xhair').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings.crosshair = +b.dataset.idx;
    hud.applyCrosshair();
    writeMenu();
    saveSettings(settings);
  });
  for (const [id, key, fmt] of SLIDERS) {
    $(id).addEventListener('input', () => {
      settings[key] = +$(id).value;
      $(id + '-v').textContent = fmt(settings[key]);
      if (key === 'volume') audio.applyVolume();
      saveSettings(settings);
    });
  }
  for (const [id, key] of CHECKS) {
    $(id).addEventListener('change', () => {
      settings[key] = $(id).checked;
      saveSettings(settings);
    });
  }
  for (const id of ['opt-name', 'opt-bots', 'opt-skill', 'opt-frag', 'opt-time']) {
    $(id).addEventListener('change', () => {
      readMenu();
      saveSettings(settings);
    });
  }
  $('opt-quality').addEventListener('change', () => {
    readMenu();
    saveSettings(settings);
    $('quality-note').textContent = 'Applies after reloading the page.';
  });
  $('btn-fight').addEventListener('click', startMatch);
  $('btn-resume').addEventListener('click', resume);
  $('btn-restart').addEventListener('click', startMatch);
  $('btn-quit').addEventListener('click', toMenu);
  $('btn-again').addEventListener('click', startMatch);
  $('btn-menu').addEventListener('click', toMenu);
  $('btn-settings').addEventListener('click', () => {
    show('pause', false);
    show('menu', true);
    $('menu').classList.add('from-pause');
  });
  $('btn-back').addEventListener('click', () => {
    readMenu();
    saveSettings(settings);
    $('menu').classList.remove('from-pause');
    show('menu', false);
    show('pause', true);
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && mode === 'menu' && !$('menu').classList.contains('hidden') && document.activeElement?.tagName !== 'INPUT') startMatch();
  });
  writeMenu();
}
buildMenu();

// ---- events -----------------------------------------------------------------

const VOICE = { excellent: 'Excellent!', impressive: 'Impressive!' };

function handleEvents() {
  const local = game.local;
  const playing = mode === 'play' || mode === 'over';
  for (const ev of game.events) {
    renderer.handleEvent(ev);
    if (playing) hud.handleEvent(ev, game);
    if (!playing) continue;
    const p = ev.player;
    const mine = p && p === local;
    const at = p ? (mine ? null : p.ps.origin) : null;
    switch (ev.type) {
      case 'rail':
        audio.play('rail', mine ? null : ev.start, mine ? 0.8 : 1);
        break;
      case 'frag':
        audio.play('gib', ev.victim === local ? null : ev.pos, 0.9);
        if (ev.attacker && ev.attacker === local) audio.play('hit', null, 0.8);
        break;
      case 'jump':
        audio.play('jump', at, mine ? 0.35 : 0.5);
        break;
      case 'land':
        audio.play('land', at, mine ? 0.5 : 0.6);
        break;
      case 'footstep':
        audio.play('steps', at, mine ? 0.18 : 0.4, 0.9 + Math.random() * 0.2);
        break;
      case 'pad':
        audio.play('pad', at, 0.9);
        break;
      case 'spawn':
        if (!ev.initial) audio.play('spawn', at, 0.6);
        break;
      case 'countdown':
        audio.play('beep', null, 0.6);
        audio.announce(String(ev.n));
        break;
      case 'announce':
        if (ev.text === 'FIGHT!') audio.play('fight', null, 0.7);
        audio.announce(ev.voice || ev.text);
        break;
      case 'award':
        if (mine) {
          audio.play('award', null, 0.7);
          audio.announce(VOICE[ev.kind]);
        }
        break;
      case 'phase':
        if (ev.phase === 'intermission') onIntermission(ev);
        break;
    }
  }
  game.events.length = 0;
}

function onIntermission(ev) {
  if (mode !== 'play') return;
  mode = 'over';
  input.unlock();
  const local = game.local;
  const won = ev.winner === local;
  $('im-title').textContent = won ? 'YOU WIN' : `${ev.winner.name.toUpperCase()} WINS`;
  $('im-title').style.color = won ? '' : ev.winner.color;
  const { rank } = game.rankOf(local);
  $('im-sub').textContent = `${ev.reason} · you finished ${['', '1st', '2nd', '3rd'][rank] || rank + 'th'} with ${local.score} frag${local.score === 1 ? '' : 's'}`;
  audio.announce(won ? 'You win!' : 'You lose.');
  setTimeout(() => {
    if (mode === 'over') show('intermission', true);
  }, 1200);
}

// ---- main loop ----------------------------------------------------------------

let last = performance.now();
let acc = 0;
const fwd = new Vector3();

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const running = mode !== 'paused';
  if (running) {
    acc += dt;
    let steps = 0;
    while (acc >= TICK && steps < 30) {
      const cmd = mode === 'play' && input.locked ? input.cmd() : null;
      game.step(TICK, cmd);
      handleEvents();
      acc -= TICK;
      steps++;
    }
  } else {
    dt = 0;
  }
  renderer.render(running ? acc / TICK : 1, dt, { spectate: mode === 'menu', zoom: mode === 'play' && input.zoom });
  if (mode === 'play' || mode === 'over') hud.update(game, dt, { zoom: mode === 'play' && input.zoom, scores: input.scores });
  const cam = renderer.camera;
  cam.getWorldDirection(fwd);
  audio.setListener(cam.position, fwd);
}

$('loading').remove();
show('menu', true);
requestAnimationFrame(frame);

// small debug handle for the console / automated tests
window.__instagib = {
  get game() {
    return game;
  },
  get mode() {
    return mode;
  },
  renderer,
  input,
  settings,
  startMatch,
  toMenu,
  // lets automated tests play without pointer lock
  forcePlay() {
    mode = 'play';
    input.enabled = true;
    input.locked = true;
    show('pause', false);
  },
};
