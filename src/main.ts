import './style.css';
import { Sound } from './audio';
import { buildCommands } from './commands';
import { Editor } from './editor';
import { CLASSES, CLASS_ORDER } from './game/classes';
import { Game, SHED_COOLDOWN_MS } from './game/engine';
import { MODIFIER_INFO, type LevelData } from './game/levels';
import { MODES } from './game/modes';
import { MUTATIONS } from './game/mutations';
import { dailySeed, todayKey } from './game/rng';
import type { DeathCause, Dir, EffectKind, ModeId, MutationId, SnakeClass } from './game/types';
import { decodeGhost, encodeGhost, ghostBodyAt, type Ghost } from './ghost';
import { bindInput, pressButton } from './input';
import { globalBoard, submitGlobal } from './leaderboard';
import type { Lockstep, NetInput } from './net/lockstep';
import { OnlineMatch } from './net/online';
import { NetError, hostRoom, joinRoom, type PeerLink } from './net/peer';
import { CLASS_UNLOCK, SKINS, evaluate, isUnlocked, type RunContext } from './progress';
import { PALETTES, POWER_LABEL, Renderer } from './render';
import { challengeUrl, readChallengeFromHash, shareLink, type Challenge } from './share';
import { addLocalScore, load, save, type SaveData } from './storage';
import { Terminal } from './terminal';

type Screen = 'term' | 'play' | 'pause' | 'over' | 'settings' | 'draft' | 'editor';
const OVERLAYS: Screen[] = ['term', 'pause', 'over', 'settings', 'draft'];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const data: SaveData = load();
const sound = new Sound();
const canvas = $<HTMLCanvasElement>('board');
const stage = $('stage');
const renderer = new Renderer(canvas);

let game: Game | null = null;
let screen: Screen = 'term';
let settingsReturn: Screen = 'term';
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

// Online Versus
let online: OnlineMatch | null = null;
let lock: Lockstep | null = null;
let roundHandled = false;
let desyncWarned = false;

const DEATH_TEXT: Record<DeathCause, string> = {
  wall: 'segfault: hit a wall',
  self: 'recursion error: bit own tail',
  shed: 'tripped over shed skin',
  mine: 'mine detonated',
  rival: 'killed by rival.exe',
  boss: 'killed by the boss process',
  player: 'snake collision',
};

// ---------------------------------------------------------------- helpers

