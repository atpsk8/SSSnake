import './style.css';
import './v2.css';
import { Sound } from './audio';
import { Editor } from './editor';
import { CLASSES, CLASS_ORDER } from './game/classes';
import { Game, SHED_COOLDOWN_MS } from './game/engine';
import { MODIFIER_INFO, MODIFIER_LIST, type LevelData } from './game/levels';
import { MODES, MODE_ORDER } from './game/modes';
import { MUTATIONS } from './game/mutations';
import { dailySeed, todayKey } from './game/rng';
import type { DeathCause, Dir, EffectKind, ModeId, MutationId, SnakeClass } from './game/types';
import { decodeGhost, encodeGhost, ghostBodyAt, type Ghost } from './ghost';
import { bindInput, pressButton } from './input';
import { fetchGlobal, globalBoard, submitGlobal } from './leaderboard';
import { ACHIEVEMENTS, CLASS_UNLOCK, SKINS, evaluate, isUnlocked, type RunContext } from './progress';
import { PALETTES, POWER_LABEL, Renderer } from './render';
import { challengeUrl, readChallengeFromHash, shareLink, type Challenge } from './share';
import { addLocalScore, load, save, type SaveData, type SkinId } from './storage';

type Screen =
  | 'menu'
  | 'play'
  | 'pause'
  | 'over'
  | 'settings'
  | 'help'
  | 'draft'
  | 'boards'
  | 'trophies'
  | 'challenge'
  | 'editor';
const OVERLAYS: Screen[] = ['menu', 'pause', 'over', 'settings', 'help', 'draft', 'boards', 'trophies', 'challenge'];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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
let challenge: Challenge | null = null;
let pendingChallenge: Challenge | null = readChallengeFromHash();
let customLevel: LevelData | null = null;
let fromEditor = false;
let ghost: Ghost | null = null;
let versus = { wins: [0, 0], round: 1 };
let matchOver = false;
let lastBoard: string | null = null;

const DEATH_TEXT: Record<DeathCause, string> = {
  wall: 'You hit a wall.',
  self: 'You bit your own tail.',
  shed: 'Tripped over shed skin.',
  mine: 'A mine went off.',
  rival: 'The rival got you.',
  boss: 'The boss got you.',
  player: 'Snake collision.',
};

const POWER_DESC: Record<string, string> = {
  phase: 'pass through your own body',
  slowmo: 'everything slows down',
  magnet: 'pulls nearby food to you',
  shrink: 'drops 3 tail segments',
  golden: 'big points, gone fast',
};

// ---------------------------------------------------------------- helpers

