import './style.css';
import { Sound } from './audio';
import { Game, SHED_COOLDOWN_MS, SHED_MIN_LENGTH } from './game/engine';
import { MODES, MODE_ORDER } from './game/modes';
import { dailySeed, todayKey } from './game/rng';
import type { DeathCause, Dir, EffectKind, ModeId } from './game/types';
import { bindInput, pressButton } from './input';
import { PALETTES, POWER_LABEL, Renderer } from './render';
import { load, save, type SaveData } from './storage';

type Screen = 'menu' | 'play' | 'pause' | 'over' | 'settings' | 'help';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const data: SaveData = load();
const sound = new Sound();
const canvas = $<HTMLCanvasElement>('board');
const stage = $('stage');
const renderer = new Renderer(canvas);

let game: Game | null = null;
let screen: Screen = 'menu';
let returnTo: Screen = 'menu';
let lastFrame = performance.now();
let overAt = 0;
let dailyKey = todayKey();

const DEATH_TEXT: Record<DeathCause, string> = {
  wall: 'You hit a wall.',
  self: 'You bit your own tail.',
  shed: 'Tripped over your own shed skin.',
  mine: 'A mine went off.',
  rival: 'The rival got you.',
};

const POWER_DESC: Record<string, string> = {
  phase: 'pass through your own body',
  slowmo: 'everything slows down',
  magnet: 'pulls nearby food to you',
  shrink: 'drops 3 tail segments',
  golden: 'big points, gone fast',
};

// ---------------------------------------------------------------- settings

function applySettings() {
  const s = data.settings;
  renderer.palette = PALETTES[s.palette];
  renderer.reducedMotion = s.reducedMotion;
  sound.enabled = s.sound;
  sound.musicEnabled = s.music;
  document.documentElement.dataset.palette = s.palette;
  $('dpad').classList.toggle('hidden', s.touch !== 'dpad');
  if (game?.mode.zen && screen === 'play' && s.music) sound.startMusic();
  else if (!s.music) sound.stopMusic();
}

function bindSettings() {
  const pal = $<HTMLSelectElement>('optPalette');
  const touch = $<HTMLSelectElement>('optTouch');
  const motion = $<HTMLInputElement>('optMotion');
  const snd = $<HTMLInputElement>('optSound');
  const music = $<HTMLInputElement>('optMusic');
  pal.value = data.settings.palette;
  touch.value = data.settings.touch;
  motion.checked = data.settings.reducedMotion;
  snd.checked = data.settings.sound;
  music.checked = data.settings.music;
  const commit = () => {
    data.settings = {
      palette: pal.value as SaveData['settings']['palette'],
      touch: touch.value as SaveData['settings']['touch'],
      reducedMotion: motion.checked,
      sound: snd.checked,
      music: music.checked,
    };
    save(data);
    applySettings();
    buildLegend();
  };
  for (const el of [pal, touch, motion, snd, music]) el.addEventListener('change', commit);
}

// ---------------------------------------------------------------- screens

function show(next: Screen) {
  screen = next;
  for (const id of ['menu', 'pause', 'over', 'settings', 'help']) {
    $(id).classList.toggle('hidden', id !== next);
  }
  document.body.dataset.screen = next;
  document.body.classList.toggle('in-game', game !== null);
  if (next === 'menu') buildMenu();
  if (next !== 'play') {
    game?.setSurge(false);
    sound.stopMusic();
  } else if (game?.mode.zen) sound.startMusic();
  if (next === 'play') (document.activeElement as HTMLElement | null)?.blur?.();
  else {
    const first = $(next)?.querySelector<HTMLElement>('button.primary, .mode-card');
    first?.focus({ preventScroll: true });
  }
}

function buildMenu() {
  dailyKey = todayKey();
  const list = $('modeList');
  list.innerHTML = '';
  MODE_ORDER.forEach((id, i) => {
    const mode = MODES[id];
    const best = id === 'daily' ? data.daily[dailyKey] ?? 0 : data.best[id] ?? 0;
    const btn = document.createElement('button');
    btn.className = `mode-card mode-${id}`;
    btn.innerHTML = `
      <span class="mode-key">${i + 1}</span>
      <span class="mode-name">${mode.name}${id === 'daily' ? ` <small>${dailyKey}</small>` : ''}</span>
      <span class="mode-blurb">${mode.blurb}</span>
      <span class="mode-best">${best ? `Best ${best.toLocaleString()}` : 'No score yet'}</span>`;
    btn.addEventListener('click', () => start(id));
    list.appendChild(btn);
  });
}