function toast(title: string, text: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<strong>${esc(title)}</strong><span>${esc(text)}</span>`;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3600);
}

function award(ctx: RunContext) {
  for (const a of evaluate(data.achievements, ctx)) {
    toast('achievement unlocked', `${a.name}: ${a.desc}`);
    for (const cls of CLASS_ORDER) {
      if (CLASS_UNLOCK[cls] === a.id) toast('new snake type', `${cls}: type "snake ${cls}" to use it`);
    }
    for (const skin of Object.values(SKINS)) {
      if (skin.unlock === a.id) toast('new skin', `type "skin ${skin.name}"`);
    }
  }
  save(data);
}

const selectedClass = (): SnakeClass =>
  isUnlocked(data.achievements, CLASS_UNLOCK[data.settings.cls]) ? data.settings.cls : 'racer';

const playerName = () => data.settings.name.trim() || 'guest';

function boardKey(mode: ModeId): string | null {
  if (mode === 'classic' || mode === 'arcade' || mode === 'rhythm') return mode;
  if (mode === 'daily') return `daily:${dailyKey}`;
  return null;
}

// ---------------------------------------------------------------- settings

function applySettings() {
  const s = data.settings;
  renderer.palette = PALETTES[s.palette] ?? PALETTES.green;
  renderer.reducedMotion = s.reducedMotion;
  renderer.skin = isUnlocked(data.achievements, SKINS[s.skin]?.unlock ?? null) ? s.skin : 'classic';
  sound.enabled = s.sound;
  sound.musicEnabled = s.music;
  document.documentElement.dataset.palette = s.palette;
  document.body.classList.toggle('reduced-motion', s.reducedMotion);
  $('dpad').classList.toggle('hidden', s.touch !== 'dpad');
  if (game?.mode.zen && screen === 'play' && s.music) sound.startMusic();
  else if (!s.music) sound.stopMusic();
  updatePrompt();
  syncSettingsForm();
}

function syncSettingsForm() {
  $<HTMLSelectElement>('optPalette').value = data.settings.palette;
  $<HTMLSelectElement>('optTouch').value = data.settings.touch;
  $<HTMLInputElement>('optMotion').checked = data.settings.reducedMotion;
  $<HTMLInputElement>('optSound').checked = data.settings.sound;
  $<HTMLInputElement>('optMusic').checked = data.settings.music;
  $<HTMLInputElement>('optName').value = data.settings.name;
}

function bindSettings() {
  const commit = () => {
    data.settings = {
      ...data.settings,
      palette: $<HTMLSelectElement>('optPalette').value as SaveData['settings']['palette'],
      touch: $<HTMLSelectElement>('optTouch').value as SaveData['settings']['touch'],
      reducedMotion: $<HTMLInputElement>('optMotion').checked,
      sound: $<HTMLInputElement>('optSound').checked,
      music: $<HTMLInputElement>('optMusic').checked,
      name: $<HTMLInputElement>('optName').value.replace(/[^\w \-.]/g, '').slice(0, 16),
    };
    save(data);
    applySettings();
  };
  for (const id of ['optPalette', 'optTouch', 'optMotion', 'optSound', 'optMusic', 'optName']) $(id).addEventListener('change', commit);
  $('settingsDone').addEventListener('click', () => show(settingsReturn));
}

function updatePrompt() {
  term?.setPrompt(`${playerName()}@sssnake:~$`);
  $('termTitle').textContent = `${playerName()}@sssnake: ~`;
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
  document.body.classList.toggle('in-game', game !== null && next !== 'term');
  if (next === 'editor') {
    document.body.classList.add('editing');
    renderer.reset();
    editor.open();
  }
  if (next !== 'play') {
    if (!online) {
      game?.setHeld(0, false);
      game?.setHeld(1, false);
    }
    sound.stopMusic();
  } else if (game?.mode.zen) sound.startMusic();
  if (next === 'term') {
    term.focus();
    setDefaultChips();
  } else if (next === 'play' || next === 'editor') (document.activeElement as HTMLElement | null)?.blur?.();
  else $(next)?.querySelector<HTMLElement>('button.primary, .draft-card')?.focus({ preventScroll: true });
}

function toTerminal(message?: string, style: 'dim' | 'err' | 'ok' = 'dim') {
  game = null;
  show('term');
  if (message) term.print(message, style);
}

// ---------------------------------------------------------------- runs

interface StartOpts {
  seed?: number;
  level?: LevelData;
  challenge?: Challenge | null;
  newMatch?: boolean;
}
let lastStart: { mode: ModeId; opts: StartOpts } = { mode: 'arcade', opts: {} };

function applyModeClasses(g: Game) {
  const m = g.mode;
  document.body.dataset.mode = m.id;
  document.body.classList.toggle('no-abilities', !m.abilities);
  document.body.classList.toggle('no-class', !m.classAbility);
  document.body.classList.toggle('no-levels', !m.levels && !(customLevel && customLevel.goal > 0) && !m.rhythm);
  $('btnAbility').textContent = CLASSES[g.players[online?.me ?? 0].cls].ability.toLowerCase();
}

function start(mode: ModeId, opts: StartOpts = {}) {
  if (online) return;
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
  applyModeClasses(game);
  show('play');
}

function retry() {
  if (!game) return;
  if (online) {
    online.ready();
    $('onlineStatus').classList.remove('hidden');
    $('onlineStatus').textContent = online.waitingForPeer ? '> waiting for opponent...' : '> starting...';
    $<HTMLButtonElement>('retryBtn').disabled = true;
    return;
  }
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

function openPause() {
  $('pauseNote').classList.toggle('hidden', !online);
  $('restartBtn').classList.toggle('hidden', !!online);
  $('quitBtn').textContent = online ? '[ leave match ]' : fromEditor && game?.mode.id === 'custom' ? '[ back to editor ]' : '[ quit to terminal ]';
  show('pause');
}

function openDraft() {
  const g = game!;
  const opts = g.draftOptions ?? [];
  $('draftTitle').textContent = g.bossesDefeated && g.spec.boss ? 'boss process terminated' : `level ${g.level} cleared`;
  const cards = $('draftCards');
  cards.innerHTML = '';
  opts.forEach((id, i) => {
    const def = MUTATIONS[id];
    const b = document.createElement('button');
    b.className = 'draft-card';
    b.innerHTML = `<span class="draft-key">[${i + 1}]</span><span class="draft-name">${def.name}</span><span class="draft-desc">${def.desc}</span>`;
    b.addEventListener('click', () => chooseDraft(i));
    cards.appendChild(b);
  });
  $('draftOwned').textContent = g.mutations.length ? `loaded: ${g.mutations.map((m) => MUTATIONS[m].name.toLowerCase()).join(', ')}` : 'mutations stack up over the run.';
  show('draft');
}

function chooseDraft(i: number) {
  if (!game || screen !== 'draft') return;
  sound.ui();
  game.chooseMutation(i);
  hudCache.delete('mutations');
  show('play');
}

function resetOverScreen() {
  for (const id of ['submitBox', 'challengeResult', 'onlineStatus', 'newBest']) $(id).classList.add('hidden');
  $<HTMLButtonElement>('retryBtn').disabled = false;
  lastBoard = null;
}

function finishVersus(g: Game, names: [string, string], wins: number[], round: number, over: boolean, me: number | null) {
  const w = g.winner ?? -1;
  const who = (i: number) => (me === null ? `player ${i + 1}` : i === me ? 'you' : names[i]);
  const take = (i: number) => (who(i) === 'you' ? 'you take' : `${who(i)} takes`);
  $('overTitle').textContent = over ? 'match over' : `round ${round}`;
  $('overCause').textContent = g.deathCause ? DEATH_TEXT[g.deathCause] : '';
  $('finalScore').textContent = `${wins[0]}-${wins[1]}`;
  $('bestLine').classList.remove('hidden');
  $('bestLine').textContent = over
    ? w >= 0
      ? `${who(w) === 'you' ? 'you win' : `${who(w)} wins`} the match`
      : 'match drawn'
    : w >= 0
      ? `${take(w)} round ${round}`
      : `round ${round} is a draw`;
  $('summary').innerHTML = (
    [
      [`${names[0]} score`, g.players[0].score],
      [`${names[1]} score`, g.players[1].score],
      ['round', round],
    ] as [string, number][]
  )
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v.toLocaleString()}</dd>`)
    .join('');
  $('retryBtn').innerHTML = `[ ${over ? 'rematch' : 'next round'} ] <kbd>enter</kbd>`;
  $('shareBtn').classList.add('hidden');
  $('overMenuBtn').textContent = online ? '[ leave match ]' : '[ back to terminal ]';
}

