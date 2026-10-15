# SSSnake

**Slither. Shed. Surge.** A remix of Snake with five swappable looks, a working command line as the menu, and online versus by invite code. Underneath are coils, mutations, bosses, arena twists, four snake types, rhythm mode, a level editor, challenge links and leaderboards.

## Themes

Type `theme` (or use the settings panel) to switch the whole look. The board, windows, fonts and colours all change live:

| Theme | Look |
| --- | --- |
| `terminal` | Soft phosphor command line. `set color green\|amber\|white`; `set crt soft\|full\|off` controls scanlines, glow and flicker. |
| `nokia` | Grey-green LCD with dark pixels, a nod to the original Snake. |
| `gameboy` | Four shades of green, chunky pixels. |
| `paper` | Ink doodles on warm ruled paper. Light and calm. |
| `minimal` | Pastel flat colours and a rounded snake. |

Terminal, Nokia and Game Boy draw on a block grid. Paper and Minimal draw a continuous snake body and drawn shapes for items.

## The command line

The game boots into a terminal. Type a command, click a highlighted one, or tap a chip (on phones).

| Command | What it does |
| --- | --- |
| `play [mode]` | Start `arcade` (default), `classic`, `daily`, `zen` or `rhythm`. Each mode also works on its own as a command. |
| `versus` | Two players on one device. |
| `invite` | Host an online match: prints a 4-character room code and a join link. |
| `join <code>` | Join a friend's online match. Opening a `#join=CODE` link does this automatically. |
| `snake [type]` | List or pick a snake type (`racer`, `viper`, `cobra`, `python`). |
| `theme [name]` | `terminal`, `nokia`, `gameboy`, `paper`, `minimal`. |
| `skin [name]` | `solid`, `scanline`, `wireframe`, `overclock`. |
| `scores [board] [--local]` | Leaderboards: `arcade`, `daily`, `classic`, `rhythm`. |
| `trophies`, `stats` | Achievements and personal bests. |
| `editor`, `levels` | The level editor and your saved levels. |
| `set [key value]` | Settings: `name`, `theme`, `color green\|amber\|white`, `crt soft\|full\|off`, `sound`, `music`, `motion full\|reduced`, `touch swipe\|dpad`. |
| `help`, `controls`, `clear`, `about` | — |

Tab completes commands, Up/Down recalls history, and Esc / Ctrl+C / `cancel` stops `invite` or `join`. There are a few easter eggs too.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Turn | Arrows / WASD | Swipe anywhere (optional D-pad: `set touch dpad`) |
| Shed | Space | Two-finger tap or **shed** |
| Ability | Shift / E | Press and hold, double-tap, or the ability button |
| Pause | P / Esc | `\|\|` |
| Local versus | P1: WASD, Q shed, E ability · P2: Arrows, / shed, . ability | Each player swipes on their own half |

## Mechanics in brief

- **Coil:** close a loop with your body (your shed skin counts) and everything inside is captured.
- **Shed:** drop half your tail as a 15-second wall.
- **Combos:** up to x4, and length raises your multiplier.
- **Arcade:** draft a mutation (from 20) after each level. Every 5th level is a boss (Serpent King / Swarm Queen). From level 6, twists appear: ice, darkness, gravity wells, arrow tiles, mirror and ripening. You get one rewind per run.
- **Snake types:** Racer (Surge), Viper (Dash), Cobra (Spit) and Python (Hunker). The last three unlock through achievements.

## Online versus

`invite` creates a room and prints a code; a friend runs `join CODE` or opens the link. The browsers then connect **directly** (WebRTC, peer to peer):

- **Matchmaking:** `api/room.js` only swaps the two connection offers. Rooms expire after 10 minutes and are deleted once connected.
- **Netcode:** deterministic **lockstep**. Both players run the same simulation from the same seed and send only their key presses. Input delay is set from the measured ping (3–12 frames). Checksums every 30 frames detect any drift.
- **Format:** best of three, with sudden death after 90 seconds. Each player brings their own snake type.
- **Privacy:** like any peer-to-peer game, each player's IP address is visible to the other.
- **Network limits:** there is no relay (TURN) server, so some strict networks (some offices, schools or mobile carriers) can't connect directly. The game then says so.

## Leaderboards and achievements

- **Local:** top 10 per board, always available.
- **Global:** top 20 per board, served by `api/scores.js`, with plausibility checks, validation and rate limits. It only receives a score when the player chooses to submit it.
- **Achievements:** 18, which unlock snake types and skins.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173 (serves /api from memory, so online play and scores work locally)
npm test         # engine, mechanics, bot soak, codecs, API handlers, lockstep netcode
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build (no /api)
```

To try online play locally, open two browser windows on `http://localhost:5173`. Run `invite` in one and `join <code>` in the other.

The stack is Vite, TypeScript and Canvas 2D. Fonts are IBM Plex Mono, VT323, Silkscreen, Patrick Hand and Nunito (bundled through Fontsource), and sound is generated with the Web Audio API.

- **Engine:** `src/game/` is the deterministic engine; online play relies on it being deterministic.
- **Netcode:** `src/net/` has `lockstep.ts`, `online.ts` (match flow) and `peer.ts` (WebRTC and signaling).
- **Front end:** `src/terminal.ts` and `src/commands.ts` (the command line), `src/render.ts` and `src/themes.ts` (theme-aware renderer), `src/main.ts` (UI wiring) and `src/editor.ts`.
- **API:** `api/scores.js` and `api/room.js` are the Vercel functions. `api/_lib.js` and `api/_memory.js` are shared code (files starting with `_` aren't deployed as endpoints).

## Deploy (Vercel)

```bash
npx vercel          # preview
npx vercel --prod   # production
```

Both the **global leaderboard** and **online versus** need a key-value store. In the Vercel project, go to **Storage**, add **Upstash for Redis** (Marketplace), connect it, and redeploy. The functions read `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`). Without a store, the leaderboard falls back to local scores, and `invite` / `join` explain that online play isn't set up.
