import { CLASSES, CLASS_ORDER } from './game/classes';
import type { LevelData } from './game/levels';
import { MODES } from './game/modes';
import type { ModeId, SnakeClass } from './game/types';
import { fetchGlobal, globalBoard } from './leaderboard';
import { ACHIEVEMENTS, CLASS_UNLOCK, SKINS, isUnlocked } from './progress';
import type { Challenge } from './share';
import type { PaletteId, SaveData, SkinId } from './storage';
import type { Command, Terminal } from './terminal';
import { THEMES, THEME_ORDER, type ThemeId } from './themes';

export interface AppCtx {
  data: SaveData;
  save(): void;
  applySettings(): void;
  start(mode: ModeId, opts?: { seed?: number; level?: LevelData; challenge?: Challenge | null; cpu?: 'easy' | 'normal' | 'hard' }): void;
  openEditor(level?: LevelData): void;
  openSettings(): void;
  invite(t: Terminal, signal: AbortSignal): Promise<void>;
  join(code: string, t: Terminal, signal: AbortSignal): Promise<void>;
  quick(t: Terminal, signal: AbortSignal): Promise<void>;
  watch(arg: string, t: Terminal): Promise<void>;
  netcheck(t: Terminal): Promise<void>;
  pendingChallenge(): Challenge | null;
  acceptChallenge(): void;
  declineChallenge(): void;
  dailyKey(): string;
  selectedClass(): SnakeClass;
  updatePrompt(): void;
}

const PLAY_MODES: ModeId[] = ['arcade', 'classic', 'daily', 'zen', 'rhythm', 'endless', 'versus'];
const BOARDS: Record<string, string> = { arcade: 'arcade', classic: 'classic', rhythm: 'rhythm', daily: 'daily', endless: 'endless' };