function finishOnline() {
  const g = game!;
  const o = online!;
  o.recordRound(g.winner);
  resetOverScreen();
  overAt = performance.now();
  finishVersus(g, o.names, o.wins, o.round, o.matchOver, o.me);
  if (o.matchOver && g.winner === o.me) award({ mode: 'versus', stats: g.stats, versusWin: true });
  show('over');
}

function finish() {
  if (!game) return;
  const g = game;
  const mode = g.mode.id;
  overAt = performance.now();
  resetOverScreen();
  $('shareBtn').classList.remove('hidden');
  $('overMenuBtn').textContent = fromEditor && mode === 'custom' ? '[ back to editor ]' : '[ back to terminal ]';

  if (mode === 'versus') {
    const w = g.winner ?? -1;
    if (w >= 0) versus.wins[w]++;
    matchOver = versus.wins.some((n) => n >= 2);
    finishVersus(g, ['P1', 'P2'], versus.wins, versus.round, matchOver, null);
    if (matchOver && w >= 0) award({ mode, stats: g.stats, versusWin: true });
    show('over');
    return;
  }

  $('retryBtn').innerHTML = '[ play again ] <kbd>enter</kbd>';
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

  $('overTitle').textContent =
    mode === 'custom' ? (g.won ? 'level complete' : 'level failed') : mode === 'daily' ? `daily ${dailyKey}` : `${mode}.exe exited`;
  $('overCause').textContent = g.won ? 'exit code 0: goal reached' : g.deathCause ? `exit code 1: ${DEATH_TEXT[g.deathCause]}` : '';
  $('finalScore').textContent = String(score).padStart(6, '0');
  $('bestLine').innerHTML = `best: <strong id="bestScore">${Math.max(prevBest, score).toLocaleString()}</strong>`;
  $('newBest').textContent = isBest ? 'new best' : `#${rank} local`;
  $('newBest').classList.toggle('hidden', !(isBest || rank > 0) || score === 0);
  $('bestLine').classList.toggle('hidden', !counts);

  if (challenge) {
    const el = $('challengeResult');
    el.classList.remove('hidden');
    const beat = score > challenge.target;
    el.textContent = challenge.target
      ? beat
        ? `> challenge beaten: ${score.toLocaleString()} > ${challenge.target.toLocaleString()}`
        : `> ${(challenge.target - score + 1).toLocaleString()} short of ${challenge.target.toLocaleString()}`
      : '> challenge played';
  }

  const s = g.stats;
  const secs = Math.floor(s.timeMs / 1000);
  const rows: [string, string][] = [
    ['time', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`],
    ['food', String(s.foods)],
    ['max length', String(s.maxLength)],
  ];
  if (g.mode.abilities) rows.push(['best combo', s.maxCombo > 1 ? `x${s.maxCombo}` : '-'], ['sheds', String(s.sheds)], ['coils', String(s.coils)]);
  if (g.mode.levels) rows.push(['level', String(s.level)], ['mutations', String(s.mutations)]);
  if (s.bossesDefeated) rows.push(['bosses killed', String(s.bossesDefeated)]);
  if (s.rivalsDowned) rows.push(['rivals killed', String(s.rivalsDowned)]);
  if (s.rewindsUsed) rows.push(['rewinds used', String(s.rewindsUsed)]);
  if (g.mode.rhythm) rows.push(['best sync streak', String(s.maxBeatStreak)]);
  $('summary').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  if (board && globalBoard(board) && score > 0) {
    $('submitBox').classList.remove('hidden');
    $<HTMLInputElement>('nameInput').value = data.settings.name;
    $('submitStatus').textContent = 'sends your name and score to the public leaderboard.';
    $<HTMLButtonElement>('submitBtn').disabled = false;
  }
  show('over');
}

// ---------------------------------------------------------------- online

function startOnline(role: 'host' | 'guest', link: PeerLink) {
  term.print('link established. handshaking...', 'ok');
  online = new OnlineMatch(role, link, data.settings.name.trim(), selectedClass(), {
    started: (g, l) => {
      game = g;
      lock = l;
      roundHandled = false;
      desyncWarned = false;
      customLevel = null;
      challenge = null;
      ghost = null;
      renderer.reset();
      hudCache.clear();
      applyModeClasses(g);
      sound.unlock();
      show('play');
    },
    peerReady: () => {
      if (screen === 'over') {
        $('onlineStatus').classList.remove('hidden');
        $('onlineStatus').textContent = '> opponent is ready';
      }
    },
    ended: (reason) => {
      online = null;
      lock = null;
      toTerminal(`connection closed: ${reason}`, 'err');
    },
  });
}

async function invite(t: Terminal, signal: AbortSignal) {
  if (online) return t.print('already in a match.', 'err');
  t.print('opening room...', 'dim');
  try {
    const link = await hostRoom({
      signal,
      onStatus: (s) => t.print(s, 'dim'),
      onCode: (code) => {
        const url = `${location.origin}${location.pathname}#join=${code}`;
        t.print('');
        t.print(`  ROOM CODE:  ${code.split('').join(' ')}`, 'big');
        t.print('');
        t.print(`your friend types {join ${code}|join ${code}}, or opens:`);
        t.print(url, 'bright');
        void navigator.clipboard?.writeText(url).then(
          () => t.print('(link copied to clipboard)', 'dim'),
          () => {},
        );
        t.print('waiting for an opponent... type {cancel} to stop.', 'dim');
      },
    });
    startOnline('host', link);
  } catch (err) {
    if (!signal.aborted) t.print((err as Error).message, 'err');
    if (!(err instanceof NetError) && !signal.aborted) console.error(err);
  }
}

