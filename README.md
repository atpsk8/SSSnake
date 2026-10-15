# SSSnake

**Slither. Shed. Surge.** A neon remix of Snake for the browser. The classic grid is still there, plus coils, mutations, bosses, arena twists, four snake types, rhythm and versus modes, a level editor, shareable challenges and leaderboards.

## Play

| Action | Keyboard | Touch |
| --- | --- | --- |
| Turn | Arrows / WASD | Swipe anywhere on the play area (optional D-pad in Settings) |
| Shed | Space | Two-finger tap or the **Shed** button |
| Ability | Shift / E (hold or tap, depending on snake type) | Press and hold, double-tap, or the ability button |
| Pause | P / Esc | ❚❚ button |
| Retry | Enter / R | Play again |
| Versus | P1: WASD, Q shed, E ability · P2: Arrows, / shed, . ability | Each player swipes on their own half of the screen |

### Core mechanics

- **Coil:** close a loop with your body (your own shed skin counts too) and everything inside is captured. Food scores x2, and mice, mines, rivals and bosses can all be caught.
- **Shed:** drop the back half of your tail as a wall for 15 seconds. Longer snakes score more, so shedding trades points for room. Bosses fall for it.
- **Combos:** eat again within 2 seconds for x2, x3 and up to x4.
- **Rewind:** Arcade and Daily runs get one rewind, which undoes your last few seconds when you die.

### Snake types

| Type | Ability | Unlocked by |
| --- | --- | --- |
| Racer | Surge (hold): faster, points x2 | Available from the start |
| Viper | Dash (tap): lunge three cells, passing through yourself | Reach level 5 |
| Cobra | Spit (tap): breaks walls, mines, mice and rivals; hurts bosses | Defeat a boss |
| Python | Hunker (hold): freeze in place; coils score more | Capture 3+ things in one coil |

### Modes

- **Classic:** pure Snake.
- **Arcade:** levels rotate through five arenas. Clear a level to draft one of 20 **mutations**. Every 5th level is a **boss** (Serpent King or Swarm Queen). From level 6, **twists** appear: ice, darkness, gravity wells, arrow tiles, mirror and ripening food.
- **Daily:** Arcade on a date-seeded run, against a ghost of your best run that day.
- **Zen:** no death, soft music.
- **Rhythm:** moves follow the beat. On-beat turns build a groove multiplier up to x4, and the tempo rises.
- **Versus:** two players on one device, best of three, with sudden death after 90 s.
- **Custom:** levels from the editor or a shared link.

### Editor and challenge links

The level editor (from the main menu) paints walls, portals, mines, gravity wells, arrow tiles and the spawn point. It also sets twists and a food goal. You can test a level, save it on this device, or **share a link**. After any run, **Share challenge link** makes a URL that opens the same seed (or level) with your score as the target.

### Leaderboards and achievements

- **This device:** top 10 per board (Arcade, Daily, Classic, Rhythm), stored in `localStorage`. Always available.
- **Global:** top 20 per board, served by `api/scores.js` (a Vercel function) backed by Upstash Redis. Players submit scores from the game-over screen by choice. The server checks scores are plausible, validates names and boards, and rate-limits each IP to 10 submissions a minute. Scores are not verified by replaying the game, so a determined cheater could still post fake ones.
- **Achievements:** 18, which unlock snake types and skins.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173 (no /api locally; the game falls back to local scores)
npm test         # Vitest: engine rules, v2 mechanics, bot soak test in every mode, codecs, API
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build
```

The stack is Vite, TypeScript and Canvas 2D, with no runtime dependencies. Sound is generated with the Web Audio API.

- `src/game/`: the deterministic engine (`engine.ts`), plus arenas, levels, modes, snake types, mutations, coil detection and the seeded RNG.
- `src/render.ts`, `src/audio.ts`, `src/input.ts`: drawing, sound and controls.
- `src/main.ts`, `src/editor.ts`: UI, screens, game loop and the level editor.
- `src/storage.ts`, `src/progress.ts`, `src/ghost.ts`, `src/share.ts`, `src/leaderboard.ts`: saves, achievements, ghosts, challenge links and the leaderboard client.
- `api/scores.js`, `api/_lib.js`: the global leaderboard endpoint. Files starting with `_` are not deployed as endpoints.
- `docs/V2_DESIGN.md`: the design reference.

## Deploy (Vercel)

`vercel.json` sets the Vite preset, `npm run build` and the `dist/` output. Vercel picks up `api/` automatically.

```bash
npx vercel          # preview deployment
npx vercel --prod   # production
```

To switch on the **global leaderboard**, open the Vercel project, go to **Storage**, and add **Upstash for Redis** (Marketplace). Connect it to the project and redeploy. The function reads `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` / `KV_REST_API_TOKEN`). Until then it answers `503`, and the game shows scores from the player's device only.