export function buildCommands(app: AppCtx): Command[] {
  const s = () => app.data.settings;
  const setSetting = (t: Terminal, key: string, value: string | undefined) => {
    const v = (value ?? '').toLowerCase();
    const bool = (x: string) => (x === 'on' || x === 'true' || x === '1' ? true : x === 'off' || x === 'false' || x === '0' ? false : null);
    switch (key) {
      case 'name': {
        const name = (value ?? '').replace(/[^\w \-.]/g, '').slice(0, 16);
        if (!name) return t.print('usage: set name <name>', 'err');
        s().name = name;
        app.updatePrompt();
        break;
      }
      case 'theme':
        if (!THEME_ORDER.includes(v as ThemeId)) return t.print(`usage: set theme ${THEME_ORDER.join('|')}`, 'err');
        s().theme = v as ThemeId;
        break;
      case 'color':
      case 'colour':
      case 'phosphor':
        if (!['green', 'amber', 'white'].includes(v)) return t.print('usage: set color green|amber|white', 'err');
        s().palette = v as PaletteId;
        break;
      case 'sound':
      case 'music': {
        const b = bool(v);
        if (b === null) return t.print(`usage: set ${key} on|off`, 'err');
        s()[key] = b;
        break;
      }
      case 'crt':
        if (!['soft', 'full', 'off'].includes(v)) return t.print('usage: set crt soft|full|off', 'err');
        s().crt = v as 'soft' | 'full' | 'off';
        break;
      case 'quality':
        if (v !== 'high' && v !== 'low') return t.print('usage: set quality high|low  (3D neo theme)', 'err');
        s().quality = v;
        break;
      case 'haptics': {
        const b = bool(v);
        if (b === null) return t.print('usage: set haptics on|off', 'err');
        s().haptics = b;
        break;
      }
      case 'deathcam': {
        const b = bool(v);
        if (b === null) return t.print('usage: set deathcam on|off', 'err');
        s().deathcam = b;
        break;
      }
      case 'motion':
        if (!['full', 'reduced'].includes(v)) return t.print('usage: set motion full|reduced', 'err');
        s().reducedMotion = v === 'reduced';
        break;
      case 'touch':
        if (!['swipe', 'dpad'].includes(v)) return t.print('usage: set touch swipe|dpad', 'err');
        s().touch = v as 'swipe' | 'dpad';
        break;
      default:
        return t.print(`unknown setting '${key}'. try {set}`, 'err');
    }
    app.save();
    app.applySettings();
    t.print(`${key} = ${key === 'name' ? s().name : v}`, 'ok');
  };

  const printSettings = (t: Terminal) => {
    const st = s();
    t.table([
      ['name', st.name || '(not set)', 'set name <name>'],
      ['theme', st.theme, 'theme neo|terminal|nokia|gameboy|paper|minimal'],
      ['color', st.palette, 'set color green|amber|white  (terminal theme)'],
      ['crt', st.crt, 'set crt soft|full|off  (terminal theme)'],
      ['sound', st.sound ? 'on' : 'off', 'set sound on|off'],
      ['music', st.music ? 'on' : 'off', 'set music on|off'],
      ['quality', st.quality, 'set quality high|low  (3D neo theme: bloom, shadows)'],
      ['haptics', st.haptics ? 'on' : 'off', 'set haptics on|off  (phone vibration, controller rumble)'],
      ['deathcam', st.deathcam ? 'on' : 'off', 'set deathcam on|off  (instant replay when you die)'],
      ['motion', st.reducedMotion ? 'reduced' : 'full', 'set motion full|reduced'],
      ['touch', st.touch, 'set touch swipe|dpad'],
    ]);
  };

  const commands: Command[] = [
    {
      name: 'help',
      aliases: ['?', 'man'],
      desc: 'list commands',
      run(args, t) {
        if (args[0]) {
          const c = t.list.find((x) => x.name === args[0] || x.aliases?.includes(args[0]));
          if (!c) return t.print(`no manual entry for ${args[0]}`, 'err');
          t.print(`${c.usage ?? c.name}`, 'bright');
          t.print(`  ${c.desc}`);
          if (c.aliases?.length) t.print(`  aliases: ${c.aliases.join(', ')}`, 'dim');
          return;
        }
        t.print('GAME', 'title');
        t.print('  {play} [mode]      arcade (default), classic, daily, zen, rhythm, endless');
        t.print('  {versus}           two players on this device;  {cpu} to play the computer');
        t.print('  {match}            play a random opponent online');
        t.print('  {invite}           host an online match and get a code');
        t.print('  join <code>      join a friend\'s online match');
        t.print('  {snake} [type]     list or pick your snake type');
        t.print('  {editor}           build levels;  {levels} to list saved ones');
        t.print('PROFILE', 'title');
        t.print('  {scores} [board]   leaderboards: arcade, daily, classic, rhythm, endless');
        t.print('  {trophies}         achievements and unlocks');
        t.print('  {theme} [name]     change the look: neo (3D), terminal, nokia, gameboy, paper, minimal');
        t.print('  {skin} [name]      snake skins');
        t.print('  {set} [key value]  settings (name, color, crt, sound, music, motion, touch)');
        t.print('SYSTEM', 'title');
        t.print('  {netcheck}  {controls}  {clear}  {about}', 'out');
        t.print('tip: Tab completes, Up/Down recalls history, Esc cancels.', 'dim');
      },
    },
    {
      name: 'play',
      aliases: ['run', 'start'],
      usage: 'play [arcade|classic|daily|zen|rhythm|endless|versus]',
      desc: 'start a game',
      run(args, t) {
        const mode = (args[0]?.toLowerCase() ?? 'arcade') as ModeId;
        if (!PLAY_MODES.includes(mode)) return t.print(`unknown mode '${args[0]}'. modes: ${PLAY_MODES.join(', ')}`, 'err');
        t.print(`exec ./${mode}.exe --snake ${app.selectedClass()}`, 'dim');
        app.start(mode);
      },
    },
    ...(['arcade', 'classic', 'daily', 'zen', 'rhythm', 'endless'] as ModeId[]).map(
      (m): Command => ({
        name: m,
        desc: `play ${MODES[m].name}: ${MODES[m].blurb}`,
        hidden: false,
        run: (_a, t) => {
          t.print(`exec ./${m}.exe --snake ${app.selectedClass()}`, 'dim');
          app.start(m);
        },
      }),
    ),
    {
      name: 'versus',
      aliases: ['vs', 'local'],
      usage: 'versus [cpu [easy|normal|hard]]',
      desc: 'two players on one device, or you against the cpu (best of three)',
      run(args, t) {
        if (args[0] === 'cpu' || args[0] === 'bot') {
          const d = (args[1] ?? 'normal').toLowerCase();
          if (!['easy', 'normal', 'hard'].includes(d)) return t.print('usage: versus cpu easy|normal|hard', 'err');
          t.print(`you vs cpu (${d}). arrows/WASD to move, space hex, shift ability.`, 'dim');
          return app.start('versus', { cpu: d as 'easy' | 'normal' | 'hard' });
        }
        t.print('P1: WASD, Q hex, E ability   P2: arrows, / hex, . ability   (or: {versus cpu})', 'dim');
        app.start('versus');
      },
    },
    {
      name: 'cpu',
      aliases: ['bot'],
      usage: 'cpu [easy|normal|hard]',
      desc: 'play versus against the computer',
      run(args, t) {
        const d = (args[0] ?? 'normal').toLowerCase();
        if (!['easy', 'normal', 'hard'].includes(d)) return t.print('usage: cpu easy|normal|hard', 'err');
        app.start('versus', { cpu: d as 'easy' | 'normal' | 'hard' });
      },
    },
    {
      name: 'invite',
      aliases: ['host'],
      desc: 'host an online match; share the code with a friend',
      run: (_a, t, signal) => app.invite(t, signal),
    },
    {
      name: 'match',
      aliases: ['quick', 'findmatch', 'online'],
      desc: 'play a random opponent online',
      run: (_a, t, signal) => app.quick(t, signal),
    },
    {
      name: 'watch',
      aliases: ['replay'],
      usage: 'watch <id|last>',
      desc: 'watch a replay: your last run, or a leaderboard run',
      run(args, t) {
        if (!args[0]) return t.print('usage: watch last   (or click "watch" next to a score in {scores})', 'err');
        return app.watch(args[0], t);
      },
    },
    {
      name: 'netcheck',
      aliases: ['ping', 'status'],
      desc: 'check that online play is set up',
      run: (_a, t) => app.netcheck(t),
    },
    {
      name: 'join',
      aliases: ['connect'],
      usage: 'join <code>',
      desc: "join a friend's online match with their 4-character code",
      run(args, t, signal) {
        if (!args[0]) {
          t.print('usage: join <code>   (e.g. join K7QX)', 'err');
          return;
        }
        return app.join(args[0], t, signal);
      },
    },
    {
      name: 'snake',
      aliases: ['class', 'type'],
      usage: 'snake [racer|viper|cobra|python]',
      desc: 'list or choose your snake type',
      run(args, t) {
        const owned = app.data.achievements;
        if (args[0]) {
          const id = args[0].toLowerCase() as SnakeClass;
          if (!CLASS_ORDER.includes(id)) return t.print(`no snake type '${args[0]}'`, 'err');
          if (!isUnlocked(owned, CLASS_UNLOCK[id])) return t.print(`${id} is locked: ${CLASSES[id].unlock.toLowerCase()}`, 'err');
          s().cls = id;
          app.save();
          return t.print(`snake = ${id} (${CLASSES[id].ability.toLowerCase()})`, 'ok');
        }
        for (const id of CLASS_ORDER) {
          const c = CLASSES[id];
          const open = isUnlocked(owned, CLASS_UNLOCK[id]);
          const mark = app.selectedClass() === id ? '*' : ' ';
          const label = open ? `{${id}|snake ${id}}` : id;
          t.print(`${mark} ${label}  ${c.ability.toUpperCase()}  ${open ? c.desc : `[locked] ${c.unlock}`}`, open ? 'out' : 'dim');
        }
      },
    },
    {
      name: 'skin',
      aliases: ['skins'],
      usage: 'skin [solid|scanline|wireframe|overclock]',
      desc: 'change how your snake is drawn',
      run(args, t) {
        const owned = app.data.achievements;
        const entries = Object.entries(SKINS) as [SkinId, (typeof SKINS)[SkinId]][];
        if (args[0]) {
          const found = entries.find(([, v]) => v.name === args[0].toLowerCase());
          if (!found) return t.print(`no skin '${args[0]}'`, 'err');
          if (!isUnlocked(owned, found[1].unlock)) return t.print(`${found[1].name} is locked: ${found[1].hint}`, 'err');
          s().skin = found[0];
          app.save();
          app.applySettings();
          return t.print(`skin = ${found[1].name}`, 'ok');
        }
        for (const [id, v] of entries) {
          const open = isUnlocked(owned, v.unlock);
          t.print(`${s().skin === id ? '*' : ' '} ${open ? `{${v.name}|skin ${v.name}}` : v.name}  ${v.desc}${open ? '' : `  [locked] ${v.hint}`}`, open ? 'out' : 'dim');
        }
      },
    },
    {
      name: 'scores',
      aliases: ['top', 'leaderboard', 'lb'],
      usage: 'scores [arcade|daily|classic|rhythm|endless] [--local]',
      desc: 'show a leaderboard',
      async run(args, t, signal) {
        const which = args.find((a) => !a.startsWith('-'))?.toLowerCase() ?? 'arcade';
        if (!BOARDS[which]) return t.print(`boards: ${Object.keys(BOARDS).join(', ')}`, 'err');
        const board = which === 'daily' ? `daily:${app.dailyKey()}` : which;
        const localOnly = args.includes('--local') || args.includes('-l') || !globalBoard(board);
        const rows = (list: { name: string; score: number; level: number; cls: SnakeClass; id?: string }[]) => {
          if (!list.length) return t.print('  (no scores yet)', 'dim');
          const cells = list.map((r, i) => [
            `${String(i + 1).padStart(2)}.`,
            String(r.name).slice(0, 16),
            CLASSES[r.cls]?.name.toLowerCase() ?? '',
            r.level > 1 ? `L${r.level}` : '',
            r.score.toLocaleString().padStart(9),
          ]);
          const widths = cells[0].map((_, c) => Math.max(...cells.map((row) => row[c].length)));
          cells.forEach((row, i) => {
            const id = list[i].id;
            const line = row.map((c, k) => c.padEnd(widths[k])).join('  ');
            t.print(id && /^[a-z0-9]{6,12}$/.test(id) ? `${line}  {watch|watch ${id}}` : line);
          });
        };
        if (!localOnly) {
          t.print(`querying global ${board} ...`, 'dim');
          const res = await fetchGlobal(board);
          if (signal.aborted) return;
          if (res.status === 'ok') {
            t.print(`GLOBAL TOP 20 // ${board.toUpperCase()}`, 'title');
            rows(res.scores);
            t.print(`this device: {scores ${which} --local}`, 'dim');
            return;
          }
          t.print(res.status === 'off' ? 'global leaderboard offline. showing this device.' : 'could not reach the server. showing this device.', 'dim');
        }
        t.print(`LOCAL TOP 10 // ${board.toUpperCase()}`, 'title');
        rows(app.data.boards[board] ?? []);
      },
    },
    {
      name: 'stats',
      aliases: ['best'],
      desc: 'your personal bests',
      run(_a, t) {
        const d = app.data;
        t.table([
          ['classic', (d.best.classic ?? 0).toLocaleString()],
          ['arcade', (d.best.arcade ?? 0).toLocaleString()],
          ['rhythm', (d.best.rhythm ?? 0).toLocaleString()],
          ['zen', (d.best.zen ?? 0).toLocaleString()],
          ['endless', (d.best.endless ?? 0).toLocaleString()],
          [`daily ${app.dailyKey()}`, (d.daily[app.dailyKey()] ?? 0).toLocaleString() + (d.ghosts[app.dailyKey()] ? '  (ghost saved)' : '')],
          ['trophies', `${d.achievements.length}/${ACHIEVEMENTS.length}`],
        ]);
      },
    },
    {
      name: 'trophies',
      aliases: ['achievements', 'ach'],
      desc: 'achievements and what they unlock',
      run(_a, t) {
        const owned = app.data.achievements;
        t.print(`${owned.length}/${ACHIEVEMENTS.length} unlocked`, 'title');
        for (const a of ACHIEVEMENTS) {
          const got = owned.includes(a.id);
          const unlocks = [
            ...CLASS_ORDER.filter((c) => CLASS_UNLOCK[c] === a.id).map((c) => `unlocks ${c}`),
            ...Object.values(SKINS)
              .filter((k) => k.unlock === a.id)
              .map((k) => `unlocks skin ${k.name}`),
          ].join(', ');
          t.print(`[${got ? 'x' : ' '}] ${a.name.padEnd(15)} ${a.desc}${unlocks ? `  <${unlocks}>` : ''}`, got ? 'ok' : 'dim');
        }
      },
    },
    {
      name: 'editor',
      aliases: ['edit'],
      desc: 'open the level editor',
      run: () => app.openEditor(),
    },
    {
      name: 'levels',
      aliases: ['ls-levels'],
      usage: 'levels [play|edit] [n]',
      desc: 'list, play or edit your saved levels',
      run(args, t) {
        const list = app.data.levels;
        if (!list.length) return t.print('no saved levels. make one in the {editor}.', 'dim');
        const n = Number(args[1]) - 1;
        if ((args[0] === 'play' || args[0] === 'edit') && list[n]) {
          if (args[0] === 'play') app.start('custom', { level: list[n] });
          else app.openEditor(list[n]);
          return;
        }
        list.forEach((l, i) => t.print(`${String(i + 1).padStart(2)}. ${l.name.padEnd(20)} {play|levels play ${i + 1}}  {edit|levels edit ${i + 1}}`));
      },
    },
    {
      name: 'set',
      aliases: ['config', 'settings'],
      usage: 'set [key] [value]',
      desc: 'view or change settings',
      run(args, t) {
        if (!args.length) return printSettings(t);
        setSetting(t, args[0].toLowerCase(), args.slice(1).join(' '));
      },
    },
    {
      name: 'theme',
      aliases: ['themes', 'look'],
      usage: 'theme [neo|terminal|nokia|gameboy|paper|minimal]',
      desc: 'change the whole look of the game',
      run(args, t) {
        if (args[0]) {
          const id = args[0].toLowerCase() as ThemeId;
          if (!THEME_ORDER.includes(id)) return t.print(`no theme '${args[0]}'. try {theme}`, 'err');
          s().theme = id;
          app.save();
          app.applySettings();
          return t.print(`theme = ${id}`, 'ok');
        }
        for (const id of THEME_ORDER) {
          t.print(`${s().theme === id ? '*' : ' '} {${id}|theme ${id}}  ${THEMES[id].desc}`);
        }
      },
    },
    { name: 'name', usage: 'name <name>', desc: 'set your player name', run: (a, t) => setSetting(t, 'name', a.join(' ')) },
    { name: 'color', aliases: ['colour'], usage: 'color green|amber|white', desc: 'phosphor colour', run: (a, t) => setSetting(t, 'color', a[0]) },
    { name: 'gui', aliases: ['options'], desc: 'open the settings panel', run: () => app.openSettings() },
    {
      name: 'controls',
      aliases: ['keys'],
      desc: 'how to play',
      run(_a, t) {
        t.print('KEYBOARD', 'title');
        t.print('  arrows/WASD turn   space shed   shift/E ability   P/esc pause   enter retry');
        t.print('GAMEPAD', 'title');
        t.print('  d-pad/stick turn   A shed   B/RB/RT ability   start pause');
        t.print('TOUCH', 'title');
        t.print('  swipe turn   two-finger tap shed   double-tap or hold ability');
        t.print('MECHANICS', 'title');
        t.print('  COIL   close a loop with your body (and shed skin): everything inside is captured');
        t.print('  SHED   drop half your tail as a wall for 15s. bosses fall for it');
        t.print("  HEX    versus only: the shed key costs 2 tail segments and flips the other snake's controls for 2.5s (8s cooldown)");
        t.print('  COMBO  eat within 2s for up to x4. longer snakes score more');
        t.print('  arcade: clear levels, draft mutations, beat bosses every 5th level, 1 rewind per run');
      },
    },
    {
      name: 'accept',
      aliases: ['y', 'yes'],
      desc: 'accept a challenge link',
      run(_a, t) {
        if (!app.pendingChallenge()) return t.print('no pending challenge.', 'dim');
        app.acceptChallenge();
      },
    },
    {
      name: 'decline',
      aliases: ['n', 'no'],
      desc: 'ignore a challenge link',
      run(_a, t) {
        if (!app.pendingChallenge()) return t.print('no pending challenge.', 'dim');
        app.declineChallenge();
        t.print('challenge dismissed.', 'dim');
      },
    },
    { name: 'clear', aliases: ['cls'], desc: 'clear the screen', run: (_a, t) => t.clear() },
    {
      name: 'about',
      aliases: ['version', 'readme'],
      desc: 'about this program',
      run(_a, t) {
        t.print('SSSnake // slither. shed. surge.', 'title');
        t.print('a terminal remix of snake: coils, mutations, bosses, rhythm, versus, online play.');
        t.print('built with vite + typescript + canvas. no trackers, no accounts.', 'dim');
      },
    },
    // Easter eggs
    { name: 'whoami', hidden: true, desc: 'who are you', run: (_a, t) => t.print(s().name || 'guest') },
    {
      name: 'ls',
      aliases: ['dir'],
      hidden: true,
      desc: 'list files',
      run: (_a, t) => t.print('arcade.exe  classic.exe  daily.exe  zen.exe  rhythm.exe  endless.exe  versus.exe  editor.exe  readme.txt  scores.db'),
    },
    {
      name: 'cat',
      hidden: true,
      desc: 'print a file',
      run(a, t) {
        if (a[0] === 'readme.txt') return void t.exec('about', false);
        if (a[0] === 'scores.db') return void t.exec('scores --local', false);
        t.print(`cat: ${a[0] ?? ''}: permission denied (it's a snake, not a cat)`, 'err');
      },
    },
    { name: 'sudo', hidden: true, desc: 'nice try', run: (_a, t) => t.print('user is not in the sudoers file. this incident will be reported to the snake.', 'err') },
    { name: 'exit', aliases: ['quit', 'logout'], hidden: true, desc: 'leave', run: (_a, t) => t.print('there is no escape. type {play}.', 'dim') },
    { name: 'rm', hidden: true, desc: 'remove', run: (_a, t) => t.print('rm: refusing to shed the whole filesystem.', 'err') },
    { name: 'hack', hidden: true, desc: 'hack', run: (_a, t) => t.print('access granted. just kidding. {play} arcade and coil a firewall.', 'ok') },
  ];
  return commands;
}