async function join(code: string, t: Terminal, signal: AbortSignal) {
  if (online) return t.print('already in a match.', 'err');
  t.print(`connecting to room ${code.toUpperCase()}...`, 'dim');
  try {
    const link = await joinRoom(code, { signal, onStatus: (s) => t.print(s, 'dim') });
    startOnline('guest', link);
  } catch (err) {
    if (!signal.aborted) t.print((err as Error).message, 'err');
  }
}

function leaveOnline() {
  const o = online;
  online = null;
  lock = null;
  o?.leave();
  toTerminal('you left the match.');
}

function sendInput(i: NetInput) {
  lock?.input(i);
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
  const me = online?.me ?? 0;
  const p = g.players[me];
  if (g.mode.id === 'versus') {
    const names = online?.names ?? ['P1', 'P2'];
    const wins = online?.wins ?? versus.wins;
    setText('scoreLabel', `${names[0]} / ${names[1]}`);
    setText('score', `${g.players[0].score} / ${g.players[1].score}`);
    setText('mult', `ROUND ${online?.round ?? versus.round} [${wins[0]}-${wins[1]}]`);
  } else {
    setText('scoreLabel', 'SCORE');
    setText('score', String(p.score).padStart(6, '0'));
    const mult = g.lengthMult * Math.max(1, g.comboActive()) * g.rhythmMult;
    setText('mult', `x${mult.toFixed(1)}`);
  }
  const combo = g.comboActive(p);
  const groove = g.mode.rhythm && g.beatStreak > 1;
  $('combo').classList.toggle('hidden', combo < 2 && !groove);
  setText('combo', groove ? `SYNC ${g.beatStreak}` : combo >= 2 ? `COMBO x${combo}` : '');
  $('rewinds').classList.toggle('hidden', g.mode.rewinds === 0);
  setText('rewinds', `REWIND ${g.rewinds}${p.armour ? ` ARMOUR ${p.armour}` : ''}`);

  let label = g.mode.name.toUpperCase();
  if (online) label = 'ONLINE';
  else if (g.mode.levels) label = g.spec.boss ? `LVL ${String(g.level).padStart(2, '0')} BOSS` : `LVL ${String(g.level).padStart(2, '0')}`;
  else if (g.mode.rhythm) label = `${Math.round(g.bpm)} BPM`;
  setText('levelLabel', label);
  const twists = [...g.modifiers].map((m) => MODIFIER_INFO[m].name.toLowerCase()).join('+');
  setText('arenaName', twists ? `${g.arena.name.toLowerCase()} +${twists}` : g.arena.name.toLowerCase());

  const def = CLASSES[p.cls];
  setText('abilityName', def.ability);
  setWidth('abilityBar', p.meter);
  $('abilityMeter').classList.toggle('active', g.isSurging(p) || g.isHunkering(p));
  $('abilityMeter').classList.toggle('ready', !def.hold && p.meter >= def.cost);
  const shedMin = g.shedMinLength;
  setWidth('shedBar', p.body.length >= shedMin ? 1 - p.shedCooldown / (g.shedCooldownMax || SHED_COOLDOWN_MS) : p.body.length / shedMin);
  const canShed = g.canShedP(p);
  $('shedMeter').classList.toggle('ready', canShed);
  $('btnShed').classList.toggle('ready', canShed);

  if (g.boss) {
    setText('levelMeterName', 'BOSS');
    setWidth('levelBar', g.boss.hp / g.boss.maxHp);
  } else if (g.mode.rhythm) {
    setText('levelMeterName', 'SYNC');
    setWidth('levelBar', Math.min(g.beatStreak, 12) / 12);
  } else if (g.spec.goalFoods > 0) {
    setText('levelMeterName', g.mode.levels ? 'NEXT' : 'GOAL');
    setWidth('levelBar', g.levelFoods / g.spec.goalFoods);
  }

  let eff = (Object.keys(p.effects) as EffectKind[]).map((k) => `${POWER_LABEL[k]} ${Math.ceil((p.effects[k] ?? 0) / 1000)}`).join(' ');
  if (lock && lock.waitingMs > 400) eff = 'WAITING FOR OPPONENT';
  setText('effects', eff);

  const mutKey = g.mutations.join(',');
  if (hudCache.get('mutations') !== mutKey) {
    hudCache.set('mutations', mutKey);
    const counts = new Map<MutationId, number>();
    for (const m of g.mutations) counts.set(m, (counts.get(m) ?? 0) + 1);
    $('mutationRow').innerHTML = [...counts]
      .map(([m, n]) => `<span class="mut" title="${esc(MUTATIONS[m].desc)}">${MUTATIONS[m].name.toLowerCase()}${n > 1 ? ` x${n}` : ''}</span>`)
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
  renderer.resize(Math.max(120, Math.min(rect.width, rect.height)));
}

function frame(now: number) {
  const dt = Math.min(now - lastFrame, 100);
  lastFrame = now;
  if (screen === 'editor') {
    renderer.ghost = null;
    renderer.draw(editor.preview, dt);
  } else if (game && online && lock) {
    // Online: the match keeps running whatever screen is up.
    if (game.status === 'playing') lock.tick(dt);
    const events = game.drainEvents();
    if (events.length) {
      sound.handle(events);
      renderer.handle(events, game);
    }
    if (lock.desync && !desyncWarned) {
      desyncWarned = true;
      toast('desync', 'the two games drifted apart. finish the round and start a new one.');
    }
    if (game.status === 'over' && !roundHandled) {
      roundHandled = true;
      finishOnline();
    }
    renderer.draw(game, dt);
    updateHud(game);
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
    renderer.draw(game, screen === 'play' || screen === 'over' || screen === 'draft' ? dt : 0);
    updateHud(game);
  } else {
    renderer.ghost = null;
    renderer.draw(attract, dt);
    attractTick(dt);
  }
  requestAnimationFrame(frame);
}

// A self-playing snake behind the terminal.
const attract = new Game({ mode: 'zen', seed: 7 });
function attractTick(dt: number) {
  const head = attract.snake[0];
  const food = attract.pickups.find((p) => p.kind === 'food');
  if (food && Math.random() < 0.5) {
    const want: Dir = food.pos.x !== head.x ? (food.pos.x > head.x ? 'right' : 'left') : food.pos.y > head.y ? 'down' : 'up';
    attract.turn(want);
  }
  attract.update(dt);
  attract.drainEvents();
}

// ---------------------------------------------------------------- challenges

function clearHash() {
  history.replaceState(null, '', location.pathname + location.search);
}

function announceChallenge() {
  const c = pendingChallenge;
  if (!c) return;
  const from = c.from ? `${c.from} challenges you` : 'incoming challenge';
  const target = c.target ? `: beat ${c.target.toLocaleString()}` : '';
  const what = c.kind === 'level' ? ` on level "${c.level?.name ?? 'custom'}"` : ` in ${MODES[c.mode].name.toLowerCase()} (same seed)`;
  term.print('');
  term.print(`[!] ${from}${target}${what}.`, 'bright');
  term.print('    {accept} or {decline}?');
  term.setChips([
    { label: 'accept', cmd: 'accept' },
    { label: 'decline', cmd: 'decline' },
  ]);
}

function acceptChallenge() {
  const c = pendingChallenge;
  pendingChallenge = null;
  clearHash();
  if (!c) return;
  if (c.kind === 'level' && c.level) start('custom', { level: c.level, challenge: c });
  else start(c.mode, { seed: c.seed, challenge: c });
}

// ---------------------------------------------------------------- terminal

function setDefaultChips() {
  term.setChips([
    { label: 'play', cmd: 'play' },
    { label: 'daily', cmd: 'daily' },
    { label: 'invite', cmd: 'invite' },
    { label: 'join', cmd: 'join', fill: true },
    { label: 'versus', cmd: 'versus' },
    { label: 'snake', cmd: 'snake' },
    { label: 'scores', cmd: 'scores' },
    { label: 'help', cmd: 'help' },
  ]);
}

const term: Terminal = new Terminal(
  $('termOut'),
  $<HTMLInputElement>('termIn'),
  $<HTMLFormElement>('termForm'),
  $('termPrompt'),
  $('termChips'),
  buildCommands({
    data,
    save: () => save(data),
    applySettings,
    start: (mode, opts) => start(mode, opts),
    openEditor: (level) => {
      editor.load(level);
      show('editor');
    },
    openSettings: () => {
      settingsReturn = 'term';
      show('settings');
    },
    invite,
    join,
    pendingChallenge: () => pendingChallenge,
    acceptChallenge,
    declineChallenge: () => {
      pendingChallenge = null;
      clearHash();
      setDefaultChips();
    },
    dailyKey: () => todayKey(),
    selectedClass,
    updatePrompt,
  }),
);

function boot() {
  dailyKey = todayKey();
  const best = data.daily[dailyKey];
  const lines: [string, 'out' | 'dim' | 'bright' | 'ok' | 'title' | 'big'][] = [
    ['SSSNAKE BIOS v3.0', 'dim'],
    ['memory check .............. 640K OK', 'dim'],
    ['loading modules: coil.ko shed.ko surge.ko mutate.ko ... OK', 'dim'],
    ['mounting /dev/arena ............... OK', 'dim'],
    ['p2p link ...................... READY', 'dim'],
    ['', 'out'],
    [' ___ ___ ___           _', 'big'],
    ['/ __/ __/ __|_ _  __ _| |_____', 'big'],
    ['\\__ \\__ \\__ \\ \' \\/ _` | / / -_)', 'big'],
    ['|___/___/___/_||_\\__,_|_\\_\\___|', 'big'],
    ['', 'out'],
    ['slither. shed. surge.', 'title'],
    [`daily ${dailyKey}: ${best ? `best ${best.toLocaleString()}` : 'not played yet'}${data.ghosts[dailyKey] ? ', ghost saved' : ''}`, 'dim'],
    ['type {help} or tap a command. {play} starts arcade. {invite} plays a friend online.', 'out'],
  ];
  term.boot(lines, data.settings.reducedMotion, () => {
    const joinCode = /[#&]join=([A-Za-z0-9]{4})/.exec(location.hash)?.[1];
    if (joinCode) {
      clearHash();
      void term.exec(`join ${joinCode}`, true);
    } else if (pendingChallenge) announceChallenge();
  });
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
    const res = await shareLink(url, `try my SSSnake level "${level.name}"`);
    if (res !== 'failed') award({ mode: 'custom', stats: attract.stats, shared: true });
    return res === 'copied' ? 'link copied to clipboard.' : res === 'shared' ? 'shared.' : `copy this link: ${url}`;
  },
  exit: () => toTerminal(),
});