function toast(title: string, text: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<strong>${esc(title)}</strong><span>${esc(text)}</span>`;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3700);
}

function award(ctx: RunContext) {
  for (const a of evaluate(data.achievements, ctx)) {
    toast('Achievement unlocked', `${a.name}: ${a.desc}`);
    for (const cls of CLASS_ORDER) {
      if (CLASS_UNLOCK[cls] === a.id) toast('New snake type', `${CLASSES[cls].name} (${CLASSES[cls].ability})`);
    }
    for (const skin of Object.values(SKINS)) {
      if (skin.unlock === a.id) toast('New skin', `${skin.name}: pick it in Achievements`);
    }
  }
  save(data);
}

const selectedClass = (): SnakeClass =>
  isUnlocked(data.achievements, CLASS_UNLOCK[data.settings.cls]) ? data.settings.cls : 'racer';

const playerName = () => data.settings.name.trim() || 'Player';

function boardKey(mode: ModeId): string | null {
  if (mode === 'classic' || mode === 'arcade' || mode === 'rhythm') return mode;
  if (mode === 'daily') return `daily:${dailyKey}`;
  return null;
}

// ---------------------------------------------------------------- settings

function applySettings() {
  const s = data.settings;
  renderer.palette = PALETTES[s.palette];
  renderer.reducedMotion = s.reducedMotion;
  const skin = isUnlocked(data.achievements, SKINS[s.skin]?.unlock ?? null) ? SKINS[s.skin] : SKINS.classic;
  renderer.skin = { head: skin.head, tail: skin.tail };
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
  const name = $<HTMLInputElement>('optName');
  pal.value = data.settings.palette;
  touch.value = data.settings.touch;
  motion.checked = data.settings.reducedMotion;
  snd.checked = data.settings.sound;
  music.checked = data.settings.music;
  name.value = data.settings.name;
  const commit = () => {
    data.settings = {
      ...data.settings,
      palette: pal.value as SaveData['settings']['palette'],
      touch: touch.value as SaveData['settings']['touch'],
      reducedMotion: motion.checked,
      sound: snd.checked,
      music: music.checked,
      name: name.value.slice(0, 16),
    };
    save(data);
    applySettings();
    buildHelp();
  };
  for (const el of [pal, touch, motion, snd, music, name]) el.addEventListener('change', commit);
}

// ---------------------------------------------------------------- screens

function show(next: Screen) {
  if (screen === 'editor' && next !== 'editor') {
    editor.close();
    document.body.classList.remove('editing');
  }
  screen = next;
  for (const id of OVERLAYS) $(id).classList.toggle('hidden', id !== next);
  document.body.dataset.screen = next;
  document.body.classList.toggle('in-game', game !== null && next !== 'menu');
  if (next === 'menu') buildMenu();
  if (next === 'boards') openBoards();
  if (next === 'trophies') buildTrophies();
  if (next === 'editor') {
    document.body.classList.add('editing');
    editor.open();
  }
  if (next !== 'play') {
    game?.setHeld(0, false);
    game?.setHeld(1, false);
    sound.stopMusic();
  } else if (game?.mode.zen) sound.startMusic();
  if (next === 'play' || next === 'editor') (document.activeElement as HTMLElement | null)?.blur?.();
  else {
    const first = $(next)?.querySelector<HTMLElement>('button.primary, .mode-card, .draft-card');
    first?.focus({ preventScroll: true });
  }
}

function buildMenu() {
  dailyKey = todayKey();
  const list = $('modeList');
  list.innerHTML = '';
  MODE_ORDER.forEach((id, i) => {
    const mode = MODES[id];
    const best = id === 'daily' ? (data.daily[dailyKey] ?? 0) : (data.best[id] ?? 0);
    const btn = document.createElement('button');
    btn.className = `mode-card mode-${id}`;
    const bestText = id === 'versus' ? '2 players, 1 device' : best ? `Best ${best.toLocaleString()}` : 'No score yet';
    const sub = id === 'daily' ? ` <small>${dailyKey}${data.ghosts[dailyKey] ? ' · ghost ready' : ''}</small>` : '';
    btn.innerHTML = `
      <span class="mode-key">${i + 1}</span>
      <span class="mode-name">${mode.name}${sub}</span>
      <span class="mode-blurb">${mode.blurb}</span>
      <span class="mode-best">${bestText}</span>`;
    btn.addEventListener('click', () => start(id));
    list.appendChild(btn);
  });

  const classes = $('classList');
  classes.innerHTML = '';
  for (const id of CLASS_ORDER) {
    const def = CLASSES[id];
    const unlocked = isUnlocked(data.achievements, CLASS_UNLOCK[id]);
    const btn = document.createElement('button');
    btn.className = `class-card${selectedClass() === id ? ' selected' : ''}${unlocked ? '' : ' locked'}`;
    btn.disabled = !unlocked;
    btn.innerHTML = `<span class="class-name">${unlocked ? '' : '🔒 '}${def.name}</span><span class="class-ability">${def.ability}</span><span class="class-desc">${
      unlocked ? def.desc : def.unlock
    }</span>`;
    btn.addEventListener('click', () => {
      data.settings.cls = id;
      save(data);
      sound.ui();
      buildMenu();
    });
    classes.appendChild(btn);
  }
}

function buildHelp() {
  const ul = $('powerHelp');
  ul.innerHTML = '';
  for (const kind of ['phase', 'slowmo', 'magnet', 'shrink', 'golden']) {
    const li = document.createElement('li');
    const color = renderer.pickupColor(kind as EffectKind);
    const label = POWER_LABEL[kind].replace('!', '');
    li.innerHTML = `<i class="dot" style="background:${color}"></i><b>${label[0]}${label.slice(1).toLowerCase()}</b>: ${POWER_DESC[kind]}`;
    ul.appendChild(li);
  }
  $('classHelp').innerHTML = CLASS_ORDER.map(
    (c) => `<li><b>${CLASSES[c].name}</b> (${CLASSES[c].ability}): ${CLASSES[c].desc} <span class="muted">${CLASSES[c].unlock}.</span></li>`,
  ).join('');
  $('twistHelp').innerHTML = MODIFIER_LIST.map((m) => `<li><b>${MODIFIER_INFO[m].name}</b>: ${MODIFIER_INFO[m].desc}</li>`).join('');
}

function buildTrophies() {
  const owned = data.achievements;
  $('trophyCount').textContent = `${owned.length} of ${ACHIEVEMENTS.length} unlocked`;
  $('trophyList').innerHTML = ACHIEVEMENTS.map((a) => {
    const got = owned.includes(a.id);
    const unlocks = [
      ...CLASS_ORDER.filter((c) => CLASS_UNLOCK[c] === a.id).map((c) => `Unlocks ${CLASSES[c].name}`),
      ...Object.values(SKINS)
        .filter((s) => s.unlock === a.id)
        .map((s) => `Unlocks ${s.name} skin`),
    ].join(', ');
    return `<li class="${got ? 'got' : ''}"><b>${got ? '★' : '☆'} ${a.name}</b><span>${a.desc}${unlocks ? ` <em>${unlocks}</em>` : ''}</span></li>`;
  }).join('');
  const skins = $('skinList');
  skins.innerHTML = '';
  for (const [id, s] of Object.entries(SKINS) as [SkinId, (typeof SKINS)[SkinId]][]) {
    const unlocked = isUnlocked(owned, s.unlock);
    const btn = document.createElement('button');
    btn.className = `skin${data.settings.skin === id ? ' selected' : ''}`;
    btn.disabled = !unlocked;
    const head = s.head || renderer.palette.head;
    const tail = s.tail || renderer.palette.tail;
    btn.innerHTML = `<i style="background:linear-gradient(90deg, ${head}, ${tail})"></i><span>${s.name}</span><small>${unlocked ? '' : s.hint}</small>`;
    btn.addEventListener('click', () => {
      data.settings.skin = id;
      save(data);
      applySettings();
      buildTrophies();
    });
    skins.appendChild(btn);
  }
}

// ---------------------------------------------------------------- leaderboard screen

let boardTab = 'arcade';
let boardScope: 'global' | 'local' = 'global';

function openBoards() {
  dailyKey = todayKey();
  const tabs = $('boardTabs');
  const boards: [string, string][] = [
    ['arcade', 'Arcade'],
    [`daily:${dailyKey}`, 'Daily'],
    ['classic', 'Classic'],
    ['rhythm', 'Rhythm'],
  ];
  if (!boards.some(([k]) => k === boardTab)) boardTab = 'arcade';
  tabs.innerHTML = '';
  for (const [key, label] of boards) {
    const b = document.createElement('button');
    b.className = `tab${key === boardTab ? ' active' : ''}`;
    b.textContent = label;
    b.addEventListener('click', () => {
      boardTab = key;
      openBoards();
    });
    tabs.appendChild(b);
  }
  for (const b of $('scopeTabs').querySelectorAll<HTMLButtonElement>('button')) {
    b.classList.toggle('active', b.dataset.scope === boardScope);
  }
  void renderBoard();
}

async function renderBoard() {
  const list = $('boardList');
  const status = $('boardStatus');
  const tab = boardTab;
  const row = (r: { name: string; score: number; level: number; cls: SnakeClass }, i: number) =>
    `<li><span class="rank">${i + 1}</span><span class="who">${esc(String(r.name))}</span><span class="meta">${CLASSES[r.cls]?.name ?? ''}${
      r.level > 1 ? ` · L${r.level}` : ''
    }</span><span class="pts">${Number(r.score).toLocaleString()}</span></li>`;
  const local = () => {
    const rows = data.boards[tab] ?? [];
    list.innerHTML = rows.map(row).join('') || '<li class="empty">No scores yet. Go set one!</li>';
  };
  if (boardScope === 'local') {
    local();
    status.textContent = 'Your top 10 on this device.';
    return;
  }
  list.innerHTML = '<li class="empty">Loading…</li>';
  status.textContent = '';
  const res = await fetchGlobal(tab);
  if (tab !== boardTab || boardScope !== 'global' || screen !== 'boards') return;
  if (res.status === 'ok') {
    list.innerHTML = res.scores.map(row).join('') || '<li class="empty">No global scores yet. Be the first!</li>';
    status.textContent = 'Top 20 worldwide.';
  } else {
    local();
    status.textContent =
      res.status === 'off'
        ? "The global leaderboard isn't connected yet, so these are this device's scores."
        : 'Could not reach the global leaderboard. Showing this device.';
  }
}

for (const b of $('scopeTabs').querySelectorAll<HTMLButtonElement>('button')) {
  b.addEventListener('click', () => {
    boardScope = b.dataset.scope as 'global' | 'local';
    openBoards();
  });
}

// ---------------------------------------------------------------- runs

interface StartOpts {
  seed?: number;
  level?: LevelData;
  challenge?: Challenge | null;
  newMatch?: boolean;
}
let lastStart: { mode: ModeId; opts: StartOpts } = { mode: 'arcade', opts: {} };

function start(mode: ModeId, opts: StartOpts = {}) {
  sound.unlock();
  sound.ui();
  lastStart = { mode, opts };
  challenge = opts.challenge ?? null;
  customLevel = opts.level ?? null;
  if (mode !== 'custom') fromEditor = false;
  if (mode === 'versus' && opts.newMatch !== false) {
    versus = { wins: [0, 0], round: 1 };
    matchOver = false;
  }
  dailyKey = todayKey();
  const seed = opts.seed ?? (mode === 'daily' ? dailySeed(dailyKey) : undefined);
  const recordGhost = mode === 'daily' && !challenge;
  game = new Game({ mode, seed, classes: [selectedClass(), 'racer'], level: customLevel ?? undefined, record: recordGhost });
  ghost = recordGhost && data.ghosts[dailyKey] ? decodeGhost(data.ghosts[dailyKey]) : null;
  renderer.reset();
  hudCache.clear();
  const m = game.mode;
  document.body.dataset.mode = mode;
  document.body.classList.toggle('no-abilities', !m.abilities);
  document.body.classList.toggle('no-class', !m.classAbility);
  document.body.classList.toggle('no-levels', !m.levels && !(customLevel && customLevel.goal > 0) && !m.rhythm);
  $('btnAbility').textContent = CLASSES[game.p0.cls].ability;
  show('play');
  if (mode === 'versus' && versus.round === 1) {
    toast('Versus', 'P1: WASD, Q shed, E ability · P2: Arrows, / shed, . ability');
  }
}

function retry() {
  if (!game) return;
  if (game.mode.id === 'versus' && !matchOver) {
    versus.round++;
    start('versus', { newMatch: false });
    return;
  }
  const keepEditor = fromEditor;
  start(lastStart.mode, { ...lastStart.opts, newMatch: true });
  fromEditor = keepEditor && lastStart.mode === 'custom';
}

function togglePause() {
  if (screen === 'play') show('pause');
  else if (screen === 'pause') show('play');
}

function openDraft() {
  const g = game!;
  const opts = g.draftOptions ?? [];
  $('draftTitle').textContent = g.bossesDefeated && g.spec.boss ? 'Boss defeated!' : `Level ${g.level} cleared`;
  const cards = $('draftCards');
  cards.innerHTML = '';
  opts.forEach((id, i) => {
    const def = MUTATIONS[id];
    const b = document.createElement('button');
    b.className = 'draft-card';
    b.innerHTML = `<span class="mode-key">${i + 1}</span><span class="draft-name">${def.name}</span><span class="draft-desc">${def.desc}</span>`;
    b.addEventListener('click', () => chooseDraft(i));
    cards.appendChild(b);
  });
  $('draftOwned').textContent = g.mutations.length
    ? `Current: ${g.mutations.map((m) => MUTATIONS[m].name).join(', ')}`
    : 'Mutations stack up over the run.';
  show('draft');
}

function chooseDraft(i: number) {
  if (!game || screen !== 'draft') return;
  sound.ui();
  game.chooseMutation(i);
  hudCache.delete('mutations');
  show('play');
}

function finish() {
  if (!game) return;
  const g = game;
  const mode = g.mode.id;
  overAt = performance.now();
  $('submitBox').classList.add('hidden');
  $('challengeResult').classList.add('hidden');
  $('shareBtn').classList.toggle('hidden', mode === 'versus');
  $('overMenuBtn').textContent = fromEditor && mode === 'custom' ? 'Back to editor' : 'Main menu';
  lastBoard = null;

  if (mode === 'versus') {
    const w = g.winner ?? -1;
    if (w >= 0) versus.wins[w]++;
    matchOver = versus.wins.some((n) => n >= 2);
    $('overTitle').textContent = matchOver
      ? `Player ${w + 1} wins the match!`
      : w >= 0
        ? `Player ${w + 1} takes round ${versus.round}`
        : `Round ${versus.round} is a draw`;
    $('overCause').textContent = g.deathCause ? DEATH_TEXT[g.deathCause] : '';
    $('finalScore').textContent = `${versus.wins[0]} – ${versus.wins[1]}`;
    $('newBest').classList.add('hidden');
    $('bestLine').classList.add('hidden');
    $('summary').innerHTML = (
      [
        ['P1 score', g.players[0].score],
        ['P2 score', g.players[1].score],
        ['Round', versus.round],
      ] as [string, number][]
    )
      .map(([k, v]) => `<dt>${k}</dt><dd>${v.toLocaleString()}</dd>`)
      .join('');
    $('retryBtn').innerHTML = `${matchOver ? 'Rematch' : 'Next round'} <kbd>Enter</kbd>`;
    if (matchOver && w >= 0) award({ mode, stats: g.stats, versusWin: true });
    show('over');
    return;
  }

  $('retryBtn').innerHTML = 'Play again <kbd>Enter</kbd>';
  const score = g.score;
  const counts = !challenge && mode !== 'custom';
  const prevBest = mode === 'daily' ? (data.daily[dailyKey] ?? 0) : mode === 'custom' ? 0 : (data.best[mode] ?? 0);
  const isBest = counts && score > prevBest;
  if (isBest) {
    if (mode === 'daily') {
      data.daily[dailyKey] = score;
      if (g.trail.length) data.ghosts[dailyKey] = encodeGhost(g.trail);
    } else data.best[mode] = score;
  }

  const board = counts ? boardKey(mode) : null;
  let rank = 0;
  if (board && score > 0) {
    rank = addLocalScore(data, board, { name: playerName(), score, level: g.level, cls: g.p0.cls, date: todayKey() });
    lastBoard = board;
  }
  save(data);
  award({ mode, stats: g.stats });

  if (mode === 'custom') $('overTitle').textContent = g.won ? 'Level complete!' : `${customLevel?.name ?? 'Level'}: failed`;
  else if (mode === 'daily') $('overTitle').textContent = `Daily ${dailyKey}`;
  else $('overTitle').textContent = `${g.mode.name} over`;
  $('overCause').textContent = g.won ? '' : g.deathCause ? DEATH_TEXT[g.deathCause] : '';
  $('finalScore').textContent = score.toLocaleString();
  $('bestScore').textContent = Math.max(prevBest, score).toLocaleString();
  $('newBest').textContent = isBest ? 'New best!' : `#${rank} on this device`;
  $('newBest').classList.toggle('hidden', !(isBest || rank > 0) || score === 0);
  $('bestLine').classList.toggle('hidden', !counts);

  if (challenge) {
    const el = $('challengeResult');
    el.classList.remove('hidden');
    const beat = score > challenge.target;
    el.textContent = challenge.target
      ? beat
        ? `You beat ${challenge.from ? `${challenge.from}'s` : 'the'} ${challenge.target.toLocaleString()}!`
        : `${(challenge.target - score + 1).toLocaleString()} short of ${challenge.target.toLocaleString()}.`
      : 'Challenge played.';
    el.classList.toggle('beat', beat);
  }

  const s = g.stats;
  const secs = Math.floor(s.timeMs / 1000);
  const rows: [string, string][] = [
    ['Time', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`],
    ['Food eaten', String(s.foods)],
    ['Longest', String(s.maxLength)],
  ];
  if (g.mode.abilities) {
    rows.push(['Best combo', s.maxCombo > 1 ? `x${s.maxCombo}` : '-'], ['Sheds', String(s.sheds)], ['Coils', String(s.coils)]);
  }
  if (g.mode.levels) rows.push(['Level', String(s.level)], ['Mutations', String(s.mutations)]);
  if (s.bossesDefeated) rows.push(['Bosses defeated', String(s.bossesDefeated)]);
  if (s.rivalsDowned) rows.push(['Rivals downed', String(s.rivalsDowned)]);
  if (s.rewindsUsed) rows.push(['Rewinds used', String(s.rewindsUsed)]);
  if (g.mode.rhythm) rows.push(['Best beat streak', String(s.maxBeatStreak)]);
  $('summary').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  if (board && globalBoard(board) && score > 0) {
    $('submitBox').classList.remove('hidden');
    $<HTMLInputElement>('nameInput').value = data.settings.name;
    $('submitStatus').textContent = 'Sends your name and score to the public leaderboard.';
    $<HTMLButtonElement>('submitBtn').disabled = false;
  }
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
  const p = g.p0;
  if (g.mode.id === 'versus') {
    setText('scoreLabel', 'P1 · P2');
    setText('score', `${g.players[0].score} · ${g.players[1].score}`);
    setText('mult', `Round ${versus.round} · ${versus.wins[0]}–${versus.wins[1]}`);
  } else {
    setText('scoreLabel', 'Score');
    setText('score', p.score.toLocaleString());
    const mult = g.lengthMult * Math.max(1, g.comboActive()) * g.rhythmMult;
    setText('mult', `x${+mult.toFixed(1)}`);
  }
  const combo = g.comboActive();
  const groove = g.mode.rhythm && g.beatStreak > 1;
  $('combo').classList.toggle('hidden', combo < 2 && !groove);
  setText('combo', groove ? `Groove ${g.beatStreak}` : combo >= 2 ? `Combo x${combo}` : '');
  $('rewinds').classList.toggle('hidden', g.mode.rewinds === 0);
  setText('rewinds', `⟲ ${g.rewinds}${p.armour ? ` · ⛨ ${p.armour}` : ''}`);

  let label = g.mode.name;
  if (g.mode.levels) label = g.spec.boss ? `Level ${g.level} · Boss` : `Level ${g.level}`;
  else if (g.mode.rhythm) label = `${Math.round(g.bpm)} BPM`;
  setText('levelLabel', label);
  const twists = [...g.modifiers].map((m) => MODIFIER_INFO[m].name).join(' + ');
  setText('arenaName', twists ? `${g.arena.name} · ${twists}` : g.arena.name);

  const def = CLASSES[p.cls];
  setText('abilityName', def.ability);
  setWidth('abilityBar', p.meter);
  $('abilityMeter').classList.toggle('active', g.isSurging(p) || g.isHunkering(p));
  $('abilityMeter').classList.toggle('ready', !def.hold && p.meter >= def.cost);
  const shedMin = g.shedMinLength;
  const ready = p.body.length >= shedMin;
  setWidth('shedBar', ready ? 1 - p.shedCooldown / (g.shedCooldownMax || SHED_COOLDOWN_MS) : p.body.length / shedMin);
  $('shedMeter').classList.toggle('ready', g.canShed);
  $('btnShed').classList.toggle('ready', g.canShed);

  if (g.boss) {
    setText('levelMeterName', 'Boss');
    setWidth('levelBar', g.boss.hp / g.boss.maxHp);
  } else if (g.mode.rhythm) {
    setText('levelMeterName', 'Groove');
    setWidth('levelBar', Math.min(g.beatStreak, 12) / 12);
  } else if (g.spec.goalFoods > 0) {
    setText('levelMeterName', g.mode.levels ? 'Next' : 'Goal');
    setWidth('levelBar', g.levelFoods / g.spec.goalFoods);
  }

  const eff = (Object.keys(p.effects) as EffectKind[])
    .map((k) => `${POWER_LABEL[k]} ${Math.ceil((p.effects[k] ?? 0) / 1000)}`)
    .join(' · ');
  setText('effects', eff);

  const mutKey = g.mutations.join(',');
  if (hudCache.get('mutations') !== mutKey) {
    hudCache.set('mutations', mutKey);
    const counts = new Map<MutationId, number>();
    for (const m of g.mutations) counts.set(m, (counts.get(m) ?? 0) + 1);
    $('mutationRow').innerHTML = [...counts]
      .map(([m, n]) => `<span class="mut" title="${esc(MUTATIONS[m].desc)}">${MUTATIONS[m].name}${n > 1 ? ` x${n}` : ''}</span>`)
      .join('');
  }

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
  if (screen === 'editor') {
    renderer.ghost = null;
    renderer.draw(editor.preview, dt);
  } else if (game) {
    if (screen === 'play') {
      game.update(dt);
      const events = game.drainEvents();
      if (events.length) {
        sound.handle(events);
        renderer.handle(events, game);
      }
      if (game.status === 'over') finish();
      else if (game.status === 'draft') openDraft();
    }
    renderer.ghost = ghost ? ghostBodyAt(ghost, game.time) : null;
    const animate = screen === 'play' || screen === 'over' || screen === 'draft';
    renderer.draw(game, animate ? dt : 0);
    updateHud(game);
  } else {
    renderer.ghost = null;
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

// ---------------------------------------------------------------- editor

const editor = new Editor({
  renderer,
  canvas,
  levels: () => data.levels,
  saveLevels: (levels) => {
    data.levels = levels;
    save(data);
  },
  test: (level) => {
    start('custom', { level });
    fromEditor = true;
  },
  share: async (level) => {
    const url = challengeUrl({ kind: 'level', mode: 'custom', seed: 1, target: 0, from: playerName(), level });
    const res = await shareLink(url, `Try my SSSnake level "${level.name}"`);
    if (res !== 'failed') award({ mode: 'custom', stats: attract.stats, shared: true });
    return res === 'copied' ? 'Link copied to your clipboard.' : res === 'shared' ? 'Shared!' : `Copy this link: ${url}`;
  },
  exit: () => show('menu'),
});

// ---------------------------------------------------------------- wiring

const playing = () => screen === 'play' && game !== null;

bindInput(stage, {
  gesture: () => sound.unlock(),
  versus: () => game?.mode.id === 'versus' && screen === 'play',
  turn: (d, p) => {
    if (playing()) game!.turn(d, p);
  },
  shed: (p) => {
    if (playing()) game!.shed(p);
  },
  ability: (held, p) => {
    if (playing()) game!.setHeld(p, held);
    else game?.setHeld(p, false);
  },
  pause: () => {
    if (screen === 'play' || screen === 'pause') togglePause();
    else if (screen === 'editor') show('menu');
    else if (['settings', 'help', 'boards', 'trophies'].includes(screen)) show(returnTo);
  },
  confirm: () => {
    if (document.activeElement instanceof HTMLButtonElement || document.activeElement instanceof HTMLInputElement) return;
    if (screen === 'over' && performance.now() - overAt > 500) retry();
    else if (screen === 'challenge') acceptChallenge();
  },
  digit: (n) => {
    if (screen === 'menu' && n <= MODE_ORDER.length) start(MODE_ORDER[n - 1]);
    else if (screen === 'draft' && n <= 3) chooseDraft(n - 1);
  },
});

pressButton($('btnShed'), () => {
  if (playing()) game!.shed(0);
});
pressButton(
  $('btnAbility'),
  () => {
    if (playing()) game!.setHeld(0, true);
  },
  () => game?.setHeld(0, false),
);
pressButton($('btnPause'), () => togglePause());
for (const b of $('dpad').querySelectorAll<HTMLButtonElement>('button')) {
  pressButton(b, () => {
    if (playing()) game!.turn(b.dataset.dir as Dir, 0);
  });
}

$('resumeBtn').addEventListener('click', () => show('play'));
$('restartBtn').addEventListener('click', () => {
  const keepEditor = fromEditor;
  start(lastStart.mode, { ...lastStart.opts, newMatch: true });
  fromEditor = keepEditor && lastStart.mode === 'custom';
});
$('quitBtn').addEventListener('click', () => {
  const back = fromEditor && game?.mode.id === 'custom';
  game = null;
  show(back ? 'editor' : 'menu');
});
$('retryBtn').addEventListener('click', retry);
$('overMenuBtn').addEventListener('click', () => {
  const back = fromEditor && game?.mode.id === 'custom';
  game = null;
  show(back ? 'editor' : 'menu');
});
$('shareBtn').addEventListener('click', async () => {
  if (!game) return;
  const g = game;
  const c: Challenge =
    g.mode.id === 'custom' && customLevel
      ? { kind: 'level', mode: 'custom', seed: 1, target: g.score, from: playerName(), level: customLevel }
      : { kind: 'run', mode: g.mode.id, seed: g.seed, target: g.score, from: playerName() };
  const res = await shareLink(challengeUrl(c), `Beat my ${g.score.toLocaleString()} in SSSnake!`);
  toast('Challenge', res === 'copied' ? 'Link copied. Send it to a friend!' : res === 'shared' ? 'Shared!' : 'Could not copy the link.');
});
$('submitBtn').addEventListener('click', async () => {
  if (!game || !lastBoard) return;
  const name = $<HTMLInputElement>('nameInput').value.trim().slice(0, 16);
  if (!name) {
    $('submitStatus').textContent = 'Enter a name first.';
    return;
  }
  data.settings.name = name;
  $<HTMLInputElement>('optName').value = name;
  // The local entry was saved before a name was typed; give it this one.
  const mine = (data.boards[lastBoard] ?? []).find((e) => e.name === 'Player' && e.score === game!.score);
  if (mine) mine.name = name;
  save(data);
  const btn = $<HTMLButtonElement>('submitBtn');
  btn.disabled = true;
  $('submitStatus').textContent = 'Submitting…';
  const g = game;
  const res = await submitGlobal({ board: lastBoard, name, score: g.score, level: g.level, timeMs: g.time, cls: g.p0.cls });
  if (res.status === 'ok') $('submitStatus').textContent = res.rank ? `You're #${res.rank} worldwide!` : 'Submitted.';
  else {
    btn.disabled = res.status === 'off';
    $('submitStatus').textContent =
      res.status === 'off' ? "The global leaderboard isn't connected yet. Your score is saved on this device." : res.message;
  }
});
document.querySelectorAll<HTMLElement>('[data-open]').forEach((el) =>
  el.addEventListener('click', () => {
    sound.unlock();
    returnTo = screen === 'editor' ? 'menu' : screen;
    show(el.dataset.open as Screen);
  }),
);
document.querySelectorAll<HTMLElement>('[data-back]').forEach((el) => el.addEventListener('click', () => show(returnTo)));

function clearHash() {
  history.replaceState(null, '', location.pathname + location.search);
}

function acceptChallenge() {
  const c = pendingChallenge;
  pendingChallenge = null;
  clearHash();
  if (!c) return show('menu');
  if (c.kind === 'level' && c.level) start('custom', { level: c.level, challenge: c });
  else start(c.mode, { seed: c.seed, challenge: c });
}
$('challengeGo').addEventListener('click', acceptChallenge);
$('challengeSkip').addEventListener('click', () => {
  pendingChallenge = null;
  clearHash();
  show('menu');
});

function openChallenge() {
  const c = pendingChallenge!;
  const from = c.from ? `${esc(c.from)} challenges you` : 'You have a challenge';
  const target = c.target ? `: beat <b>${c.target.toLocaleString()}</b>` : '';
  const what =
    c.kind === 'level' ? ` on the level <b>${esc(c.level?.name ?? 'Custom')}</b>` : ` in <b>${MODES[c.mode].name}</b> with the same seed`;
  $('challengeText').innerHTML = `${from}${target}${what}.`;
  show('challenge');
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'play') show('pause');
});
window.addEventListener('blur', () => {
  if (screen === 'play') show('pause');
});
window.addEventListener('hashchange', () => {
  const c = readChallengeFromHash();
  if (c && (screen === 'menu' || screen === 'over')) {
    pendingChallenge = c;
    openChallenge();
  }
});

if (import.meta.env.DEV) {
  // Dev-only handle for poking at state from the console.
  (window as unknown as { sssnake: unknown }).sssnake = { game: () => game, start, show, editor, data };
}

new ResizeObserver(layout).observe(stage);
layout();
applySettings();
bindSettings();
buildHelp();
if (pendingChallenge) openChallenge();
else show('menu');
requestAnimationFrame(frame);
