# SSSnake v2 design

The goal is a signature mechanic (Coil) plus run-to-run variety (Mutations, snake types, twists, bosses), more ways to play (Rhythm, Versus, Custom), and reasons to come back (ghosts, challenge links, achievements).

## Coil
If your body, optionally together with your own shed walls, closes a loop, every cell inside the loop is enclosed.
- Pickups inside are eaten, and coil points are doubled.
- Mice are caught.
- Mines are defused (+15 each).
- A rival whose head is inside dies.
- A boss whose head or core is inside takes damage.
- Static walls do not count as part of the loop; only your body and your shed skin do. Enclosure is found by flood fill from the board edge.

## Mutations (Arcade and Daily)
After each level, and after a boss, you draft 1 of 3 random mutations. Daily drafts are seeded. Most can be taken once; Armour and Rewind stack.

| Id | Name | Effect |
| --- | --- | --- |
| forked | Forked Tongue | Eat pickups next to your head (including diagonally) |
| longmolt | Long Molt | Shed walls last twice as long |
| quickmolt | Quick Molt | Shed cooldown halved; can shed at length 4 |
| venom | Venom Skin | Rivals and bosses take damage from your shed walls instead of avoiding them |
| ouroboros | Ouroboros | Biting yourself cuts the tail off instead of killing you |
| armour | Molt Armour | Survive one lethal hit per stack (lose half your length) |
| scales | Magnetic Scales | Permanent short-range magnet |
| midas | Midas | Golden spawns twice as often and lasts longer |
| glutton | Glutton | Food is worth +50% but grows you twice as much |
| dense | Dense Body | The length multiplier rises every 5 segments instead of 8 |
| adrenaline | Adrenaline | Ability meter drains 40% slower |
| secondwind | Second Wind | A x3 combo refills your ability meter |
| keeper | Combo Keeper | Combo window 3 s instead of 2 s |
| rattle | Rattle | Two quick turns send a stun wave that freezes nearby enemies |
| constrictor | Constrictor | Coil points x3 instead of x2 |
| mineeater | Mine Eater | Unlit mines can be eaten for points |
| lucky | Lucky | Power-ups spawn 40% more often |
| blastshed | Blast Shed | Shedding destroys mines near the dropped skin |
| timethief | Time Thief | Slow-Mo and Phase last twice as long |
| rewindplus | Extra Rewind | +1 rewind charge |

## Snake types (the ability key replaces Surge)
| Type | Ability | Unlock |
| --- | --- | --- |
| Racer | Surge: hold to boost, points x2 | Available from the start |
| Viper | Dash: three instant steps, passing through yourself | Reach level 5 in Arcade |
| Cobra | Spit: a projectile that breaks walls, mines, mice and rivals, and damages bosses | Defeat a boss |
| Python | Hunker: hold to freeze in place; coils score extra | Coil 3+ things at once |

## Bosses (every 5th Arcade or Daily level)
- **Serpent King** (odd boss levels): a long, fast hunter. It ignores your shed walls, so luring it into them deals damage. Coiling its head or Cobra spit also deals damage. Each hit costs it 3 segments. HP 3, plus 1 per later appearance.
- **Swarm Queen** (even boss levels): a 2×2 core that is always solid. It spawns drones and lays mines. Eating 4 drones drops her shield for 4 s; while the shield is down, being next to her, coiling her or spitting at her deals damage.
- A boss level ends when the boss dies.

## Arena twists (random from Arcade level 6; any of them in the editor)
- **Ice:** a turn takes effect one step late.
- **Darkness:** you can only see within about 5 cells of your head (pickups glow faintly).
- **Gravity wells:** pull pickups toward them.
- **Arrow tiles:** stepping on one forces your direction.
- **Mirror:** controls are flipped.
- **Ripening:** food gains value over time, then rots. Rotten food shrinks you.

## Rewind
Arcade and Daily give one rewind per run (Extra Rewind adds more). On death, the game restores the state from about 3 seconds earlier and gives you 1.5 s of phase.

## Modes
- **Classic:** unchanged.
- **Arcade:** levels, drafts, bosses, twists.
- **Daily:** Arcade, date-seeded, against your ghost from your best run today.
- **Zen:** unchanged.
- **Rhythm:** fixed-tempo steps with a beat. Turns on the beat build a streak multiplier (up to x4); off-beat turns reset it. The tempo rises over time.
- **Versus:** two players on one device, best of 3 rounds. P1 uses WASD, Q to shed, E for ability. P2 uses the arrows, / to shed, . for ability. On touch, each player swipes on their own half of the screen; a two-finger tap sheds and a double tap uses the ability. Shed walls are deadly to both players.
- **Custom:** levels made in the editor or opened from a link.

## Ghosts
The best Daily run of the day is recorded as head position and length per step, keyed by game time, and stored locally. Later Daily runs that day show it as a translucent snake.

## Challenge and level links
- The URL hash `#c=` holds base64url JSON: version, kind (`run` or `level`), mode, seed, target score, and, for levels, the encoded layout (wall bitset, portals, mines, wells, arrows, spawn, twists and toggles).
- After a run, **Share challenge** copies a link. Opening a link shows a challenge card with the target.

## Level editor
- **Tools:** wall, erase, portal pair, mine, gravity well, arrow (cycles direction), spawn.
- **Toggles:** wrap, collapse, each twist, rival, mice, power-ups.
- **Goal:** a food count or a score target.
- **Actions:** Test, Share link, Save to "My levels" (stored locally).

## Achievements and unlocks
About 18 achievements are tracked locally, and a toast appears when one unlocks. They unlock snake types and snake skins (Classic, Ember, Ghost, Gold).

## v3: terminal + online (added after playtesting)

- **Look:** green CRT phosphor (`set color amber|white` for alternatives) with scanlines, flicker and glow. The board is a character grid: solid blocks for snakes and walls, glyphs for items (`@` food, `$` golden, `*` mines, `m` mice, `A`/`B` portals, `#` walls, `<>^v` arrows). Movement is discrete. Particles are "data bits".
- **Command line:** the main menu is a working terminal (`src/terminal.ts`, `src/commands.ts`). The old menu, help, leaderboard, achievements and challenge overlays became commands.
- **Online versus:** invite codes through `api/room.js` and a WebRTC data channel. Deterministic lockstep (`src/net/lockstep.ts`) sends inputs only, with ping-based input delay and periodic checksums. `src/net/online.ts` handles rounds and rematches.