// ---------------------------------------------------------------- wiring

const playing = () => screen === 'play' && game !== null;

bindInput(stage, {
  gesture: () => sound.unlock(),
  versus: () => game?.mode.id === 'versus' && !online && screen === 'play',
  turn: (d, p) => {
    if (online) {
      if (screen === 'play') sendInput({ t: 'turn', d });
    } else if (playing()) game!.turn(d, p);
  },
  shed: (p) => {
    if (online) {
      if (screen === 'play') sendInput({ t: 'shed' });
    } else if (playing()) game!.shed(p);
  },
  ability: (held, p) => {
    if (online) sendInput({ t: 'hold', on: held && screen === 'play' });
    else if (playing()) game!.setHeld(p, held);
    else game?.setHeld(p, false);
  },
  pause: () => {
    if (screen === 'play') openPause();
    else if (screen === 'pause') show('play');
    else if (screen === 'editor') toTerminal();
    else if (screen === 'settings') show(settingsReturn);
  },
  confirm: () => {
    if (document.activeElement instanceof HTMLButtonElement || document.activeElement instanceof HTMLInputElement) return;
    if (screen === 'over' && performance.now() - overAt > 500) retry();
  },
  digit: (n) => {
    if (screen === 'draft' && n <= 3) chooseDraft(n - 1);
  },
});

