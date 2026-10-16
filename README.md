# SSSnake

**Slither. Shed. Surge.** A next-gen remix of Snake. It has a 3D neon mode with a cinematic camera, five more swappable looks, a command line as the menu, online versus (quick match with strangers or invite codes), CPU opponents, instant replays and video clips, an adaptive soundtrack, gamepad support, and replay-verified leaderboards. Underneath are coils, mutations, bosses, arena twists, four snake types, rhythm mode, a level editor and a daily challenge.

## Themes

Type `theme` (or use the settings panel) to switch the whole look. The board, windows, fonts and colours all change live:

| Theme | Look |
| --- | --- |
| `neo` | **3D**: glossy neon tube snakes on a reflective arena, bloom, particles and light shockwaves, and a follow camera that swoops in for instant replays. `set quality high\|low`. three.js is loaded only when this theme is used. |
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
| `versus` | Two players on one device. `versus cpu hard` (or `cpu easy\|normal\|hard`) plays the computer. |
| `match` | Play a random opponent online (public quick-match queue). |
| `invite` | Host an online match: prints a 4-character room code and a join link. |
| `join <code>` | Join a friend's online match. Opening a `#join=CODE` link does this automatically. |
| `snake [type]` | List or pick a snake type (`racer`, `viper`, `cobra`, `python`). |
| `theme [name]` | `terminal`, `nokia`, `gameboy`, `paper`, `minimal`. |
| `skin [name]` | `solid`, `scanline`, `wireframe`, `overclock`. |
| `scores [board] [--local]` | Leaderboards: `arcade`, `daily`, `classic`, `rhythm`. Global entries have a **watch** link. |
| `watch last` / `watch <id>` | Replay your last run, or a leaderboard run. |
| `netcheck` | Checks that online play is set up (store, relay, WebRTC). |
| `trophies`, `stats` | Achievements and personal bests. |
| `editor`, `levels` | The level editor and your saved levels. |
| `set [key value]` | Settings: `name`, `theme`, `color green\|amber\|white`, `crt soft\|full\|off`, `sound`, `music`, `motion full\|reduced`, `touch swipe\|dpad`. |
| `help`, `controls`, `clear`, `about` | — |

Tab completes commands, Up/Down recalls history, and Esc / Ctrl+C / `cancel` stops `invite` or `join`. There are a few easter eggs too.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Turn | Arrows / WASD | Swipe anywhere (optional D-pad: `set touch dpad`) |
| Shed (Hex in versus) | Space | Two-finger tap or **shed** |
| Ability | Shift / E | Press and hold, double-tap, or the ability button |
| Pause | P / Esc | `\|\|` |
| Local versus | P1: WASD, Q hex, E ability · P2: Arrows, / hex, . ability | Each player swipes on their own half |
| Gamepad | D-pad/stick turn, A shed, B/RB/RT ability, Start pause (two pads = two players) | |

## Mechanics in brief

- **Coil:** close a loop with your body (your shed skin counts) and everything inside is captured.
- **Shed:** drop half your tail as a 15-second wall.
- **Hex (versus only):** in versus the shed key casts Hex instead. It costs 2 tail segments and needs a length of 6. Your opponent flashes for 0.4 s, then their controls are flipped for 2.5 s. Cooldown 8 s (5 s in sudden death), no hexes in the first 3 s of a round, and a hexed snake is immune for 3 s afterwards.
- **Combos:** up to x4, and length raises your multiplier.
- **Arcade:** draft a mutation (from 20) after each level. Every 5th level is a boss (Serpent King / Swarm Queen). From level 6, twists appear: ice, darkness, gravity wells, arrow tiles, mirror and ripening. You get one rewind per run.
- **Snake types:** Racer (Surge), Viper (Dash), Cobra (Spit) and Python (Hunker). The last three unlock through achievements.

## Replays, clips and feel

- **Deterministic runs:** every local run steps at a fixed 16 ms and records only its inputs. A run is a few KB and replays exactly.
- **Instant replay:** when you die, the last 3 seconds play back in slow motion with the camera zooming in. `set deathcam off` disables it.
- **Watch:** after a run, you can replay the whole thing, or watch top leaderboard runs.
- **Video clips:** "save video clip" records the last 8 seconds (with sound) to MP4 or WebM, or opens the share sheet on phones.
- **Adaptive music:** a synthesised soundtrack that builds with your combo, length, bosses and surge, with a filter "drop" on level-ups.
- **Haptics:** phone vibration and controller rumble on hits, coils, bosses and deaths (`set haptics off`).
- **CPU opponents:** three personalities (hunter, collector, trickster) and three difficulties.

## Online versus

`match` puts you in a public queue and pairs you with the next player; `invite` creates a private room and prints a code that a friend joins with `join CODE` or the link. The browsers then connect **directly** (WebRTC, peer to peer), or through a TURN relay when a direct path is blocked:

- **Matchmaking:** `api/room.js` only swaps the two connection offers. Rooms expire after 10 minutes and are deleted once connected.
- **Netcode:** deterministic **lockstep**. Both players run the same simulation from the same seed and send only their key presses. Input delay is set from the measured ping (3–12 frames). Checksums every 30 frames detect any drift.
- **Format:** best of three on a 48×48 board whose edges wrap around (the walls don't kill), with four food on the board at once. After 90 seconds sudden death starts: both snakes speed up every 10 seconds. Each player brings their own snake type. Space casts Hex on your opponent, and the hexed player's screen pulses purple until it wears off.
- **Privacy:** like any peer-to-peer game, each player's IP address is visible to the other.
- **Relay:** `/api/ice` hands out TURN relay credentials (Cloudflare or any TURN provider) so players on strict networks can still connect. **Setup steps are in [docs/ONLINE_SETUP.md](docs/ONLINE_SETUP.md).**

## Leaderboards and achievements

- **Local:** top 10 per board, always available.
- **Global:** top 20 per board, served by `api/scores.js`. It only receives a score when the player chooses to submit it. Each submission includes the run's replay. The server **re-runs it with the game engine** (`api/_engine.js`, built from `src/` by `npm run build:engine`) and records only the score the simulation actually produces, so edited scores are rejected. Replays are kept for 30 days and can be watched.
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
- **Netcode:** `src/net/` has `lockstep.ts`, `online.ts` (match flow) and `peer.ts` (WebRTC, signaling, quick match).
- **Replays and play systems:** `src/replay.ts` (format, simulation, server-side verification), `src/runner.ts` (fixed-step driver), `src/bot.ts` (CPU), `src/music.ts`, `src/feel.ts` (haptics, gamepads) and `src/clip.ts` (video).
- **3D:** `src/render3d.ts` (lazy-loaded three.js renderer).
- **Front end:** `src/terminal.ts` and `src/commands.ts` (the command line), `src/render.ts` and `src/themes.ts` (theme-aware renderer), `src/main.ts` (UI wiring) and `src/editor.ts`.
- **API:** `api/scores.js`, `api/room.js`, `api/ice.js` and `api/replay.js` are the Vercel functions. `api/_lib.js`, `api/_memory.js` and the generated `api/_engine.js` are shared code (files starting with `_` aren't deployed as endpoints).

## Deploy (Vercel)

The full checklist for going live with online play is in **[docs/ONLINE_SETUP.md](docs/ONLINE_SETUP.md)**:
1. Log in to Vercel.
2. Link and deploy.
3. Add Upstash for Redis (Storage tab).
4. Optionally add a TURN relay (Cloudflare or another provider).
5. Redeploy.
6. Run `netcheck`.

```bash
npx vercel login
npx vercel link
npx vercel deploy --prod
```