function buildLegend() {
  const ul = $('powerHelp');
  ul.innerHTML = '';
  for (const kind of ['phase', 'slowmo', 'magnet', 'shrink', 'golden']) {
    const li = document.createElement('li');
    const color = renderer.pickupColor(kind as EffectKind);
    li.innerHTML = `<i class="dot" style="background:${color}"></i><b>${POWER_LABEL[kind][0]}${POWER_LABEL[kind].slice(1).toLowerCase().replace('!', '')}</b>: ${POWER_DESC[kind]}`;
    ul.appendChild(li);
  }
}

function start(mode: ModeId) {
  sound.unlock();
  sound.ui();
  const seed = mode === 'daily' ? dailySeed(dailyKey) : undefined;
  game = new Game({ mode, seed });
  renderer.reset();
  document.body.dataset.mode = mode;
  document.body.classList.toggle('no-abilities', !game.mode.abilities);
  document.body.classList.toggle('no-levels', !game.mode.levels);
  show('play');
}

function togglePause() {
  if (screen === 'play') show('pause');
  else if (screen === 'pause') show('play');
}

function finish() {
  if (!game) return;
  const g = game;
  const mode = g.mode.id;
  const prevBest = mode === 'daily' ? data.daily[dailyKey] ?? 0 : data.best[mode] ?? 0;
  const isBest = g.score > prevBest;
  if (isBest) {
    if (mode === 'daily') data.daily[dailyKey] = g.score;
    else data.best[mode] = g.score;
    save(data);
  }
  $('overTitle').textContent = mode === 'daily' ? `Daily ${dailyKey}` : `${g.mode.name} over`;
  $('overCause').textContent = g.deathCause ? DEATH_TEXT[g.deathCause] : '';
  $('finalScore').textContent = g.score.toLocaleString();
  $('bestScore').textContent = Math.max(prevBest, g.score).toLocaleString();
  $('newBest').classList.toggle('hidden', !isBest || g.score === 0);

  const s = g.stats;
  const secs = Math.floor(s.timeMs / 1000);
  const rows: [string, string][] = [
    ['Time', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`],
    ['Food eaten', String(s.foods)],
    ['Longest', String(s.maxLength)],
  ];
  if (g.mode.abilities) rows.push(['Best combo', s.maxCombo > 1 ? `x${s.maxCombo}` : '-'], ['Sheds', String(s.sheds)]);
  if (g.mode.levels) rows.push(['Level', String(s.level)]);
  if (s.rivalsDowned) rows.push(['Rivals downed', String(s.rivalsDowned)]);
  $('summary').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  overAt = performance.now();
  show('over');
}

// ---------------------------------------------------------------- HUD

const hudCache = new Map<string, string>();
function setText(id: string, text: string) {
  if (hudCache.get(id) === text) return;
  hudCache.set(id, text);
  $(id).textContent = text;
}
function setWidth(id: string, frac: number) {
  const v = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  if (hudCache.get(id) === v) return;
  hudCache.set(id, v);
  $(id).style.width = v;
}

function updateHud(g: Game) {
  setText('score', g.score.toLocaleString());
  const mult = g.lengthMult * Math.max(1, g.comboActive);
  setText('mult', `x${+mult.toFixed(1)}`);
  const combo = g.comboActive;
  $('combo').classList.toggle('hidden', combo < 2);
  setText('combo', combo >= 2 ? `Combo x${combo}` : '');
  setText('levelLabel', g.mode.levels ? `Level ${g.level}` : g.mode.name);
  setText('arenaName', g.arena.name);
  setWidth('surgeBar', g.surge);
  $('surgeMeter').classList.toggle('active', g.surging);
  const shedReady = g.snake.length >= SHED_MIN_LENGTH;
  setWidth('shedBar', shedReady ? 1 - g.shedCooldown / SHED_COOLDOWN_MS : g.snake.length / SHED_MIN_LENGTH);
  $('shedMeter').classList.toggle('ready', g.canShed);
  $('btnShed').classList.toggle('ready', g.canShed);
  setWidth('levelBar', g.levelFoods / g.foodsForLevel);

  const eff = (Object.keys(g.effects) as EffectKind[])
    .map((k) => `${POWER_LABEL[k]} ${Math.ceil((g.effects[k] ?? 0) / 1000)}`)
    .join(' · ');
  setText('effects', eff);

  const banner = $('banner');
  banner.classList.toggle('hidden', !g.banner);
  if (g.banner) {
    setText('bannerTitle', g.banner.title);
    setText('bannerSub', g.banner.subtitle);
  }
}

// ---------------------------------------------------------------- layout & loop

function layout() {
  const rect = stage.getBoundingClientRect();
  const size = Math.max(120, Math.min(rect.width, rect.height));
  renderer.resize(size);
}

function frame(now: number) {
  const dt = Math.min(now - lastFrame, 100);
  lastFrame = now;
  if (game) {
    if (screen === 'play') {
      game.update(dt);
      const events = game.drainEvents();
      if (events.length) {
        sound.handle(events);
        renderer.handle(events, game);
      }
      if (game.status === 'over') finish();
    }
    renderer.draw(game, screen === 'play' || screen === 'over' ? dt : 0);
    updateHud(game);
  } else {
    renderer.draw(attract, dt);
    attractTick(dt);
  }
  requestAnimationFrame(frame);
}

// A tiny self-playing snake behind the main menu.
const attract = new Game({ mode: 'zen', seed: 7 });
function attractTick(dt: number) {
  const head = attract.snake[0];
  const food = attract.pickups.find((p) => p.kind === 'food');
  if (food && Math.random() < 0.5) {
    const want: Dir =
      food.pos.x !== head.x ? (food.pos.x > head.x ? 'right' : 'left') : food.pos.y > head.y ? 'down' : 'up';
    attract.turn(want);
  }
  attract.update(dt);
  attract.drainEvents();
}

// ---------------------------------------------------------------- wiring

bindInput(stage, {
  gesture: () => sound.unlock(),
  turn: (d) => {
    if (screen === 'play') game?.turn(d);
  },
  shed: () => {
    if (screen === 'play') game?.shed();
  },
  surge: (held) => {
    if (screen === 'play') game?.setSurge(held);
    else game?.setSurge(false);
  },
  pause: () => {
    if (screen === 'play' || screen === 'pause') togglePause();
    else if (screen === 'settings' || screen === 'help') show(returnTo);
  },
  confirm: () => {
    if (document.activeElement instanceof HTMLButtonElement) return;
    if (screen === 'over' && game && performance.now() - overAt > 500) start(game.mode.id);
  },
});

pressButton($('btnShed'), () => {
  if (screen === 'play') game?.shed();
});
pressButton(
  $('btnSurge'),
  () => {
    if (screen === 'play') game?.setSurge(true);
  },
  () => game?.setSurge(false),
);
pressButton($('btnPause'), () => togglePause());
for (const b of $('dpad').querySelectorAll<HTMLButtonElement>('button')) {
  pressButton(b, () => {
    if (screen === 'play') game?.turn(b.dataset.dir as Dir);
  });
}

$('resumeBtn').addEventListener('click', () => show('play'));
$('restartBtn').addEventListener('click', () => game && start(game.mode.id));
$('quitBtn').addEventListener('click', () => {
  game = null;
  show('menu');
});
$('retryBtn').addEventListener('click', () => game && start(game.mode.id));
$('overMenuBtn').addEventListener('click', () => {
  game = null;
  show('menu');
});
document.querySelectorAll<HTMLElement>('[data-open]').forEach((el) =>
  el.addEventListener('click', () => {
    sound.unlock();
    returnTo = screen;
    show(el.dataset.open as Screen);
  }),
);
document.querySelectorAll<HTMLElement>('[data-back]').forEach((el) => el.addEventListener('click', () => show(returnTo)));

window.addEventListener('keydown', (e) => {
  if (screen !== 'menu' || e.repeat) return;
  const n = Number(e.key);
  if (n >= 1 && n <= MODE_ORDER.length) start(MODE_ORDER[n - 1]);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'play') show('pause');
});
window.addEventListener('blur', () => {
  if (screen === 'play') show('pause');
});

if (import.meta.env.DEV) {
  // Dev-only handle for poking at state from the console.
  (window as unknown as { sssnake: unknown }).sssnake = { game: () => game, start, show };
}

new ResizeObserver(layout).observe(stage);
layout();
applySettings();
bindSettings();
buildLegend();
show('menu');
requestAnimationFrame(frame);