pressButton($('btnShed'), () => {
  if (online) sendInput({ t: 'shed' });
  else if (playing()) game!.shed(0);
});
pressButton(
  $('btnAbility'),
  () => {
    if (online) sendInput({ t: 'hold', on: true });
    else if (playing()) game!.setHeld(0, true);
  },
  () => {
    if (online) sendInput({ t: 'hold', on: false });
    else game?.setHeld(0, false);
  },
);
pressButton($('btnPause'), () => (screen === 'play' ? openPause() : togglePause()));
for (const b of $('dpad').querySelectorAll<HTMLButtonElement>('button')) {
  pressButton(b, () => {
    if (online) sendInput({ t: 'turn', d: b.dataset.dir as Dir });
    else if (playing()) game!.turn(b.dataset.dir as Dir, 0);
  });
}

$('resumeBtn').addEventListener('click', () => show('play'));
$('restartBtn').addEventListener('click', () => {
  const keepEditor = fromEditor;
  start(lastStart.mode, { ...lastStart.opts, newMatch: true });
  fromEditor = keepEditor && lastStart.mode === 'custom';
});
$('settingsBtn').addEventListener('click', () => {
  settingsReturn = 'pause';
  show('settings');
});
const quit = () => {
  if (online) return leaveOnline();
  const back = fromEditor && game?.mode.id === 'custom';
  game = null;
  if (back) show('editor');
  else toTerminal();
};
$('quitBtn').addEventListener('click', quit);
$('overMenuBtn').addEventListener('click', quit);
$('retryBtn').addEventListener('click', retry);
$('shareBtn').addEventListener('click', async () => {
  if (!game) return;
  const g = game;
  const c: Challenge =
    g.mode.id === 'custom' && customLevel
      ? { kind: 'level', mode: 'custom', seed: 1, target: g.score, from: playerName(), level: customLevel }
      : { kind: 'run', mode: g.mode.id, seed: g.seed, target: g.score, from: playerName() };
  const res = await shareLink(challengeUrl(c), `beat my ${g.score.toLocaleString()} in SSSnake`);
  toast('challenge', res === 'copied' ? 'link copied. send it to a friend.' : res === 'shared' ? 'shared.' : 'could not copy the link.');
});
$('submitBtn').addEventListener('click', async () => {
  if (!game || !lastBoard) return;
  const name = $<HTMLInputElement>('nameInput').value.replace(/[^\w \-.]/g, '').trim().slice(0, 16);
  if (!name) {
    $('submitStatus').textContent = 'enter a name first.';
    return;
  }
  data.settings.name = name;
  // The local entry was saved before a name was typed; give it this one.
  const mine = (data.boards[lastBoard] ?? []).find((e) => e.name === 'guest' && e.score === game!.score);
  if (mine) mine.name = name;
  save(data);
  applySettings();
  const btn = $<HTMLButtonElement>('submitBtn');
  btn.disabled = true;
  $('submitStatus').textContent = 'uploading...';
  const g = game;
  const res = await submitGlobal({ board: lastBoard, name, score: g.score, level: g.level, timeMs: g.time, cls: g.p0.cls });
  if (res.status === 'ok') $('submitStatus').textContent = res.rank ? `> rank #${res.rank} worldwide` : '> submitted';
  else {
    btn.disabled = res.status === 'off';
    $('submitStatus').textContent = res.status === 'off' ? 'global leaderboard offline. your score is saved on this device.' : res.message;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === 'play' && !online) openPause();
});
window.addEventListener('blur', () => {
  if (screen === 'play' && !online) openPause();
});
window.addEventListener('hashchange', () => {
  const code = /[#&]join=([A-Za-z0-9]{4})/.exec(location.hash)?.[1];
  if (code && screen === 'term' && !online) {
    clearHash();
    void term.exec(`join ${code}`, true);
    return;
  }
  const c = readChallengeFromHash();
  if (c && screen === 'term') {
    pendingChallenge = c;
    announceChallenge();
  }
});
window.addEventListener('beforeunload', () => online?.leave());

if (import.meta.env.DEV) {
  // Dev-only handle for poking at state from the console.
  (window as unknown as { sssnake: unknown }).sssnake = {
    game: () => game,
    start,
    show,
    editor,
    data,
    term,
    online: () => online,
  };
}

new ResizeObserver(layout).observe(stage);
layout();
bindSettings();
applySettings();
show('term');
void document.fonts?.ready.then(() => layout());
boot();
requestAnimationFrame(frame);
