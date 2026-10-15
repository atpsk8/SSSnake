# SSSnake

**Slither. Shed. Surge.** A neon remix of Snake for the browser. It keeps the classic grid, growth and self-collision, and adds a couple of new moves plus power-ups, hazards, arenas and modes.

## Play

| Action | Keyboard | Touch |
| --- | --- | --- |
| Turn | Arrows / WASD | Swipe anywhere on the play area (optional D-pad in Settings) |
| Shed | Space | Two-finger tap or the **Shed** button |
| Surge | Hold Shift | Hold the **Surge** button |
| Pause | P / Esc | ❚❚ button |
| Retry | Enter / R | Play again |

- **Shed** drops the back half of your tail (needs length 6 or more). The dropped skin becomes a wall for 15 seconds. Length multiplies your score, so shedding trades points for room.
- **Surge** speeds you up and doubles points while it lasts. Eating refills the meter.
- **Combos**: eat again within 2 seconds for x2, x3 and up to x4.

### Modes

- **Classic**: pure Snake, no extras.
- **Arcade**: levels rotate through five arenas (Classic Box, Wraparound, Portals, Shifting Maze, Collapse). It has power-ups, mines, mice and a rival snake from level 3. Clearing a level banks your length as bonus points.
- **Daily**: Arcade rules on a date-seeded run, so everyone gets the same spawns that day.
- **Zen**: no death. Edges wrap, self-hits trim your tail, and soft music plays.

### Power-ups

Phase (pass through yourself), Slow-Mo, Magnet (pulls food), Shrink (drop 3 segments) and Golden (big points, short-lived).

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # Vitest: engine rules + bot soak test
npm run build    # type-check + production build to dist/
npm run preview  # serve the production build
```

The stack is Vite, TypeScript and Canvas 2D, with no runtime dependencies. Sound is generated with the Web Audio API, and scores and settings are stored in `localStorage`.

- `src/game/`: the deterministic game engine, independent of the DOM (`engine.ts`), plus arenas, modes and the seeded RNG.
- `src/render.ts`: the canvas renderer, which interpolates between steps and draws particles and popups.
- `src/input.ts`, `src/audio.ts`, `src/storage.ts`, `src/main.ts`: input, sound, saves, and UI/game loop wiring.

## Deploy (Vercel)

This is a static site. `vercel.json` sets the Vite preset, `npm run build` and the `dist/` output, plus long-lived caching for hashed assets.

```bash
npx vercel          # preview deployment
npx vercel --prod   # production
```

Or import the Git repository in the Vercel dashboard; it needs no extra configuration or environment variables.
