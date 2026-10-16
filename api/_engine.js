//#region src/game/arenas.ts
function hLine(y, x0, x1) {
	const out = [];
	for (let x = x0; x <= x1; x++) out.push({
		x,
		y
	});
	return out;
}
function vLine(x, y0, y1) {
	const out = [];
	for (let y = y0; y <= y1; y++) out.push({
		x,
		y
	});
	return out;
}
function block(x0, y0, x1, y1) {
	const out = [];
	for (let y = y0; y <= y1; y++) out.push(...hLine(y, x0, x1));
	return out;
}
var MAZES = [
	[
		...hLine(6, 4, 10),
		...hLine(6, 13, 19),
		...hLine(17, 4, 10),
		...hLine(17, 13, 19)
	],
	[
		...vLine(6, 3, 9),
		...vLine(6, 15, 20),
		...vLine(17, 3, 9),
		...vLine(17, 15, 20)
	],
	[
		...block(8, 4, 9, 5),
		...block(14, 4, 15, 5),
		...block(8, 18, 9, 19),
		...block(14, 18, 15, 19),
		...hLine(9, 10, 13),
		...hLine(15, 10, 13)
	]
];
var ARENAS = {
	box: {
		id: "box",
		name: "Classic Box",
		blurb: "Four walls. No excuses.",
		wrap: false,
		walls: [],
		portals: [],
		mazes: [],
		collapse: false
	},
	wrap: {
		id: "wrap",
		name: "Wraparound",
		blurb: "Edges loop to the other side.",
		wrap: true,
		walls: [],
		portals: [],
		mazes: [],
		collapse: false
	},
	portals: {
		id: "portals",
		name: "Portals",
		blurb: "Enter one ring, exit its twin.",
		wrap: false,
		walls: [...block(11, 7, 12, 9), ...block(11, 15, 12, 17)],
		portals: [[{
			x: 3,
			y: 3
		}, {
			x: 20,
			y: 20
		}], [{
			x: 20,
			y: 3
		}, {
			x: 3,
			y: 20
		}]],
		mazes: [],
		collapse: false
	},
	maze: {
		id: "maze",
		name: "Shifting Maze",
		blurb: "Walls rearrange every few bites.",
		wrap: false,
		walls: [],
		portals: [],
		mazes: MAZES,
		collapse: false
	},
	collapse: {
		id: "collapse",
		name: "Collapse",
		blurb: "The border closes in. Keep moving.",
		wrap: false,
		walls: [],
		portals: [],
		mazes: [],
		collapse: true
	}
};
var ARENA_ORDER = [
	"box",
	"wrap",
	"portals",
	"maze",
	"collapse"
];
//#endregion
//#region src/game/classes.ts
var CLASSES$1 = {
	racer: {
		id: "racer",
		name: "Racer",
		ability: "Surge",
		desc: "Hold to boost. Points count double while surging.",
		hold: true,
		cost: 1 / 2200,
		unlock: "Available from the start"
	},
	viper: {
		id: "viper",
		name: "Viper",
		ability: "Dash",
		desc: "Tap to lunge three cells at once, slipping through your own body.",
		hold: false,
		cost: .34,
		unlock: "Reach level 5 in Arcade"
	},
	cobra: {
		id: "cobra",
		name: "Cobra",
		ability: "Spit",
		desc: "Tap to spit venom that breaks walls, mines, mice and rivals, and hurts bosses.",
		hold: false,
		cost: .34,
		unlock: "Defeat a boss"
	},
	python: {
		id: "python",
		name: "Python",
		ability: "Hunker",
		desc: "Hold to freeze in place. Coils score one extra multiplier.",
		hold: true,
		cost: 1 / 1500,
		unlock: "Capture 3 or more things in one coil"
	}
};
//#endregion
//#region src/game/types.ts
var DIRS = {
	up: {
		x: 0,
		y: -1
	},
	down: {
		x: 0,
		y: 1
	},
	left: {
		x: -1,
		y: 0
	},
	right: {
		x: 1,
		y: 0
	}
};
var DIR_LIST = [
	"up",
	"right",
	"down",
	"left"
];
var OPPOSITE = {
	up: "down",
	down: "up",
	left: "right",
	right: "left"
};
var eq = (a, b) => a.x === b.x && a.y === b.y;
var add = (a, b) => ({
	x: a.x + b.x,
	y: a.y + b.y
});
var manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
var chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
//#endregion
//#region src/game/coil.ts
/**
* Cells sealed off from the board edge by `barrier` cells (4-connected flood fill from the
* border). Returns a mask: 1 = enclosed, 0 = outside or barrier.
*/
function findEnclosed(barrier, W = 24, H = 24) {
	const seen = new Uint8Array(W * H);
	const stack = [];
	const push = (i) => {
		if (!seen[i] && !barrier[i]) {
			seen[i] = 1;
			stack.push(i);
		}
	};
	for (let x = 0; x < W; x++) {
		push(x);
		push((H - 1) * W + x);
	}
	for (let y = 0; y < H; y++) {
		push(y * W);
		push(y * W + W - 1);
	}
	while (stack.length) {
		const i = stack.pop();
		const x = i % W;
		const y = (i - x) / W;
		if (x > 0) push(i - 1);
		if (x < W - 1) push(i + 1);
		if (y > 0) push(i - W);
		if (y < H - 1) push(i + W);
	}
	const out = new Uint8Array(W * H);
	for (let i = 0; i < W * H; i++) out[i] = !seen[i] && !barrier[i] ? 1 : 0;
	return out;
}
//#endregion
//#region src/game/levels.ts
var MODIFIER_LIST = [
	"ice",
	"dark",
	"wells",
	"arrows",
	"mirror",
	"ripening"
];
var v = (i) => ({
	x: i % 24,
	y: Math.floor(i / 24)
});
var DEFAULT_SPAWN = {
	x: 5,
	y: 12
};
function isBossLevel(level) {
	return level % 5 === 0;
}
function arcadeLevel(level, startArena, rng, opts) {
	const common = {
		wells: [],
		arrows: [],
		mines: [],
		spawn: { ...DEFAULT_SPAWN },
		spawnDir: "right",
		powerUps: true
	};
	if (opts.bosses && isBossLevel(level)) {
		const n = level / 5;
		const boss = n % 2 === 1 ? "serpent" : "queen";
		return {
			...common,
			arena: {
				...ARENAS.box,
				name: boss === "serpent" ? "Serpent King" : "Swarm Queen"
			},
			modifiers: [],
			randomMines: 0,
			rival: false,
			mice: false,
			boss,
			bossTier: Math.ceil(n / 2),
			goalFoods: 0
		};
	}
	const arena = ARENAS[ARENA_ORDER[(startArena + (level - 1 - (opts.bosses ? Math.floor((level - 1) / 5) : 0))) % ARENA_ORDER.length]];
	const modifiers = [];
	if (opts.twists && level >= 6) {
		const pool = MODIFIER_LIST.filter((m) => !(arena.wrap && m === "mirror" && level < 8));
		const count = level >= 11 ? 2 : 1;
		while (modifiers.length < count) {
			const m = rng.pick(pool);
			if (!modifiers.includes(m)) modifiers.push(m);
		}
	}
	return {
		...common,
		arena,
		modifiers,
		randomMines: opts.hazards && level >= 2 ? Math.min(level, 6) : 0,
		rival: opts.hazards && level >= 3,
		mice: opts.hazards,
		boss: null,
		bossTier: 0,
		goalFoods: 8 + level * 2
	};
}
function simpleLevel(arenaId, powerUps) {
	return {
		arena: ARENAS[arenaId],
		modifiers: [],
		wells: [],
		arrows: [],
		mines: [],
		randomMines: 0,
		rival: false,
		mice: false,
		powerUps,
		boss: null,
		bossTier: 0,
		spawn: { ...DEFAULT_SPAWN },
		spawnDir: "right",
		goalFoods: 0
	};
}
function levelFromData(d) {
	return {
		arena: {
			id: "custom",
			name: d.name || "Custom level",
			blurb: "",
			wrap: d.wrap,
			walls: d.walls.map(v),
			portals: d.portals.map(([a, b]) => [v(a), v(b)]),
			mazes: [],
			collapse: d.collapse
		},
		modifiers: [...d.modifiers],
		wells: d.wells.map(v),
		arrows: d.arrows.map(([i, dir]) => ({
			pos: v(i),
			dir
		})),
		mines: d.mines.map(v),
		randomMines: 0,
		rival: d.rival,
		mice: d.mice,
		powerUps: d.powerUps,
		boss: null,
		bossTier: 0,
		spawn: v(d.spawn),
		spawnDir: d.spawnDir,
		goalFoods: d.goal
	};
}
function emptyLevel() {
	return {
		name: "My level",
		walls: [],
		portals: [],
		mines: [],
		wells: [],
		arrows: [],
		spawn: DEFAULT_SPAWN.y * 24 + DEFAULT_SPAWN.x,
		spawnDir: "right",
		wrap: false,
		collapse: false,
		modifiers: [],
		rival: false,
		mice: true,
		powerUps: true,
		goal: 30
	};
}
/** Sanitise untrusted level data (e.g. from a link). Returns null if unusable. */
function sanitizeLevel(raw) {
	if (!raw || typeof raw !== "object") return null;
	const r = raw;
	const cell = (n) => Number.isInteger(n) && n >= 0 && n < 576 ? n : null;
	const cells = (a, max) => Array.isArray(a) ? [...new Set(a.map(cell).filter((n) => n !== null))].slice(0, max) : [];
	const dir = (d) => DIR_LIST.includes(d) ? d : "right";
	const base = emptyLevel();
	const spawn = cell(r.spawn) ?? base.spawn;
	const walls = cells(r.walls, 576).filter((i) => i !== spawn);
	const portals = Array.isArray(r.portals) ? r.portals.map((p) => Array.isArray(p) ? [cell(p[0]), cell(p[1])] : [null, null]).filter((p) => p[0] !== null && p[1] !== null && p[0] !== p[1]).slice(0, 4) : [];
	const arrows = Array.isArray(r.arrows) ? r.arrows.map((a) => Array.isArray(a) ? [cell(a[0]), dir(a[1])] : [null, "right"]).filter((a) => a[0] !== null).map(([i, d]) => [i, d]).slice(0, 60) : [];
	const mods = Array.isArray(r.modifiers) ? r.modifiers.filter((m) => MODIFIER_LIST.includes(m)) : [];
	const goal = Number.isInteger(r.goal) ? Math.max(0, Math.min(999, r.goal)) : base.goal;
	return {
		name: typeof r.name === "string" ? r.name.slice(0, 32) : base.name,
		walls,
		portals,
		mines: cells(r.mines, 40),
		wells: cells(r.wells, 6),
		arrows,
		spawn,
		spawnDir: dir(r.spawnDir),
		wrap: r.wrap === true,
		collapse: r.collapse === true,
		modifiers: [...new Set(mods)],
		rival: r.rival === true,
		mice: r.mice !== false,
		powerUps: r.powerUps !== false,
		goal
	};
}
//#endregion
//#region src/game/rng.ts
/** Small seeded PRNG (mulberry32) so Daily Challenge runs are reproducible. */
var Rng = class {
	state_;
	constructor(seed) {
		this.state_ = seed >>> 0;
	}
	/** Raw state, so rewind snapshots can restore the exact random sequence. */
	get state() {
		return this.state_;
	}
	set state(v) {
		this.state_ = v >>> 0;
	}
	next() {
		this.state_ = this.state_ + 1831565813 >>> 0;
		let t = this.state_;
		t = Math.imul(t ^ t >>> 15, t | 1);
		t ^= t + Math.imul(t ^ t >>> 7, t | 61);
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	}
	int(maxExclusive) {
		return Math.floor(this.next() * maxExclusive);
	}
	range(min, max) {
		return min + this.next() * (max - min);
	}
	pick(items) {
		return items[this.int(items.length)];
	}
	weighted(items) {
		const total = items.reduce((s, [, w]) => s + w, 0);
		let r = this.next() * total;
		for (const [item, w] of items) {
			r -= w;
			if (r < 0) return item;
		}
		return items[items.length - 1][0];
	}
};
function hashString(s) {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
var dailySeed = (dateKey) => hashString(`sssnake:${dateKey}`);
/** Chunks per side of a biome region cell (the Voronoi grid). */
var REGION = 3;
var LANDMARK_CHANCE = .3;
/** Order matters: a chunk's biome is stored as its index in this list. */
var BIOMES = [
	{
		id: "meadow",
		name: "Meadow",
		blurb: "Open grass and plenty of mice.",
		modifiers: [],
		clusters: [2, 4],
		shape: "blob",
		mines: [0, 1],
		wells: 0,
		arrows: 0,
		mice: 3
	},
	{
		id: "glacier",
		name: "Glacier",
		blurb: "Ice pillars. Turns kick in late.",
		modifiers: ["ice"],
		clusters: [3, 5],
		shape: "pillar",
		mines: [0, 2],
		wells: 0,
		arrows: 0,
		mice: 1
	},
	{
		id: "shadow",
		name: "Shadowlands",
		blurb: "Dark, and mined.",
		modifiers: ["dark"],
		clusters: [2, 4],
		shape: "blob",
		mines: [2, 4],
		wells: 0,
		arrows: 0,
		mice: 1
	},
	{
		id: "orchard",
		name: "Orchard",
		blurb: "Hedgerows. Food ripens, then rots.",
		modifiers: ["ripening"],
		clusters: [3, 5],
		shape: "hedge",
		mines: [0, 1],
		wells: 0,
		arrows: 0,
		mice: 3
	},
	{
		id: "vortex",
		name: "Vortex",
		blurb: "Gravity wells drag food around.",
		modifiers: ["wells"],
		clusters: [2, 3],
		shape: "blob",
		mines: [1, 2],
		wells: 2,
		arrows: 0,
		mice: 2
	},
	{
		id: "circuit",
		name: "Circuit",
		blurb: "Traces and arrow tiles.",
		modifiers: ["arrows"],
		clusters: [3, 5],
		shape: "trace",
		mines: [1, 2],
		wells: 0,
		arrows: 5,
		mice: 2
	},
	{
		id: "badlands",
		name: "Badlands",
		blurb: "Rubble and minefields.",
		modifiers: [],
		clusters: [3, 6],
		shape: "rubble",
		mines: [4, 7],
		wells: 0,
		arrows: 0,
		mice: 1
	}
];
var BIOME_INDEX = new Map(BIOMES.map((b, i) => [b.id, i]));
/** 32-bit integer hash of a few numbers (murmur3 finaliser per step). */
function hash(...ns) {
	let h = 2166136261;
	for (const n of ns) {
		h = Math.imul(h ^ (n | 0), 16777619);
		h ^= h >>> 15;
		h = Math.imul(h, 739982445);
		h ^= h >>> 12;
		h = Math.imul(h, 695872825);
		h ^= h >>> 15;
	}
	return h >>> 0;
}
function spawnChunk(size = 128) {
	const n = Math.floor(size / 16);
	return {
		cx: Math.floor(n / 2),
		cy: Math.floor(n / 2)
	};
}
function worldSpawn(size = 128) {
	const { cx, cy } = spawnChunk(size);
	return {
		x: cx * 16 + 3,
		y: cy * 16 + 8
	};
}
/** Which biome a chunk belongs to: the nearest jittered region centre (Voronoi). */
function chunkBiome(seed, cx, cy, size = 128) {
	const s = spawnChunk(size);
	if (cx === s.cx && cy === s.cy) return "meadow";
	const px = (cx + .5) / REGION;
	const py = (cy + .5) / REGION;
	const rx = Math.floor(px);
	const ry = Math.floor(py);
	let best = Infinity;
	let biome = "meadow";
	for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
		const r = new Rng(hash(seed, rx + dx, ry + dy, 45326));
		const x = rx + dx + .15 + r.next() * .7;
		const y = ry + dy + .15 + r.next() * .7;
		const d = (x - px) ** 2 + (y - py) ** 2;
		if (d < best) {
			best = d;
			biome = BIOMES[r.int(BIOMES.length)].id;
		}
	}
	return biome;
}
/** One chunk's contents, in world coordinates. Pure: depends only on its arguments. */
function generateChunk(seed, cx, cy, size = 128) {
	const rng = new Rng(hash(seed, cx, cy, 50343));
	const biome = BIOMES[BIOME_INDEX.get(chunkBiome(seed, cx, cy, size))];
	const ox = cx * 16;
	const oy = cy * 16;
	const out = {
		cx,
		cy,
		biome: biome.id,
		walls: [],
		mines: [],
		wells: [],
		arrows: [],
		treasure: [],
		landmark: null
	};
	const used = /* @__PURE__ */ new Uint8Array(256);
	const at = (x, y) => (y - oy) * 16 + (x - ox);
	const inChunk = (x, y) => x >= ox && y >= oy && x < ox + 16 && y < oy + 16;
	const open = (x, y) => inChunk(x, y) && !used[at(x, y)];
	const reserve = (x0, y0, x1, y1) => {
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inChunk(x, y)) used[at(x, y)] = 3;
	};
	reserve(0, 0, size - 1, 0);
	reserve(0, size - 1, size - 1, size - 1);
	reserve(0, 0, 0, size - 1);
	reserve(size - 1, 0, size - 1, size - 1);
	const s = spawnChunk(size);
	const isSpawn = cx === s.cx && cy === s.cy;
	const sp = worldSpawn(size);
	reserve(sp.x - 4, sp.y - 2, sp.x + 12, sp.y + 2);
	const take = (x, y) => {
		used[at(x, y)] = 1;
	};
	if (!isSpawn && rng.next() < LANDMARK_CHANCE) {
		const kind = rng.weighted([
			["shrine", .4],
			["gate", .35],
			["crater", .25]
		]);
		const c = {
			x: ox + 5 + rng.int(6),
			y: oy + 5 + rng.int(6)
		};
		if (c.x > 3 && c.y > 3 && c.x < size - 4 && c.y < size - 4) {
			out.landmark = {
				kind,
				pos: c
			};
			if (kind === "shrine") {
				const door = rng.pick(DIR_LIST);
				const gap = {
					x: c.x + DIRS[door].x * 2,
					y: c.y + DIRS[door].y * 2
				};
				for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
					if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
					const p = {
						x: c.x + dx,
						y: c.y + dy
					};
					if (p.x === gap.x && p.y === gap.y) continue;
					out.walls.push(p);
				}
				out.treasure.push({
					kind: "golden",
					pos: { ...c }
				});
			} else if (kind === "gate") for (const [dx, dy] of [
				[-2, -2],
				[2, -2],
				[-2, 2],
				[2, 2]
			]) out.walls.push({
				x: c.x + dx,
				y: c.y + dy
			});
			else {
				for (const [dx, dy] of [
					[-3, 0],
					[3, 0],
					[0, -3],
					[0, 3],
					[-2, -2],
					[2, -2],
					[-2, 2],
					[2, 2]
				]) out.mines.push({
					x: c.x + dx,
					y: c.y + dy
				});
				for (const d of [{
					x: 0,
					y: 0
				}, ...DIR_LIST.map((k) => DIRS[k])]) out.treasure.push({
					kind: "bit",
					pos: {
						x: c.x + d.x,
						y: c.y + d.y
					}
				});
			}
			reserve(c.x - 3, c.y - 3, c.x + 3, c.y + 3);
		}
	}
	const clusters = biome.clusters[0] + rng.int(biome.clusters[1] - biome.clusters[0] + 1);
	for (let k = 0; k < clusters; k++) {
		const start = {
			x: ox + 1 + rng.int(14),
			y: oy + 1 + rng.int(14)
		};
		const cells = shapeCells(biome.shape, start, rng).filter((p) => open(p.x, p.y));
		const unique = cells.filter((p, i) => cells.findIndex((q) => q.x === p.x && q.y === p.y) === i);
		if (unique.length < 2) continue;
		for (const p of unique) {
			take(p.x, p.y);
			out.walls.push(p);
		}
		for (const p of unique) for (const d of DIR_LIST) {
			const n = {
				x: p.x + DIRS[d].x,
				y: p.y + DIRS[d].y
			};
			if (inChunk(n.x, n.y) && !used[at(n.x, n.y)]) used[at(n.x, n.y)] = 2;
		}
	}
	const itemSpot = () => {
		for (let i = 0; i < 40; i++) {
			const p = {
				x: ox + rng.int(16),
				y: oy + rng.int(16)
			};
			const k = at(p.x, p.y);
			if (used[k] === 1 || used[k] === 3) continue;
			used[k] = 3;
			return p;
		}
		return null;
	};
	const mines = biome.mines[0] + rng.int(biome.mines[1] - biome.mines[0] + 1);
	for (let i = 0; i < mines; i++) {
		const p = itemSpot();
		if (p) out.mines.push(p);
	}
	for (let i = 0; i < biome.wells; i++) {
		const p = itemSpot();
		if (p) out.wells.push(p);
	}
	for (let i = 0; i < biome.arrows; i++) {
		const p = itemSpot();
		if (p) out.arrows.push({
			pos: p,
			dir: rng.pick(DIR_LIST)
		});
	}
	return out;
}
function shapeCells(shape, s, rng) {
	const out = [{ ...s }];
	switch (shape) {
		case "blob": {
			let c = s;
			const n = 4 + rng.int(6);
			for (let i = 0; i < n; i++) {
				const d = DIRS[rng.pick(DIR_LIST)];
				c = {
					x: c.x + d.x,
					y: c.y + d.y
				};
				out.push(c);
			}
			break;
		}
		case "pillar": {
			const n = rng.next() < .3 ? 3 : 2;
			for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (x || y) out.push({
				x: s.x + x,
				y: s.y + y
			});
			break;
		}
		case "hedge": {
			const d = DIRS[rng.next() < .5 ? "right" : "down"];
			const n = 4 + rng.int(5);
			for (let i = 1; i < n; i++) out.push({
				x: s.x + d.x * i,
				y: s.y + d.y * i
			});
			break;
		}
		case "trace": {
			let d = rng.pick(DIR_LIST);
			let c = s;
			const a = 3 + rng.int(3);
			const b = 2 + rng.int(3);
			for (let i = 1; i < a + b; i++) {
				if (i === a) d = rng.next() < .5 ? d === "up" || d === "down" ? "left" : "up" : d === "up" || d === "down" ? "right" : "down";
				c = {
					x: c.x + DIRS[d].x,
					y: c.y + DIRS[d].y
				};
				out.push(c);
			}
			break;
		}
		case "rubble": {
			const n = 2 + rng.int(4);
			for (let i = 0; i < n; i++) out.push({
				x: s.x - 1 + rng.int(3),
				y: s.y - 1 + rng.int(3)
			});
			break;
		}
	}
	return out;
}
/** Build the whole world from its chunks, then the world-level pass. Deterministic per seed. */
function generateWorld(seed, size = 128) {
	const cols = Math.floor(size / 16);
	const rows = cols;
	const chunks = [];
	for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) chunks.push(generateChunk(seed, cx, cy, size));
	const n = size * size;
	const at = (p) => p.y * size + p.x;
	const solid = new Uint8Array(n);
	for (let i = 0; i < size; i++) solid[i] = solid[(size - 1) * size + i] = solid[i * size] = solid[i * size + size - 1] = 1;
	for (const c of chunks) for (const w of c.walls) solid[at(w)] = 1;
	const gates = chunks.filter((c) => c.landmark?.kind === "gate").map((c) => c.landmark);
	const rng = new Rng(hash(seed, 39550));
	for (let i = gates.length - 1; i > 0; i--) {
		const j = rng.int(i + 1);
		[gates[i], gates[j]] = [gates[j], gates[i]];
	}
	const portals = [];
	for (let i = 0; i + 1 < gates.length; i += 2) portals.push([{ ...gates[i].pos }, { ...gates[i + 1].pos }]);
	if (gates.length % 2) {
		const last = gates[gates.length - 1];
		last.kind = "ruin";
		solid[at(last.pos)] = 1;
	}
	const spawn = worldSpawn(size);
	const seen = new Uint8Array(n);
	const stack = [at(spawn)];
	seen[at(spawn)] = 1;
	while (stack.length) {
		const i = stack.pop();
		const x = i % size;
		const y = (i - x) / size;
		for (const [nx, ny] of [
			[x + 1, y],
			[x - 1, y],
			[x, y + 1],
			[x, y - 1]
		]) {
			if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
			const k = ny * size + nx;
			if (seen[k] || solid[k]) continue;
			seen[k] = 1;
			stack.push(k);
		}
	}
	for (let i = 0; i < n; i++) if (!seen[i]) solid[i] = 1;
	const reachable = (p) => seen[at(p)] === 1;
	const livePortals = portals.filter(([a, b]) => reachable(a) && reachable(b));
	const walls = [];
	for (let i = 0; i < n; i++) if (solid[i]) walls.push({
		x: i % size,
		y: Math.floor(i / size)
	});
	const mines = chunks.flatMap((c) => c.mines).filter(reachable);
	const wells = chunks.flatMap((c) => c.wells).filter(reachable);
	const arrows = chunks.flatMap((c) => c.arrows).filter((a) => {
		if (!reachable(a.pos)) return false;
		const d = DIRS[a.dir];
		for (let k = 1; k <= 3; k++) {
			const p = {
				x: a.pos.x + d.x * k,
				y: a.pos.y + d.y * k
			};
			if (solid[at(p)] || mines.some((m) => m.x === p.x && m.y === p.y)) return false;
		}
		return true;
	});
	const treasure = chunks.flatMap((c) => c.treasure).filter((t) => reachable(t.pos));
	const landmarks = chunks.flatMap((c) => c.landmark ? [c.landmark] : []);
	const biome = new Uint8Array(cols * rows);
	chunks.forEach((c, i) => biome[i] = BIOME_INDEX.get(c.biome));
	return {
		world: {
			w: size,
			h: size,
			cols,
			rows,
			biome,
			landmarks
		},
		treasure,
		spec: {
			arena: {
				id: "world",
				name: "Endless",
				blurb: "A big world of biomes.",
				wrap: false,
				walls,
				portals: livePortals,
				mazes: [],
				collapse: false
			},
			modifiers: [],
			wells,
			arrows,
			mines,
			randomMines: 0,
			rival: false,
			mice: true,
			powerUps: true,
			boss: null,
			bossTier: 0,
			spawn,
			spawnDir: "right",
			goalFoods: 0
		}
	};
}
function biomeAt(world, p) {
	const cx = Math.min(world.cols - 1, Math.max(0, Math.floor(p.x / 16)));
	const cy = Math.min(world.rows - 1, Math.max(0, Math.floor(p.y / 16)));
	return BIOMES[world.biome[cy * world.cols + cx]];
}
//#endregion
//#region src/game/modes.ts
var base = {
	abilities: true,
	classAbility: true,
	powerUps: true,
	hazards: false,
	levels: false,
	drafts: false,
	bosses: false,
	twists: false,
	rewinds: 0,
	players: 1,
	rhythm: false,
	zen: false,
	arena: "box",
	world: 0,
	hex: false,
	size: 0,
	foods: 1
};
var MODES$1 = {
	classic: {
		...base,
		id: "classic",
		name: "Classic",
		blurb: "Pure Snake. Eat, grow, survive.",
		abilities: false,
		classAbility: false,
		powerUps: false
	},
	arcade: {
		...base,
		id: "arcade",
		name: "Arcade",
		blurb: "Levels, mutations, bosses, twists and a rival.",
		hazards: true,
		levels: true,
		drafts: true,
		bosses: true,
		twists: true,
		rewinds: 1
	},
	daily: {
		...base,
		id: "daily",
		name: "Daily",
		blurb: "Today's seeded run. Race your own ghost.",
		hazards: true,
		levels: true,
		drafts: true,
		bosses: true,
		twists: true,
		rewinds: 1
	},
	zen: {
		...base,
		id: "zen",
		name: "Zen",
		blurb: "No death, no rush. Just slither.",
		zen: true,
		arena: "wrap"
	},
	rhythm: {
		...base,
		id: "rhythm",
		name: "Rhythm",
		blurb: "Move to the beat. Turn on time for up to x4.",
		classAbility: false,
		rhythm: true
	},
	versus: {
		...base,
		id: "versus",
		name: "Versus",
		blurb: "Two snakes on a big looping board, best of three. Space hexes your rival.",
		players: 2,
		hex: true,
		arena: "wrap",
		size: 48,
		foods: 4
	},
	endless: {
		...base,
		id: "endless",
		name: "Endless",
		blurb: "A huge world of biomes and landmarks. Explore until you crash.",
		hazards: true,
		rewinds: 1,
		arena: "world",
		world: 128
	},
	custom: {
		...base,
		id: "custom",
		name: "Custom",
		blurb: "Play levels from the editor or a shared link."
	}
};
//#endregion
//#region src/game/mutations.ts
var defs = [
	{
		id: "forked",
		name: "Forked Tongue",
		desc: "Eat anything next to your head, diagonals included.",
		stacks: false
	},
	{
		id: "longmolt",
		name: "Long Molt",
		desc: "Shed walls last twice as long.",
		stacks: false
	},
	{
		id: "quickmolt",
		name: "Quick Molt",
		desc: "Shed cooldown halved, and you can shed from length 4.",
		stacks: false
	},
	{
		id: "venom",
		name: "Venom Skin",
		desc: "Rivals blunder into your shed walls and die. Bosses take double damage from them.",
		stacks: false
	},
	{
		id: "ouroboros",
		name: "Ouroboros",
		desc: "Biting yourself cuts off the tail instead of killing you.",
		stacks: false
	},
	{
		id: "armour",
		name: "Molt Armour",
		desc: "Survive one lethal hit (you lose half your length).",
		stacks: true
	},
	{
		id: "scales",
		name: "Magnetic Scales",
		desc: "Food within 3 cells always drifts toward you.",
		stacks: false
	},
	{
		id: "midas",
		name: "Midas",
		desc: "Golden pickups appear twice as often and last longer.",
		stacks: false
	},
	{
		id: "glutton",
		name: "Glutton",
		desc: "Food is worth 50% more, but you grow twice as fast.",
		stacks: false
	},
	{
		id: "dense",
		name: "Dense Body",
		desc: "Your length multiplier rises every 5 segments instead of 8.",
		stacks: false
	},
	{
		id: "adrenaline",
		name: "Adrenaline",
		desc: "Your ability meter drains 40% slower.",
		stacks: false
	},
	{
		id: "secondwind",
		name: "Second Wind",
		desc: "Hitting a x3 combo refills your ability meter.",
		stacks: false
	},
	{
		id: "keeper",
		name: "Combo Keeper",
		desc: "Combo window is 3 seconds instead of 2.",
		stacks: false
	},
	{
		id: "rattle",
		name: "Rattle",
		desc: "Two quick turns release a wave that stuns enemies nearby.",
		stacks: false
	},
	{
		id: "constrictor",
		name: "Constrictor",
		desc: "Coil captures score x3 instead of x2.",
		stacks: false
	},
	{
		id: "mineeater",
		name: "Mine Eater",
		desc: "Swallow unlit mines for points.",
		stacks: false
	},
	{
		id: "lucky",
		name: "Lucky",
		desc: "Power-ups appear 40% more often.",
		stacks: false
	},
	{
		id: "blastshed",
		name: "Blast Shed",
		desc: "Shedding blows up mines near the dropped skin.",
		stacks: false
	},
	{
		id: "timethief",
		name: "Time Thief",
		desc: "Phase and Slow-Mo last twice as long.",
		stacks: false
	},
	{
		id: "rewindplus",
		name: "Extra Rewind",
		desc: "Gain one more rewind for this run.",
		stacks: true
	}
];
var MUTATIONS = Object.fromEntries(defs.map((d) => [d.id, d]));
var MUTATION_LIST = defs.map((d) => d.id);
//#endregion
//#region src/game/engine.ts
var SHED_WALL_MS = 15e3;
var SHED_COOLDOWN_MS = 2500;
/** Versus Hex: the shed key flips the opponent's controls instead of shedding. */
var HEX_COOLDOWN_MS = 8e3;
var HEX_SUDDEN_DEATH_COOLDOWN_MS = 5e3;
var HEX_MS = 2500;
/** After a hex wears off the victim can't be hexed again for this long. */
var HEX_IMMUNE_MS = 3e3;
/** No hexes in the opening seconds of a round. */
var HEX_GRACE_MS = 3e3;
var COMBO_WINDOW_MS = 2e3;
var EFFECT_MS = {
	phase: 6e3,
	slowmo: 5e3,
	magnet: 8e3
};
var MINE_PERIOD_MS = 3200;
var MINE_LIT_MS = 1100;
var POWER_TTL_MS = 9e3;
var GOLDEN_TTL_MS = 5e3;
var BIT_TTL_MS = 7e3;
var MOUSE_TTL_MS = 14e3;
var ROT_TTL_MS = 8e3;
var RIPEN_MS = 2e4;
var MAZE_WARN_MS = 1800;
var MAZE_SHIFT_EVERY = 4;
var COLLAPSE_EVERY_MS = 7e3;
var COLLAPSE_WARN_MS = 2e3;
var COLLAPSE_MAX_RING = 7;
var VERSUS_SUDDEN_DEATH_MS = 6e4;
/** Versus sudden death also shrinks the board: one ring every few seconds, down to this side. */
var VERSUS_RING_MS = 5e3;
var VERSUS_MIN_SIDE = 16;
/** Versus sudden death: both snakes speed up by this factor every step, down to the floor. */
var SUDDEN_DEATH_STEP_MS = 1e4;
var SUDDEN_DEATH_SPEEDUP = .85;
var SUDDEN_DEATH_FLOOR = .45;
var RIVAL_RESPAWN_MS = 9e3;
var BANNER_MS = 1600;
var METER_REGEN_PER_MS = 1 / 3e4;
var METER_PER_FOOD = .25;
var SNAPSHOT_EVERY_MS = 400;
var REWIND_BACK_MS = 2500;
/** Endless: food kept on the board, how far it may be from your head, and the spawn radius. */
var ENDLESS_FOOD = 5;
var FOOD_LEASH = 24;
var SPAWN_RADIUS = 11;
/** Fields captured by rewind snapshots. */
var STATE_KEYS = [
	"time",
	"acc",
	"stepCount",
	"nextId",
	"players",
	"level",
	"levelFoods",
	"solid",
	"broken",
	"mazeIndex",
	"mazeWalls",
	"pendingMaze",
	"mazeWarn",
	"mazeFoods",
	"ring",
	"collapseTimer",
	"collapseActive",
	"pickups",
	"shedWalls",
	"mines",
	"mice",
	"rival",
	"rivalRespawn",
	"projectiles",
	"boss",
	"wells",
	"arrows",
	"enclosed",
	"powerTimer",
	"mouseTimer",
	"bpm",
	"beatStreak"
];
function newPlayer(id, cls) {
	return {
		id,
		cls,
		body: [],
		prevBody: [],
		dir: "right",
		queue: [],
		iceBuffer: null,
		grow: 0,
		alive: true,
		deathCause: null,
		acc: 0,
		meter: 1,
		held: false,
		drained: false,
		wasActive: false,
		shedCooldown: 0,
		effects: {},
		score: 0,
		combo: 0,
		lastEatTime: -Infinity,
		maxCombo: 0,
		maxLength: 0,
		sheds: 0,
		foods: 0,
		armour: 0,
		lastTurnTime: -Infinity,
		rattleCooldown: 0,
		hexWarn: 0,
		hexed: 0,
		hexImmune: 0,
		hexes: 0
	};
}
var Game = class Game {
	mode;
	rng;
	seed;
	custom;
	record;
	/** Board size for this game: 24x24 arenas, or the Endless world. */
	w;
	h;
	/** Endless: the generated world (biomes and landmarks); null in arena modes. */
	world = null;
	/** Endless: biome under player 1's head. */
	biome = null;
	status = "playing";
	won = false;
	/** Versus: winning player id, -1 for a draw. */
	winner = null;
	deathCause = null;
	time = 0;
	acc = 0;
	stepCount = 0;
	nextId = 1;
	players = [];
	level = 1;
	levelFoods = 0;
	spec;
	arena;
	startArena = 0;
	modifiers = /* @__PURE__ */ new Set();
	/** Static solid cells: arena walls, maze walls and the collapsed border. */
	solid;
	/** Walls destroyed by Cobra spit (cell indexes). */
	broken = /* @__PURE__ */ new Set();
	mazeIndex = 0;
	mazeWalls = [];
	pendingMaze = null;
	mazeWarn = 0;
	mazeFoods = 0;
	ring = 0;
	collapseTimer = COLLAPSE_EVERY_MS;
	collapseActive = false;
	pickups = [];
	shedWalls = [];
	mines = [];
	mice = [];
	rival = null;
	rivalRespawn = Infinity;
	projectiles = [];
	boss = null;
	wells = [];
	arrows = [];
	enclosed;
	mutations = [];
	draftOptions = null;
	rewinds = 0;
	snapshots = [];
	snapTimer = 0;
	bpm = 110;
	beatStreak = 0;
	maxBeatStreak = 0;
	coils = 0;
	bestCoil = 0;
	bossesDefeated = 0;
	rivalsDowned = 0;
	rewindsUsed = 0;
	/** Ghost trail: flattened [timeMs, x, y, length] per step of player 1. */
	trail = [];
	powerTimer = 6e3;
	mouseTimer = 9e3;
	miceSkip = false;
	wellSkip = false;
	banner = null;
	events = [];
	constructor(opts) {
		this.mode = MODES$1[opts.mode];
		this.w = this.mode.world || this.mode.size || 24;
		this.h = this.mode.world || this.mode.size || 24;
		this.solid = new Uint8Array(this.w * this.h);
		this.enclosed = new Uint8Array(this.w * this.h);
		this.seed = opts.seed ?? Math.floor(Math.random() * 2 ** 32);
		this.rng = new Rng(this.seed);
		this.custom = opts.level ?? null;
		this.record = !!opts.record;
		this.rewinds = this.mode.rewinds;
		if (opts.mode === "daily") this.startArena = this.seed % ARENA_ORDER.length;
		const classes = opts.classes ?? [];
		for (let i = 0; i < this.mode.players; i++) this.players.push(newPlayer(i, this.mode.classAbility ? classes[i] ?? "racer" : "racer"));
		this.loadLevel(1, false);
	}
	get p0() {
		return this.players[0];
	}
	get snake() {
		return this.p0.body;
	}
	set snake(v) {
		this.p0.body = v;
	}
	get prevSnake() {
		return this.p0.prevBody;
	}
	set prevSnake(v) {
		this.p0.prevBody = v;
	}
	get dir() {
		return this.p0.dir;
	}
	set dir(d) {
		this.p0.dir = d;
	}
	get queue() {
		return this.p0.queue;
	}
	get grow() {
		return this.p0.grow;
	}
	get effects() {
		return this.p0.effects;
	}
	get score() {
		return this.p0.score;
	}
	set score(v) {
		this.p0.score = v;
	}
	get combo() {
		return this.p0.combo;
	}
	get surge() {
		return this.p0.meter;
	}
	get shedCooldown() {
		return this.p0.shedCooldown;
	}
	setSurge(held) {
		this.setHeld(0, held);
	}
	get surging() {
		return this.isSurging(this.p0);
	}
	get canShed() {
		return this.canShedP(this.p0);
	}
	has(m) {
		return this.mutations.includes(m);
	}
	inb(p) {
		return p.x >= 0 && p.y >= 0 && p.x < this.w && p.y < this.h;
	}
	/** Wrap a cell back onto the board. On a shrinking wraparound board the closed rings are skipped. */
	wrapAt(p) {
		const r = this.wraps ? this.ring : 0;
		const sw = this.w - 2 * r;
		const sh = this.h - 2 * r;
		return {
			x: r + ((p.x - r) % sw + sw) % sw,
			y: r + ((p.y - r) % sh + sh) % sh
		};
	}
	/** Inside a closed collapse ring. */
	inRing(p) {
		const r = this.ring;
		return r > 0 && (p.x < r || p.y < r || p.x >= this.w - r || p.y >= this.h - r);
	}
	/** How far the collapse may close in. */
	get maxRing() {
		return this.mode.id === "versus" ? Math.max(0, (Math.min(this.w, this.h) - VERSUS_MIN_SIDE) / 2) : COLLAPSE_MAX_RING;
	}
	ix(p) {
		return p.y * this.w + p.x;
	}
	/** Endless: the biome at a cell. */
	biomeAt(p) {
		return this.world ? biomeAt(this.world, p) : null;
	}
	/** Does food at this cell ripen? Per biome in Endless, per level elsewhere. */
	ripensAt(p) {
		return this.world ? biomeAt(this.world, p).modifiers.includes("ripening") : this.modifiers.has("ripening");
	}
	get wraps() {
		return this.arena.wrap;
	}
	get foodsForLevel() {
		return this.spec.goalFoods;
	}
	get comboWindow() {
		return this.has("keeper") ? 3e3 : COMBO_WINDOW_MS;
	}
	comboActive(p = this.p0) {
		return this.time - p.lastEatTime <= this.comboWindow ? p.combo : 0;
	}
	lengthMultP(p) {
		if (!this.mode.abilities) return 1;
		const step = this.has("dense") ? 5 : 8;
		return 1 + Math.floor(Math.max(0, p.body.length - 4) / step) * .5;
	}
	get lengthMult() {
		return this.lengthMultP(this.p0);
	}
	get rhythmMult() {
		return this.mode.rhythm ? 1 + Math.min(this.beatStreak, 12) / 4 : 1;
	}
	get shedMinLength() {
		if (this.mode.hex) return 6;
		return this.has("quickmolt") ? 4 : 6;
	}
	get shedCooldownMax() {
		if (this.mode.hex) return this.suddenDeath ? HEX_SUDDEN_DEATH_COOLDOWN_MS : HEX_COOLDOWN_MS;
		return this.has("quickmolt") ? SHED_COOLDOWN_MS / 2 : SHED_COOLDOWN_MS;
	}
	canShedP(p) {
		if (this.mode.hex) return this.canHexP(p);
		return this.mode.abilities && p.alive && p.shedCooldown <= 0 && p.body.length >= this.shedMinLength;
	}
	/** The opponent a hex from `p` would hit, if it can be hexed right now. */
	hexTarget(p) {
		const o = this.players.find((q) => q !== p && q.alive);
		if (!o || o.hexWarn > 0 || o.hexed > 0 || o.hexImmune > 0) return null;
		return o;
	}
	canHexP(p) {
		return this.mode.hex && p.alive && this.time >= HEX_GRACE_MS && p.shedCooldown <= 0 && p.body.length >= 6 && this.hexTarget(p) !== null;
	}
	abilityLive(p) {
		return this.mode.classAbility && p.alive && this.status === "playing" && !this.banner;
	}
	isSurging(p) {
		return p.cls === "racer" && p.held && !p.drained && p.meter > 0 && this.abilityLive(p);
	}
	isHunkering(p) {
		return p.cls === "python" && p.held && !p.drained && p.meter > 0 && this.abilityLive(p);
	}
	get baseInterval() {
		let b;
		const id = this.mode.id;
		if (this.mode.rhythm) b = 6e4 / this.bpm / 2;
		else if (id === "classic") b = Math.max(60, 135 - this.p0.foods * 2.5);
		else if (this.mode.zen) b = 125;
		else if (id === "versus") b = 120 * this.suddenDeathPace;
		else if (id === "custom") b = Math.max(70, 125 - this.levelFoods);
		else if (this.world) b = Math.max(70, 125 - this.p0.foods * 1.2);
		else if (this.spec.boss) b = Math.max(85, 120 - this.spec.bossTier * 5);
		else b = Math.max(55, 130 - (this.level - 1) * 7 - this.levelFoods * 1.5);
		if (this.players.some((p) => p.alive && p.effects.slowmo)) b *= 1.8;
		return b;
	}
	/** Versus: past 90 s the round is in sudden death. */
	get suddenDeath() {
		return this.mode.id === "versus" && this.time >= VERSUS_SUDDEN_DEATH_MS;
	}
	/** Versus sudden death: step-interval factor, shrinking every 10 s down to the floor. */
	get suddenDeathPace() {
		if (!this.suddenDeath) return 1;
		const steps = Math.floor((this.time - VERSUS_SUDDEN_DEATH_MS) / SUDDEN_DEATH_STEP_MS) + 1;
		return Math.max(SUDDEN_DEATH_FLOOR, Math.pow(SUDDEN_DEATH_SPEEDUP, steps));
	}
	playerInterval(p) {
		return this.baseInterval * (this.isSurging(p) ? .55 : 1);
	}
	get interval() {
		return this.playerInterval(this.p0);
	}
	alphaFor(p) {
		return Math.min(1, Math.max(0, p.acc / this.playerInterval(p)));
	}
	get alpha() {
		return this.alphaFor(this.p0);
	}
	get worldAlpha() {
		return Math.min(1, Math.max(0, this.acc / this.baseInterval));
	}
	get stats() {
		const p = this.p0;
		return {
			score: p.score,
			foods: p.foods,
			maxLength: p.maxLength,
			maxCombo: p.maxCombo,
			sheds: p.sheds,
			level: this.level,
			timeMs: this.time,
			rivalsDowned: this.rivalsDowned,
			coils: this.coils,
			bestCoil: this.bestCoil,
			bossesDefeated: this.bossesDefeated,
			rewindsUsed: this.rewindsUsed,
			maxBeatStreak: this.maxBeatStreak,
			mutations: this.mutations.length,
			won: this.won
		};
	}
	mineLit(m, t = this.time) {
		return (t + m.offset) % MINE_PERIOD_MS < MINE_LIT_MS;
	}
	/** 0..1 how close an unlit mine is to lighting up (for the warning pulse). */
	mineWarn(m, t = this.time) {
		const until = MINE_PERIOD_MS - (t + m.offset) % MINE_PERIOD_MS;
		return until <= 600 ? 1 - until / 600 : 0;
	}
	portalExit(p) {
		for (const [a, b] of this.arena.portals) {
			if (eq(a, p)) return b;
			if (eq(b, p)) return a;
		}
		return null;
	}
	bossCells() {
		const b = this.boss;
		if (!b) return [];
		if (b.kind === "serpent") return b.body;
		const c = b.core;
		return [
			c,
			{
				x: c.x + 1,
				y: c.y
			},
			{
				x: c.x,
				y: c.y + 1
			},
			{
				x: c.x + 1,
				y: c.y + 1
			}
		];
	}
	bossAt(p) {
		return this.bossCells().some((c) => eq(c, p));
	}
	/** True during the warning window before the next ring closes. */
	get collapseWarning() {
		return this.collapseActive && this.ring < this.maxRing && this.collapseTimer <= COLLAPSE_WARN_MS;
	}
	turn(dir, pid = 0) {
		if (this.status !== "playing") return;
		const p = this.players[pid];
		if (!p?.alive) return;
		if (this.modifiers.has("mirror") !== p.hexed > 0) dir = OPPOSITE[dir];
		const last = p.queue.length ? p.queue[p.queue.length - 1] : p.iceBuffer ?? p.dir;
		if (dir === last || dir === OPPOSITE[last] || p.queue.length >= 3) return;
		p.queue.push(dir);
		if (this.mode.rhythm && !this.banner) {
			const iv = this.baseInterval;
			if (Math.min(this.acc, iv - this.acc) <= 55) {
				this.beatStreak++;
				this.maxBeatStreak = Math.max(this.maxBeatStreak, this.beatStreak);
				this.events.push({
					type: "onbeat",
					streak: this.beatStreak
				});
			} else {
				if (this.beatStreak > 0) this.events.push({ type: "offbeat" });
				this.beatStreak = 0;
			}
		}
		if (this.has("rattle") && pid === 0) {
			if (this.time - p.lastTurnTime < 350 && p.rattleCooldown <= 0) {
				this.rattle(p);
				p.rattleCooldown = 4e3;
			}
			p.lastTurnTime = this.time;
		}
	}
	/** Ability key pressed or released. Tap abilities fire on press. */
	setHeld(pid, held) {
		const p = this.players[pid];
		if (!p) return;
		const wasHeld = p.held;
		p.held = held;
		if (!held) p.drained = false;
		if (held && !wasHeld && !CLASSES$1[p.cls].hold) this.useAbility(p);
	}
	useAbility(p) {
		if (!this.abilityLive(p)) return;
		const def = CLASSES$1[p.cls];
		if (p.meter < def.cost) return;
		p.meter -= def.cost;
		this.events.push({
			type: "ability",
			cls: p.cls,
			player: p.id
		});
		if (p.cls === "viper") {
			const from = p.body[0];
			const cells = [];
			for (let i = 0; i < 3 && p.alive && this.status === "playing" && !this.banner; i++) {
				p.prevBody = p.body.map((s) => ({ ...s }));
				if (!this.advance(p, true)) break;
				cells.push({ ...p.body[0] });
			}
			if (cells.length) this.events.push({
				type: "dash",
				cells: [from, ...cells]
			});
			if (this.world && p.id === 0) this.syncBiome();
		} else if (p.cls === "cobra") {
			const h = p.body[0];
			this.projectiles.push({
				pos: { ...h },
				prev: { ...h },
				dir: p.dir,
				owner: p.id,
				life: 8
			});
		}
	}
	shed(pid = 0) {
		if (this.mode.hex) return this.hex(pid);
		const p = this.players[pid];
		if (!p || this.status !== "playing" || this.banner || !this.canShedP(p)) return false;
		const keep = Math.max(3, Math.ceil(p.body.length / 2));
		const removed = p.body.splice(keep);
		p.prevBody = p.prevBody.slice(0, keep);
		const ttl = this.has("longmolt") ? SHED_WALL_MS * 2 : SHED_WALL_MS;
		for (const pos of removed) if (!this.shedWalls.some((w) => eq(w.pos, pos))) this.shedWalls.push({
			pos: { ...pos },
			ttl,
			maxTtl: ttl,
			owner: p.id
		});
		p.sheds++;
		p.shedCooldown = this.shedCooldownMax;
		this.events.push({
			type: "shed",
			cells: removed,
			player: p.id
		});
		if (this.has("blastshed")) {
			const blown = this.mines.filter((m) => removed.some((c) => chebyshev(c, m.pos) <= 2));
			for (const m of blown) {
				p.score += Math.round(15 * this.lengthMultP(p));
				this.events.push({
					type: "defuse",
					pos: m.pos
				});
			}
			this.mines = this.mines.filter((m) => !blown.includes(m));
		}
		this.checkCoil(p);
		return true;
	}
	/** Versus: pay tail segments to flip the opponent's controls for a while. */
	hex(pid = 0) {
		const p = this.players[pid];
		if (!p || this.status !== "playing" || this.banner || !this.canHexP(p)) return false;
		const target = this.hexTarget(p);
		const cells = p.body.splice(p.body.length - 2, 2);
		p.prevBody = p.prevBody.slice(0, p.body.length);
		p.shedCooldown = this.shedCooldownMax;
		p.hexes++;
		target.hexWarn = 400;
		this.events.push({
			type: "hex",
			cells,
			player: p.id,
			target: target.id
		});
		return true;
	}
	tickHex(p, dt) {
		if (p.hexWarn > 0) {
			p.hexWarn = Math.max(0, p.hexWarn - dt);
			if (p.hexWarn === 0) {
				p.hexed = HEX_MS;
				this.events.push({
					type: "hexed",
					player: p.id,
					on: true
				});
			}
		} else if (p.hexed > 0) {
			p.hexed = Math.max(0, p.hexed - dt);
			if (p.hexed === 0) {
				p.hexImmune = HEX_IMMUNE_MS;
				this.events.push({
					type: "hexed",
					player: p.id,
					on: false
				});
			}
		} else p.hexImmune = Math.max(0, p.hexImmune - dt);
	}
	chooseMutation(i) {
		if (this.status !== "draft" || !this.draftOptions) return;
		const id = this.draftOptions[i];
		if (!id) return;
		this.mutations.push(id);
		if (id === "armour") this.p0.armour++;
		if (id === "rewindplus") this.rewinds++;
		this.draftOptions = null;
		this.status = "playing";
		this.loadLevel(this.level + 1, true);
	}
	drainEvents() {
		const out = this.events;
		this.events = [];
		return out;
	}
	update(dtMs) {
		if (this.status !== "playing") return;
		const dt = Math.min(dtMs, 100);
		if (this.banner) {
			this.banner.ttl -= dt;
			if (this.banner.ttl <= 0) this.banner = null;
			return;
		}
		this.time += dt;
		this.tickTimers(dt);
		if (this.status !== "playing") return;
		this.acc += dt;
		for (const p of this.players) if (p.alive) p.acc += dt;
		for (let guard = 0; guard < 30 && this.status === "playing" && !this.banner; guard++) {
			let moved = false;
			for (const p of [...this.players]) {
				if (!p.alive || this.status !== "playing" || this.banner) continue;
				const iv = this.playerInterval(p);
				if (p.acc >= iv) {
					p.acc -= iv;
					this.stepPlayer(p);
					moved = true;
				}
			}
			if (this.status !== "playing" || this.banner) break;
			const base = this.baseInterval;
			if (this.acc >= base) {
				this.acc -= base;
				this.stepWorld();
				moved = true;
			}
			if (!moved) break;
		}
		if (this.banner) {
			this.acc = 0;
			for (const p of this.players) p.acc = 0;
		}
	}
	tickTimers(dt) {
		for (const p of this.players) {
			if (!p.alive) continue;
			for (const k of Object.keys(p.effects)) {
				const left = (p.effects[k] ?? 0) - dt;
				if (left <= 0) {
					delete p.effects[k];
					this.events.push({
						type: "expire",
						kind: k
					});
				} else p.effects[k] = left;
			}
			p.shedCooldown = Math.max(0, p.shedCooldown - dt);
			p.rattleCooldown = Math.max(0, p.rattleCooldown - dt);
			this.tickHex(p, dt);
			const def = CLASSES$1[p.cls];
			const active = this.isSurging(p) || this.isHunkering(p);
			if (active) {
				p.meter = Math.max(0, p.meter - dt * def.cost * (this.has("adrenaline") ? .6 : 1));
				if (p.meter === 0) p.drained = true;
			} else p.meter = Math.min(1, p.meter + dt * METER_REGEN_PER_MS);
			if (active && !p.wasActive) this.events.push({
				type: "ability",
				cls: p.cls,
				player: p.id
			});
			p.wasActive = active;
		}
		for (const w of this.shedWalls) w.ttl -= dt;
		this.shedWalls = this.shedWalls.filter((w) => w.ttl > 0);
		const ripening = this.modifiers.has("ripening");
		let rotted = false;
		for (const pk of this.pickups) {
			pk.ttl -= dt;
			pk.age += dt;
			if ((this.world ? this.ripensAt(pk.pos) : ripening) && pk.kind === "food" && pk.age > RIPEN_MS) {
				pk.kind = "rot";
				pk.ttl = ROT_TTL_MS;
				pk.maxTtl = ROT_TTL_MS;
				rotted = true;
			}
		}
		this.pickups = this.pickups.filter((p) => p.ttl > 0);
		if (rotted) this.spawnPickup("food", Infinity);
		for (const m of this.mice) {
			m.ttl -= dt;
			m.stunned = Math.max(0, m.stunned - dt);
		}
		this.mice = this.mice.filter((m) => m.ttl > 0);
		if (this.rival) this.rival.stunned = Math.max(0, this.rival.stunned - dt);
		if (this.spec.powerUps && this.mode.powerUps) {
			this.powerTimer -= dt;
			if (this.powerTimer <= 0) {
				this.powerTimer = this.rng.range(8e3, 13e3) * (this.has("lucky") ? .6 : 1);
				if (!this.pickups.some((p) => ![
					"food",
					"bit",
					"rot"
				].includes(p.kind) && Number.isFinite(p.maxTtl))) {
					const weights = [
						["phase", 2],
						["slowmo", this.mode.rhythm ? 0 : 2],
						["magnet", 2],
						["shrink", 1.5],
						["golden", this.has("midas") ? 3 : 1.5]
					];
					const kind = this.rng.weighted(weights);
					const ttl = kind === "golden" ? GOLDEN_TTL_MS * (this.has("midas") ? 1.6 : 1) : POWER_TTL_MS;
					this.spawnPickup(kind, ttl);
				}
			}
		}
		if (this.spec.mice) {
			this.mouseTimer -= dt;
			if (this.mouseTimer <= 0) {
				if (this.world) {
					this.mouseTimer = this.rng.range(5e3, 9e3);
					if (this.mice.length < (this.biomeAt(this.p0.body[0])?.mice ?? 1)) this.spawnMouse(false);
				} else {
					this.mouseTimer = this.rng.range(12e3, 18e3);
					if (this.mice.length < 1 + Math.floor(this.level / 3)) this.spawnMouse(false);
				}
			}
		}
		if (this.spec.rival && !this.rival) {
			this.rivalRespawn -= dt;
			if (this.rivalRespawn <= 0) this.spawnRival();
		}
		if (this.boss) this.tickBoss(dt);
		if (this.pendingMaze) {
			this.mazeWarn -= dt;
			if (this.mazeWarn <= 0) this.applyMaze();
		}
		if (this.suddenDeath && !this.collapseActive) {
			this.banner = {
				title: "Sudden death",
				subtitle: "Faster, and the arena shrinks",
				ttl: BANNER_MS
			};
			this.collapseActive = true;
			this.collapseTimer = 2500;
		}
		if (this.collapseActive && this.ring < this.maxRing) {
			this.collapseTimer -= dt;
			if (this.collapseTimer <= 0) {
				this.collapseTimer = this.mode.id === "versus" ? VERSUS_RING_MS : COLLAPSE_EVERY_MS;
				this.ring++;
				this.rebuildSolid();
				this.evictFromSolid();
				this.events.push({
					type: "collapse",
					ring: this.ring
				});
			}
		}
		if (this.rewinds > 0) {
			this.snapTimer -= dt;
			if (this.snapTimer <= 0) {
				this.snapTimer = SNAPSHOT_EVERY_MS;
				this.snapshots.push(this.capture());
				if (this.snapshots.length > 12) this.snapshots.shift();
			}
		}
	}
	/** Independent deep copy (used for instant replays). */
	clone() {
		const copy = Object.create(Game.prototype);
		const src = this;
		const dst = copy;
		for (const k of Object.keys(this)) {
			if (k === "rng" || k === "events") continue;
			dst[k] = structuredClone(src[k]);
		}
		dst.rng = new Rng(0);
		copy.rng.state = this.rng.state;
		dst.events = [];
		return copy;
	}
	/** One full tick for every player and the world (used by tests and tools). */
	step() {
		for (const p of [...this.players]) if (p.alive && this.status === "playing" && !this.banner) this.stepPlayer(p);
		if (this.status === "playing" && !this.banner) this.stepWorld();
	}
	stepPlayer(p) {
		p.prevBody = p.body.map((s) => ({ ...s }));
		if (this.isHunkering(p)) return;
		const next = p.queue.shift();
		if (this.modifiers.has("ice")) {
			const apply = p.iceBuffer;
			p.iceBuffer = next ?? null;
			if (apply && apply !== OPPOSITE[p.dir]) p.dir = apply;
		} else if (next) p.dir = next;
		this.advance(p, false);
		if (this.world && p.id === 0) this.syncBiome();
		if (this.record && p.id === 0 && p.alive) {
			const h = p.body[0];
			this.trail.push(Math.round(this.time), h.x, h.y, p.body.length);
		}
	}
	/** Move a player one cell. Returns false if it died, was stopped, or the level changed. */
	advance(p, dashing) {
		let head = add(p.body[0], DIRS[p.dir]);
		if (!this.inb(head) || this.wraps && this.inRing(head)) {
			if (this.wraps) head = this.wrapAt(head);
			else return this.hurt(p, "wall", p.body[0]);
		}
		const exit = this.portalExit(head);
		if (exit) {
			this.events.push({
				type: "portal",
				from: head,
				to: exit
			});
			head = { ...exit };
		}
		if (this.solid[this.ix(head)]) return this.hurt(p, "wall", head);
		if (this.bossAt(head)) return this.hurt(p, "boss", head);
		const si = this.shedWalls.findIndex((w) => eq(w.pos, head));
		if (si >= 0) {
			if (this.mode.zen) this.shedWalls.splice(si, 1);
			else return this.hurt(p, "shed", head);
		}
		const mi = this.mines.findIndex((m) => eq(m.pos, head));
		if (mi >= 0) {
			if (this.mineLit(this.mines[mi])) return this.hurt(p, "mine", head);
			if (this.has("mineeater")) {
				this.mines.splice(mi, 1);
				const points = Math.round(20 * this.lengthMultP(p));
				p.score += points;
				this.events.push({
					type: "defuse",
					pos: head
				});
			}
		}
		if (this.rival?.body.some((s) => eq(s, head))) {
			if (eq(this.rival.body[0], head) && p.body.length >= this.rival.body.length) this.killRival(true);
			else return this.hurt(p, "rival", head);
		}
		for (const o of this.players) {
			if (o === p || !o.alive) continue;
			const oi = o.body.findIndex((s) => eq(s, head));
			if (oi < 0) continue;
			if (oi === 0) {
				if (p.body.length > o.body.length) this.kill(o, "player", head);
				else if (p.body.length < o.body.length) return this.hurt(p, "player", head);
				else {
					this.kill(o, "player", head);
					return this.hurt(p, "player", head);
				}
			} else return this.hurt(p, "player", head);
		}
		const checkLen = p.grow > 0 ? p.body.length : p.body.length - 1;
		for (let i = 1; i < checkLen; i++) {
			if (!eq(p.body[i], head)) continue;
			if (p.effects.phase || dashing) break;
			if (this.mode.zen || this.has("ouroboros") && p.id === 0) {
				const cut = p.body.splice(i);
				p.prevBody = p.prevBody.slice(0, i);
				p.grow = 0;
				p.combo = 0;
				this.events.push({
					type: "cut",
					cells: cut
				});
				break;
			}
			return this.hurt(p, "self", head);
		}
		p.body.unshift(head);
		if (p.grow > 0) p.grow--;
		else p.body.pop();
		p.maxLength = Math.max(p.maxLength, p.body.length);
		const arrow = this.arrows.find((a) => eq(a.pos, head));
		if (arrow && arrow.dir !== OPPOSITE[p.dir]) {
			p.dir = arrow.dir;
			p.queue = [];
			p.iceBuffer = null;
		}
		const level = this.level;
		this.eatAt(p, head, 1);
		if (this.has("forked") && p.id === 0) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			if (!dx && !dy) continue;
			let c = {
				x: head.x + dx,
				y: head.y + dy
			};
			if (!this.inb(c)) {
				if (!this.wraps) continue;
				c = this.wrapAt(c);
			}
			this.eatAt(p, c, 1);
			if (this.level !== level || this.status !== "playing") return false;
		}
		if (this.level !== level || this.status !== "playing" || this.banner) return false;
		this.checkCoil(p);
		return this.status === "playing" && !this.banner && this.level === level;
	}
	/** A lethal hit: armour, then rewind, then death. Always returns false. */
	hurt(p, cause, pos) {
		if (p.armour > 0) {
			p.armour--;
			const keep = Math.max(3, Math.ceil(p.body.length / 2));
			p.body.splice(keep);
			p.prevBody = p.body.map((s) => ({ ...s }));
			p.effects.phase = Math.max(p.effects.phase ?? 0, 1500);
			p.queue = [];
			p.iceBuffer = null;
			p.dir = this.safeDir(p) ?? p.dir;
			this.events.push({
				type: "armour",
				pos
			});
			return false;
		}
		if (this.rewinds > 0 && this.players.length === 1 && this.snapshots.length) {
			this.doRewind();
			return false;
		}
		this.kill(p, cause, pos);
		return false;
	}
	kill(p, cause, pos) {
		if (!p.alive) return;
		p.alive = false;
		p.deathCause = cause;
		p.held = false;
		this.events.push({
			type: "die",
			pos,
			cause,
			cells: p.body.map((s) => ({ ...s })),
			player: p.id
		});
		const alive = this.players.filter((o) => o.alive);
		if (this.players.length === 1) {
			this.status = "over";
			this.deathCause = cause;
		} else if (alive.length <= 1) {
			this.status = "over";
			this.deathCause = cause;
			this.winner = alive.length ? alive[0].id : -1;
			this.won = this.winner >= 0;
		}
	}
	deadlyFor(p, c) {
		if (!this.inb(c)) return !this.wraps;
		if (this.solid[this.ix(c)] || this.bossAt(c)) return true;
		if (this.shedWalls.some((w) => eq(w.pos, c))) return true;
		if (this.mines.some((m) => eq(m.pos, c) && this.mineLit(m))) return true;
		if (this.rival?.body.some((s) => eq(s, c))) return true;
		for (const o of this.players) {
			if (!o.alive) continue;
			const len = o === p ? o.body.length - 1 : o.body.length;
			for (let i = o === p ? 1 : 0; i < len; i++) if (eq(o.body[i], c)) return true;
		}
		return false;
	}
	safeDir(p) {
		const order = [p.dir, ...DIR_LIST.filter((d) => d !== p.dir && d !== OPPOSITE[p.dir])];
		for (const d of order) {
			let c = add(p.body[0], DIRS[d]);
			if (!this.inb(c) && this.wraps) c = this.wrapAt(c);
			if (!this.deadlyFor(p, c)) return d;
		}
		return null;
	}
	capture() {
		const self = this;
		const state = {};
		for (const k of STATE_KEYS) state[k] = structuredClone(self[k]);
		return {
			time: this.time,
			state,
			rng: this.rng.state
		};
	}
	doRewind() {
		const target = this.time - REWIND_BACK_MS;
		let snap = this.snapshots[0];
		for (const s of this.snapshots) if (s.time <= target) snap = s;
		const self = this;
		for (const k of STATE_KEYS) self[k] = structuredClone(snap.state[k]);
		this.rng.state = snap.rng;
		this.snapshots = this.snapshots.filter((s) => s.time < snap.time);
		this.rewinds--;
		this.rewindsUsed++;
		const p = this.p0;
		p.effects.phase = Math.max(p.effects.phase ?? 0, 1500);
		p.queue = [];
		p.held = false;
		if (this.record) {
			let n = this.trail.length;
			while (n >= 4 && this.trail[n - 4] > this.time) n -= 4;
			this.trail.length = n;
		}
		this.syncBiome();
		this.banner = {
			title: "Rewind",
			subtitle: `${this.rewinds} left`,
			ttl: 900
		};
		this.events.push({ type: "rewind" });
	}
	eatAt(p, cell, coilMult) {
		const pi = this.pickups.findIndex((pk) => eq(pk.pos, cell));
		if (pi >= 0) {
			const [pk] = this.pickups.splice(pi, 1);
			this.consume(p, pk, coilMult);
		}
		if (this.status !== "playing") return;
		const mi = this.mice.findIndex((m) => eq(m.pos, cell));
		if (mi >= 0) {
			const [m] = this.mice.splice(mi, 1);
			this.eatMouse(p, m, coilMult);
		}
	}
	eatMouse(p, m, mult) {
		const points = Math.round((m.drone ? 15 : 25) * this.lengthMultP(p) * mult);
		p.score += points;
		p.grow += m.drone ? 1 : 2;
		this.events.push({
			type: "mouse",
			pos: m.pos,
			points,
			drone: m.drone
		});
		const b = this.boss;
		if (m.drone && b?.kind === "queen" && b.shield) {
			b.dronesEaten++;
			if (b.dronesEaten >= 4) {
				b.shield = false;
				b.shieldTimer = 4500;
				this.events.push({
					type: "shield",
					up: false
				});
			}
		}
		return points;
	}
	consume(p, pk, coilMult) {
		const kind = pk.kind;
		if (kind === "food" || kind === "bit" || kind === "golden") {
			if (this.mode.abilities) {
				p.combo = this.time - p.lastEatTime <= this.comboWindow ? Math.min(4, p.combo + 1) : 1;
				p.maxCombo = Math.max(p.maxCombo, p.combo);
				if (p.combo > 1) this.events.push({
					type: "combo",
					pos: pk.pos,
					combo: p.combo
				});
				if (p.combo >= 3 && this.has("secondwind")) p.meter = 1;
			}
			p.lastEatTime = this.time;
			let base = kind === "golden" ? 50 : kind === "bit" ? 5 : 10;
			if (kind === "food" && this.has("glutton")) base *= 1.5;
			if (kind === "food" && this.ripensAt(pk.pos)) base *= 1 + Math.min(pk.age / 8e3, 2);
			const mult = (this.mode.abilities ? p.combo : 1) * this.lengthMultP(p) * (this.isSurging(p) ? 2 : 1) * this.rhythmMult * coilMult;
			const points = Math.round(base * mult);
			p.score += points;
			p.grow += kind === "golden" ? 3 : kind === "food" && this.has("glutton") ? 2 : 1;
			this.events.push({
				type: "eat",
				pos: pk.pos,
				points,
				mult,
				kind,
				player: p.id
			});
			if (kind === "bit") return points;
			p.meter = Math.min(1, p.meter + METER_PER_FOOD);
			p.foods++;
			if (kind === "food") this.spawnPickup("food", Infinity);
			this.afterFood();
			return points;
		}
		if (kind === "rot") {
			const remove = Math.min(2, Math.max(0, p.body.length - 3));
			p.body.splice(p.body.length - remove, remove);
			p.prevBody = p.prevBody.slice(0, p.body.length);
			p.score = Math.max(0, p.score - 10);
			p.combo = 0;
			this.events.push({
				type: "rot",
				pos: pk.pos,
				player: p.id
			});
			return 0;
		}
		this.events.push({
			type: "power",
			pos: pk.pos,
			kind,
			player: p.id
		});
		if (kind === "shrink") {
			const remove = Math.min(3, Math.max(0, p.body.length - 3));
			const cells = p.body.splice(p.body.length - remove, remove);
			p.prevBody = p.prevBody.slice(0, p.body.length);
			p.grow = 0;
			this.events.push({
				type: "shrink",
				cells
			});
			return 0;
		}
		const thief = this.has("timethief") && (kind === "phase" || kind === "slowmo");
		p.effects[kind] = EFFECT_MS[kind] * (thief ? 2 : 1);
		return 0;
	}
	afterFood() {
		if (this.arena.mazes.length) {
			this.mazeFoods++;
			if (this.mazeFoods >= MAZE_SHIFT_EVERY && !this.pendingMaze) {
				this.mazeFoods = 0;
				this.mazeIndex = (this.mazeIndex + 1) % this.arena.mazes.length;
				this.pendingMaze = this.arena.mazes[this.mazeIndex];
				this.mazeWarn = MAZE_WARN_MS;
			}
		}
		if (this.mode.rhythm) {
			if (this.players.reduce((s, p) => s + p.foods, 0) % 5 === 0) this.bpm = Math.min(180, this.bpm + 6);
		}
		this.levelFoods++;
		if (this.spec.goalFoods > 0 && this.levelFoods >= this.spec.goalFoods) this.completeLevel();
	}
	completeLevel() {
		if (this.custom) {
			this.won = true;
			this.status = "over";
			this.events.push({
				type: "levelup",
				level: this.level + 1,
				bonus: 0
			});
			return;
		}
		if (!this.mode.levels) return;
		const p = this.p0;
		const bonus = p.body.length * 10 * this.level;
		p.score += bonus;
		this.events.push({
			type: "levelup",
			level: this.level + 1,
			bonus
		});
		if (this.mode.drafts) {
			this.draftOptions = this.rollDraft();
			this.status = "draft";
			this.events.push({ type: "draft" });
		} else this.loadLevel(this.level + 1, true);
	}
	rollDraft() {
		const pool = MUTATION_LIST.filter((id) => MUTATIONS[id].stacks || !this.has(id));
		const out = [];
		while (out.length < 3 && pool.length) {
			const i = this.rng.int(pool.length);
			out.push(pool.splice(i, 1)[0]);
		}
		return out;
	}
	checkCoil(p) {
		if (!this.mode.abilities || !p.alive) return;
		const barrier = new Uint8Array(this.w * this.h);
		for (const s of p.body) barrier[this.ix(s)] = 1;
		for (const w of this.shedWalls) if (w.owner === p.id) barrier[this.ix(w.pos)] = 1;
		const enc = findEnclosed(barrier, this.w, this.h);
		this.enclosed = enc;
		const inside = (c) => enc[this.ix(c)] === 1;
		const mult = (this.has("constrictor") ? 3 : 2) + (p.cls === "python" ? 1 : 0);
		let captured = 0;
		let points = 0;
		const level = this.level;
		for (const pk of this.pickups.filter((q) => inside(q.pos))) {
			if (!this.pickups.includes(pk)) continue;
			this.pickups.splice(this.pickups.indexOf(pk), 1);
			points += this.consume(p, pk, mult);
			captured++;
			if (this.level !== level || this.status !== "playing") break;
		}
		if (this.level !== level || this.status !== "playing") return this.coilEvent(p, enc, captured, points);
		for (const m of this.mice.filter((q) => inside(q.pos))) {
			this.mice.splice(this.mice.indexOf(m), 1);
			points += this.eatMouse(p, m, mult);
			captured++;
		}
		const defused = this.mines.filter((m) => inside(m.pos));
		for (const m of defused) {
			const pts = Math.round(15 * this.lengthMultP(p) * mult);
			p.score += pts;
			points += pts;
			captured++;
			this.events.push({
				type: "defuse",
				pos: m.pos
			});
		}
		this.mines = this.mines.filter((m) => !defused.includes(m));
		if (this.rival && inside(this.rival.body[0])) {
			points += this.killRival(true);
			captured++;
		}
		const b = this.boss;
		if (b && this.bossCells().some((c) => b.kind === "serpent" ? eq(c, b.body[0]) && inside(c) : inside(c))) {
			if (b.invuln <= 0 && (b.kind === "serpent" || !b.shield)) {
				captured++;
				this.coilEvent(p, enc, captured, points);
				this.damageBoss(1);
				return;
			}
		}
		this.coilEvent(p, enc, captured, points);
	}
	coilEvent(p, enc, captured, points) {
		if (!captured) return;
		this.coils++;
		this.bestCoil = Math.max(this.bestCoil, captured);
		const cells = [];
		for (let i = 0; i < enc.length; i++) if (enc[i]) cells.push({
			x: i % this.w,
			y: Math.floor(i / this.w)
		});
		this.events.push({
			type: "coil",
			cells,
			captured,
			points,
			player: p.id
		});
	}
	stepWorld() {
		this.stepCount++;
		if (this.mode.rhythm) this.events.push({
			type: "beat",
			strong: this.stepCount % 2 === 0
		});
		this.stepProjectiles();
		if (this.status !== "playing" || this.banner) return;
		for (const m of this.mice) m.prev = { ...m.pos };
		if (this.rival) {
			this.rival.prevBody = this.rival.body.map((s) => ({ ...s }));
			if (this.rival.stunned <= 0) this.stepRival();
		}
		if (this.status !== "playing") return;
		this.stepMice();
		if (this.boss) this.stepBoss();
		if (this.status !== "playing" || this.banner) return;
		for (const p of this.players) {
			if (!p.alive) continue;
			if (p.effects.magnet) this.pull(p.body[0], 6, 1);
			else if (this.has("scales") && p.id === 0) this.pull(p.body[0], 3, 1);
		}
		if (this.world) this.tendFood();
		if (this.wells.length) {
			this.wellSkip = !this.wellSkip;
			if (!this.wellSkip) for (const w of this.wells) this.pull(w, 6, 0, true);
		}
	}
	/** Drag pickups one cell toward `to` if within `radius`. */
	pull(to, radius, minDist, all = false) {
		for (const pk of this.pickups) {
			if (!all && pk.kind !== "food" && pk.kind !== "bit" && pk.kind !== "golden") continue;
			const dist = manhattan(pk.pos, to);
			if (dist > radius || dist <= minDist) continue;
			const dx = Math.sign(to.x - pk.pos.x);
			const dy = Math.sign(to.y - pk.pos.y);
			const tries = Math.abs(to.x - pk.pos.x) >= Math.abs(to.y - pk.pos.y) ? [{
				x: pk.pos.x + dx,
				y: pk.pos.y
			}, {
				x: pk.pos.x,
				y: pk.pos.y + dy
			}] : [{
				x: pk.pos.x,
				y: pk.pos.y + dy
			}, {
				x: pk.pos.x + dx,
				y: pk.pos.y
			}];
			for (const t of tries) {
				if (eq(t, pk.pos)) continue;
				if (!(this.blockedForCritter(t) || this.pickups.some((q) => eq(q.pos, t)) || (this.rival?.body.some((s) => eq(s, t)) ?? false))) {
					pk.pos = t;
					break;
				}
			}
		}
	}
	stepProjectiles() {
		const keep = [];
		for (const pr of this.projectiles) {
			pr.prev = { ...pr.pos };
			let alive = true;
			for (let s = 0; s < 2 && alive; s++) {
				let n = add(pr.pos, DIRS[pr.dir]);
				if (!this.inb(n)) {
					if (!this.wraps) {
						alive = false;
						break;
					}
					n = this.wrapAt(n);
				}
				pr.pos = n;
				alive = !this.projectileHit(pr);
			}
			pr.life--;
			if (alive && pr.life > 0) keep.push(pr);
		}
		this.projectiles = keep;
	}
	/** Resolve a spit landing on `pr.pos`. Returns true if it was absorbed. */
	projectileHit(pr) {
		const c = pr.pos;
		const owner = this.players[pr.owner];
		const hit = () => {
			this.events.push({
				type: "spitHit",
				pos: { ...c }
			});
			return true;
		};
		if (this.solid[this.ix(c)]) {
			if (!(c.x < this.ring || c.y < this.ring || c.x >= this.w - this.ring || c.y >= this.h - this.ring)) {
				this.broken.add(this.ix(c));
				this.rebuildSolid();
			}
			return hit();
		}
		if (this.bossAt(c)) {
			const b = this.boss;
			if (b.kind === "serpent" || !b.shield) this.damageBoss(1);
			return hit();
		}
		const si = this.shedWalls.findIndex((w) => eq(w.pos, c));
		if (si >= 0) {
			this.shedWalls.splice(si, 1);
			return hit();
		}
		const mi = this.mines.findIndex((m) => eq(m.pos, c));
		if (mi >= 0) {
			this.mines.splice(mi, 1);
			if (owner) owner.score += Math.round(15 * this.lengthMultP(owner));
			this.events.push({
				type: "defuse",
				pos: c
			});
			return hit();
		}
		const mo = this.mice.findIndex((m) => eq(m.pos, c));
		if (mo >= 0) {
			const [m] = this.mice.splice(mo, 1);
			if (owner) {
				const pts = Math.round(20 * this.lengthMultP(owner));
				owner.score += pts;
				this.events.push({
					type: "mouse",
					pos: m.pos,
					points: pts,
					drone: m.drone
				});
			}
			return hit();
		}
		if (this.rival?.body.some((s) => eq(s, c))) {
			this.killRival(true);
			return hit();
		}
		for (const o of this.players) {
			if (o.id === pr.owner || !o.alive || !o.body.some((s) => eq(s, c))) continue;
			const remove = Math.min(3, Math.max(0, o.body.length - 3));
			const cells = o.body.splice(o.body.length - remove, remove);
			o.prevBody = o.prevBody.slice(0, o.body.length);
			this.events.push({
				type: "shrink",
				cells
			});
			return hit();
		}
		return false;
	}
	rattle(p) {
		const h = p.body[0];
		for (const m of this.mice) if (chebyshev(m.pos, h) <= 3) m.stunned = 2e3;
		if (this.rival && this.rival.body.some((s) => chebyshev(s, h) <= 3)) this.rival.stunned = 2e3;
		if (this.boss?.kind === "serpent" && this.boss.body.some((s) => chebyshev(s, h) <= 3)) this.boss.stunned = Math.max(this.boss.stunned, 1500);
		this.events.push({
			type: "stun",
			pos: { ...h }
		});
	}
	loadLevel(level, showBanner) {
		this.level = level;
		this.levelFoods = 0;
		let treasure = [];
		let spec;
		if (this.mode.world) {
			const gen = generateWorld(this.seed, this.w);
			this.world = gen.world;
			treasure = gen.treasure;
			spec = gen.spec;
		} else if (this.custom) spec = levelFromData(this.custom);
		else if (this.mode.levels) spec = arcadeLevel(level, this.startArena, this.rng, {
			hazards: this.mode.hazards,
			bosses: this.mode.bosses,
			twists: this.mode.twists
		});
		else spec = simpleLevel(this.mode.arena === "custom" || this.mode.arena === "world" ? "box" : this.mode.arena, this.mode.powerUps);
		this.spec = spec;
		this.arena = spec.arena;
		this.modifiers = new Set(spec.modifiers);
		this.broken.clear();
		this.mazeIndex = 0;
		this.mazeFoods = 0;
		this.mazeWalls = this.arena.mazes.length ? this.arena.mazes[0] : [];
		this.pendingMaze = null;
		this.ring = 0;
		this.collapseActive = this.arena.collapse;
		this.collapseTimer = COLLAPSE_EVERY_MS;
		this.wells = spec.wells.map((w) => ({ ...w }));
		this.arrows = spec.arrows.map((a) => ({
			pos: { ...a.pos },
			dir: a.dir
		}));
		this.rebuildSolid();
		const spawns = this.players.length === 2 ? [[this.levelSpawnFor(0), "right"], [this.levelSpawnFor(1), "left"]] : [[spec.spawn, spec.spawnDir]];
		this.players.forEach((p, i) => {
			const [pos, dir] = spawns[i];
			p.body = this.layBody(pos, dir, 4);
			p.prevBody = p.body.map((s) => ({ ...s }));
			p.dir = dir;
			p.queue = [];
			p.iceBuffer = null;
			p.grow = 0;
			p.acc = 0;
			p.effects = {};
			p.combo = 0;
			p.lastEatTime = -Infinity;
			p.maxLength = Math.max(p.maxLength, p.body.length);
		});
		this.acc = 0;
		this.pickups = [];
		this.shedWalls = [];
		this.mice = [];
		this.mines = spec.mines.map((pos) => ({
			pos: { ...pos },
			offset: this.rng.int(MINE_PERIOD_MS)
		}));
		this.rival = null;
		this.projectiles = [];
		this.boss = null;
		this.snapshots = [];
		this.snapTimer = 0;
		this.enclosed = new Uint8Array(this.w * this.h);
		for (let i = 0; i < spec.randomMines; i++) {
			const pos = this.freeCell(6);
			if (pos) this.mines.push({
				pos,
				offset: this.rng.int(MINE_PERIOD_MS)
			});
		}
		if (this.modifiers.has("wells") && !this.wells.length) for (let i = 0; i < 2; i++) {
			const pos = this.freeCell(6);
			if (pos) this.wells.push(pos);
		}
		if (this.modifiers.has("arrows") && !this.arrows.length) for (let i = 0; i < 5; i++) {
			const pos = this.freeCell(5);
			if (pos) this.arrows.push({
				pos,
				dir: this.rng.pick(DIR_LIST)
			});
		}
		this.rivalRespawn = spec.rival ? 3e3 : Infinity;
		if (spec.boss) this.spawnBoss(spec.boss, spec.bossTier);
		for (let i = 0; i < this.mode.foods; i++) this.spawnPickup("food", Infinity);
		if (this.world) {
			for (const t of treasure) this.spawnPickup(t.kind, Infinity, { ...t.pos });
			for (let i = 1; i < ENDLESS_FOOD; i++) this.spawnPickup("food", Infinity);
			this.biome = null;
			this.syncBiome();
		}
		this.powerTimer = this.rng.range(5e3, 8e3);
		this.mouseTimer = this.rng.range(7e3, 11e3);
		this.banner = null;
		if (showBanner) {
			const twist = spec.modifiers.length ? ` · ${spec.modifiers.map((m) => m[0].toUpperCase() + m.slice(1)).join(" + ")}` : "";
			this.banner = {
				title: spec.boss ? "Boss fight" : `Level ${level}`,
				subtitle: `${this.arena.name}${twist}`,
				ttl: BANNER_MS
			};
		}
	}
	/** Lay a body behind `head`, bending around walls and edges if needed. */
	layBody(head, dir, len) {
		const cells = [{ ...head }];
		let back = OPPOSITE[dir];
		let cur = head;
		const free = (c) => this.inb(c) && !this.solid[this.ix(c)] && !cells.some((s) => eq(s, c));
		for (let i = 1; i < len; i++) {
			const d = [back, ...DIR_LIST.filter((d) => d !== back && d !== dir)].find((o) => free(add(cur, DIRS[o])));
			if (d) {
				cur = add(cur, DIRS[d]);
				back = d;
			}
			cells.push({ ...cur });
		}
		return cells;
	}
	rebuildSolid() {
		this.solid.fill(0);
		for (const w of this.arena.walls) this.solid[this.ix(w)] = 1;
		for (const w of this.mazeWalls) this.solid[this.ix(w)] = 1;
		for (const b of this.broken) this.solid[b] = 0;
		const r = this.ring;
		if (r > 0) {
			for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (x < r || y < r || x >= this.w - r || y >= this.h - r) this.solid[y * this.w + x] = 1;
		}
	}
	/** Move or drop anything now sitting inside a solid cell. */
	evictFromSolid() {
		const inSolid = (p) => this.solid[this.ix(p)] === 1;
		const lost = this.pickups.filter((p) => inSolid(p.pos));
		this.pickups = this.pickups.filter((p) => !inSolid(p.pos));
		for (const p of lost) if (p.kind === "food") this.spawnPickup("food", Infinity);
		this.shedWalls = this.shedWalls.filter((w) => !inSolid(w.pos));
		this.mines = this.mines.filter((m) => !inSolid(m.pos));
		this.mice = this.mice.filter((m) => !inSolid(m.pos));
		this.wells = this.wells.filter((w) => !inSolid(w));
		this.arrows = this.arrows.filter((a) => !inSolid(a.pos));
		if (this.rival && inSolid(this.rival.body[0])) this.killRival(false);
	}
	applyMaze() {
		const next = this.pendingMaze ?? [];
		this.pendingMaze = null;
		const occupied = (p) => this.players.some((pl) => pl.body.some((s) => eq(s, p))) || (this.rival?.body.some((s) => eq(s, p)) ?? false);
		this.mazeWalls = next.filter((p) => !occupied(p));
		this.broken.clear();
		this.rebuildSolid();
		this.evictFromSolid();
		this.events.push({ type: "shift" });
	}
	inSpawnLane(c) {
		for (const p of this.players) {
			const h = p.body[0];
			if (!h) continue;
			if (!(p.body.length && eq(p.body[0], this.levelSpawnFor(p.id)))) continue;
			const d = DIRS[p.dir];
			for (let i = 0; i <= 7; i++) if (eq(c, {
				x: h.x + d.x * i,
				y: h.y + d.y * i
			})) return true;
		}
		return false;
	}
	levelSpawnFor(id) {
		if (this.players.length === 2) {
			const dx = Math.round(this.w / 6);
			const dy = Math.round(this.h / 4);
			return id === 0 ? {
				x: dx,
				y: dy
			} : {
				x: this.w - 1 - dx,
				y: this.h - 1 - dy
			};
		}
		return this.spec.spawn;
	}
	/** Cell free of everything; optionally at least `minDist` from every snake head. */
	freeCell(minDist = 3, near) {
		const heads = this.liveHeads();
		const ok = (p) => (!near || chebyshev(p, near.at) <= near.radius) && this.spawnable(p, minDist, heads);
		for (let i = 0; i < 200; i++) {
			const p = {
				x: this.rng.int(this.w),
				y: this.rng.int(this.h)
			};
			if (ok(p)) return p;
		}
		for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (ok({
			x,
			y
		})) return {
			x,
			y
		};
		if (near) return this.freeCell(minDist);
		return minDist > 0 ? this.freeCell(0) : null;
	}
	liveHeads() {
		return this.players.filter((p) => p.alive && p.body.length).map((p) => p.body[0]);
	}
	/** Free of everything and at least `minDist` (Manhattan) from every head. */
	spawnable(p, minDist, heads) {
		if (this.solid[this.ix(p)] || this.enclosed[this.ix(p)]) return false;
		if (heads.some((h) => manhattan(p, h) < minDist)) return false;
		if (this.collapseWarning && this.inNextRing(p)) return false;
		if (this.pendingMaze?.some((w) => eq(w, p))) return false;
		if (this.portalExit(p)) return false;
		if (this.bossAt(p)) return false;
		if (this.players.some((pl) => pl.body.some((s) => eq(s, p)))) return false;
		if (this.pickups.some((s) => eq(s.pos, p))) return false;
		if (this.shedWalls.some((s) => eq(s.pos, p))) return false;
		if (this.mines.some((s) => eq(s.pos, p))) return false;
		if (this.mice.some((s) => eq(s.pos, p))) return false;
		if (this.wells.some((s) => eq(s, p))) return false;
		if (this.arrows.some((s) => eq(s.pos, p))) return false;
		if (this.rival?.body.some((s) => eq(s, p))) return false;
		if (this.inSpawnLane(p)) return false;
		return true;
	}
	/** Where new things appear: anywhere on an arena, near player 1 in the Endless world. */
	spawnCell(minDist) {
		if (!this.world) return this.freeCell(minDist);
		const at = this.p0.body[0];
		const heads = this.liveHeads();
		const span = 23;
		for (let i = 0; i < 120; i++) {
			const p = {
				x: at.x - SPAWN_RADIUS + this.rng.int(span),
				y: at.y - SPAWN_RADIUS + this.rng.int(span)
			};
			if (this.inb(p) && this.spawnable(p, minDist, heads)) return p;
		}
		return null;
	}
	/** Twists follow the biome under player 1's head. */
	syncBiome() {
		const head = this.p0.body[0];
		if (!this.world || !head) return;
		const b = biomeAt(this.world, head);
		if (b.id === this.biome) return;
		this.biome = b.id;
		this.modifiers = new Set(b.modifiers);
	}
	/** Keep a few foods near the head: far ones move closer, missing ones are topped up. */
	tendFood() {
		const head = this.p0.body[0];
		if (!head) return;
		let foods = 0;
		for (const pk of [...this.pickups]) {
			if (pk.kind !== "food") continue;
			if (chebyshev(pk.pos, head) > FOOD_LEASH) this.pickups.splice(this.pickups.indexOf(pk), 1);
			else foods++;
		}
		if (foods < ENDLESS_FOOD) this.spawnPickup("food", Infinity);
	}
	inNextRing(p) {
		const r = this.ring + 1;
		return p.x < r || p.y < r || p.x >= this.w - r || p.y >= this.h - r;
	}
	spawnPickup(kind, ttl, at) {
		const pos = at ?? this.spawnCell(3);
		if (!pos) return;
		this.pickups.push({
			id: this.nextId++,
			kind,
			pos,
			ttl,
			maxTtl: ttl,
			age: 0
		});
	}
	spawnMouse(drone, near) {
		const pos = this.world && !near ? this.spawnCell(6) : this.freeCell(drone ? 3 : 6, near);
		if (pos) this.mice.push({
			id: this.nextId++,
			pos,
			prev: { ...pos },
			ttl: drone ? Infinity : MOUSE_TTL_MS,
			stunned: 0,
			drone
		});
	}
	blockedForCritter(p, self, ignoreShed = false) {
		if (!this.inb(p)) return true;
		if (this.solid[this.ix(p)]) return true;
		if (this.portalExit(p)) return true;
		if (this.bossAt(p)) return true;
		if (!ignoreShed && this.shedWalls.some((w) => eq(w.pos, p))) return true;
		if (this.mines.some((m) => eq(m.pos, p))) return true;
		if (this.players.some((pl) => pl.alive && pl.body.some((s) => eq(s, p)))) return true;
		if (this.collapseWarning && this.inNextRing(p)) return true;
		if (self) {
			for (let i = 0; i < self.length - 1; i++) if (eq(self[i], p)) return true;
		}
		return false;
	}
	neighbour(p, d) {
		const n = add(p, DIRS[d]);
		return this.wraps ? this.wrapAt(n) : n;
	}
	stepMice() {
		this.miceSkip = !this.miceSkip;
		if (!this.mice.length || this.miceSkip) return;
		const heads = this.players.filter((p) => p.alive).map((p) => p.body[0]);
		const distTo = (c) => Math.min(...heads.map((h) => manhattan(c, h)));
		for (const m of this.mice) {
			if (m.stunned > 0) continue;
			const options = DIR_LIST.map((d) => this.neighbour(m.pos, d)).filter((p) => !this.blockedForCritter(p) && !this.pickups.some((q) => eq(q.pos, p)) && !this.mice.some((o) => o !== m && eq(o.pos, p)) && !(this.rival?.body.some((s) => eq(s, p)) ?? false));
			if (!options.length) continue;
			m.pos = this.rng.next() < .25 ? this.rng.pick(options) : options.reduce((best, p) => distTo(p) > distTo(best) ? p : best);
		}
	}
	spawnRival() {
		const head = this.p0.body[0];
		for (let tries = 0; tries < 80; tries++) {
			const start = {
				x: this.rng.int(this.w),
				y: this.rng.int(this.h)
			};
			const dir = this.rng.pick(DIR_LIST);
			const back = DIRS[OPPOSITE[dir]];
			const body = [];
			for (let i = 0; i < 4; i++) body.push({
				x: start.x + back.x * i,
				y: start.y + back.y * i
			});
			if (manhattan(start, head) < 9) continue;
			if (body.some((p) => this.blockedForCritter(p) || this.pickups.some((q) => eq(q.pos, p)))) continue;
			if (this.blockedForCritter(this.neighbour(start, dir))) continue;
			this.rival = {
				body,
				prevBody: body.map((p) => ({ ...p })),
				dir,
				grow: 0,
				stunned: 0
			};
			this.rivalRespawn = RIVAL_RESPAWN_MS;
			return;
		}
		this.rivalRespawn = 1e3;
	}
	/** BFS towards the nearest target cell; falls back to any safe move. */
	pathStep(head, dir, body, targets, ignoreShed, avoid) {
		const blocked = (c) => this.blockedForCritter(c, body, ignoreShed) || (avoid?.(c) ?? false);
		const safe = DIR_LIST.filter((d) => d !== OPPOSITE[dir]).filter((d) => !blocked(this.neighbour(head, d)) || targets.has(this.ix(this.neighbour(head, d))));
		if (!safe.length) return null;
		if (targets.size) {
			const seen = new Uint8Array(this.w * this.h);
			seen[this.ix(head)] = 1;
			const queue = [];
			for (const d of safe) {
				const n = this.neighbour(head, d);
				if (!this.inb(n) || seen[this.ix(n)]) continue;
				seen[this.ix(n)] = 1;
				queue.push({
					p: n,
					first: d
				});
			}
			for (let qi = 0; qi < queue.length; qi++) {
				const { p, first } = queue[qi];
				if (targets.has(this.ix(p))) return first;
				for (const d of DIR_LIST) {
					const n = this.neighbour(p, d);
					if (!this.inb(n) || seen[this.ix(n)]) continue;
					if (blocked(n) && !targets.has(this.ix(n))) continue;
					seen[this.ix(n)] = 1;
					queue.push({
						p: n,
						first
					});
				}
			}
		}
		return safe.includes(dir) ? dir : this.rng.pick(safe);
	}
	stepRival() {
		const r = this.rival;
		const venom = this.has("venom");
		const targets = new Set(this.pickups.filter((p) => p.kind === "food" || p.kind === "bit").map((p) => this.ix(p.pos)));
		const dir = (this.rng.next() < .12 ? null : this.pathStep(r.body[0], r.dir, r.body, targets, venom)) ?? (() => {
			const safe = DIR_LIST.filter((x) => x !== OPPOSITE[r.dir] && !this.blockedForCritter(this.neighbour(r.body[0], x), r.body, venom));
			return safe.length ? this.rng.pick(safe) : null;
		})();
		if (!dir) {
			this.killRival(this.isAdjacentToPlayer(r.body[0]));
			return;
		}
		r.dir = dir;
		const nh = this.neighbour(r.body[0], dir);
		if (venom && this.shedWalls.some((w) => eq(w.pos, nh))) {
			this.killRival(true);
			return;
		}
		for (const p of this.players) {
			if (!p.alive) continue;
			if (eq(nh, p.body[0])) {
				if (p.body.length >= r.body.length) this.killRival(true);
				else this.hurt(p, "rival", nh);
				return;
			}
			if (p.body.some((s) => eq(s, nh))) {
				this.killRival(true);
				return;
			}
		}
		r.body.unshift(nh);
		if (r.grow > 0) r.grow--;
		else r.body.pop();
		const pi = this.pickups.findIndex((p) => eq(p.pos, nh) && (p.kind === "food" || p.kind === "bit"));
		if (pi >= 0) {
			const [p] = this.pickups.splice(pi, 1);
			r.grow++;
			this.events.push({
				type: "rivalEat",
				pos: nh
			});
			if (p.kind === "food") this.spawnPickup("food", Infinity);
		}
	}
	isAdjacentToPlayer(p) {
		return this.players.some((pl) => pl.body.some((s) => manhattan(s, p) <= 1)) || this.shedWalls.some((w) => manhattan(w.pos, p) <= 1);
	}
	killRival(byPlayer) {
		const r = this.rival;
		if (!r) return 0;
		this.rival = null;
		this.rivalRespawn = RIVAL_RESPAWN_MS;
		const points = byPlayer ? Math.round(40 * this.lengthMult) : 0;
		if (byPlayer) {
			this.p0.score += points;
			this.rivalsDowned++;
		}
		this.dropBits(r.body);
		this.events.push({
			type: "rivalDie",
			cells: r.body,
			byPlayer,
			points
		});
		return points;
	}
	dropBits(cells) {
		for (let i = 1; i < cells.length; i += 2) {
			const p = cells[i];
			if (this.inb(p) && !this.solid[this.ix(p)] && !this.pickups.some((q) => eq(q.pos, p)) && !this.players.some((pl) => pl.body.some((s) => eq(s, p)))) this.spawnPickup("bit", BIT_TTL_MS, { ...p });
		}
	}
	spawnBoss(kind, tier) {
		const hp = 3 + (tier - 1);
		const b = {
			kind,
			tier,
			hp,
			maxHp: hp,
			invuln: 0,
			stunned: 1500,
			body: [],
			prevBody: [],
			dir: "left",
			moveTick: 0,
			core: {
				x: 15,
				y: 5
			},
			shield: true,
			shieldTimer: 0,
			dronesEaten: 0,
			spawnTimer: 1200,
			mineTimer: 5e3,
			hitCooldown: 0
		};
		if (kind === "serpent") {
			b.body = this.layBody({
				x: 19,
				y: 19
			}, "up", 10 + tier * 2);
			b.prevBody = b.body.map((s) => ({ ...s }));
			b.dir = "up";
		}
		this.boss = b;
	}
	tickBoss(dt) {
		const b = this.boss;
		b.invuln = Math.max(0, b.invuln - dt);
		b.stunned = Math.max(0, b.stunned - dt);
		b.hitCooldown = Math.max(0, b.hitCooldown - dt);
		if (b.kind !== "queen") return;
		const near = {
			at: {
				x: b.core.x,
				y: b.core.y
			},
			radius: 5
		};
		b.spawnTimer -= dt;
		if (b.spawnTimer <= 0) {
			b.spawnTimer = 2500;
			if (this.mice.filter((m) => m.drone).length < 6) this.spawnMouse(true, near);
		}
		b.mineTimer -= dt;
		if (b.mineTimer <= 0) {
			b.mineTimer = 7e3 - b.tier * 500;
			if (this.mines.length < 4 + b.tier) {
				const pos = this.freeCell(5, {
					at: b.core,
					radius: 7
				});
				if (pos) this.mines.push({
					pos,
					offset: this.rng.int(MINE_PERIOD_MS)
				});
			}
		}
		if (!b.shield) {
			b.shieldTimer -= dt;
			if (b.shieldTimer <= 0) {
				b.shield = true;
				b.dronesEaten = 0;
				this.events.push({
					type: "shield",
					up: true
				});
			}
		}
	}
	stepBoss() {
		const b = this.boss;
		if (b.kind === "queen") {
			if (b.shield || b.hitCooldown > 0) return;
			const cells = this.bossCells();
			if (this.players.some((p) => p.alive && cells.some((c) => manhattan(c, p.body[0]) === 1))) {
				b.hitCooldown = 1200;
				this.damageBoss(1);
			}
			return;
		}
		b.prevBody = b.body.map((s) => ({ ...s }));
		if (b.stunned > 0) return;
		b.moveTick++;
		if (b.moveTick % 4 === 3) return;
		const target = this.p0.alive ? this.p0 : this.players.find((p) => p.alive);
		if (!target) return;
		const th = target.body[0];
		const ahead = add(th, DIRS[target.dir]);
		const targets = /* @__PURE__ */ new Set([this.ix(th)]);
		if (this.inb(ahead)) targets.add(this.ix(ahead));
		const saved = this.boss;
		this.boss = null;
		const d = this.pathStep(b.body[0], b.dir, b.body, targets, true, (c) => this.players.some((p) => p.alive && p.body.slice(1).some((s) => eq(s, c))));
		this.boss = saved;
		if (!d) {
			this.damageBoss(1);
			return;
		}
		b.dir = d;
		const nh = this.neighbour(b.body[0], d);
		for (const p of this.players) if (p.alive && eq(p.body[0], nh)) {
			this.hurt(p, "boss", nh);
			return;
		}
		const si = this.shedWalls.findIndex((w) => eq(w.pos, nh));
		if (si >= 0) {
			this.shedWalls.splice(si, 1);
			this.damageBoss(this.has("venom") ? 2 : 1);
			return;
		}
		b.body.unshift(nh);
		b.body.pop();
	}
	damageBoss(n) {
		const b = this.boss;
		if (!b || b.invuln > 0) return;
		b.hp = Math.max(0, b.hp - n);
		b.invuln = 1200;
		const pos = b.kind === "serpent" ? b.body[0] : b.core;
		this.events.push({
			type: "bossHit",
			pos: { ...pos },
			hp: b.hp
		});
		if (b.kind === "serpent") {
			b.stunned = 1200;
			const remove = Math.min(3, Math.max(0, b.body.length - 3));
			const cut = b.body.splice(b.body.length - remove, remove);
			b.prevBody = b.prevBody.slice(0, b.body.length);
			this.dropBits(cut);
		}
		if (b.hp <= 0) this.killBoss();
	}
	killBoss() {
		const b = this.boss;
		const cells = this.bossCells().map((c) => ({ ...c }));
		const points = Math.round(200 * b.tier * this.lengthMult);
		this.p0.score += points;
		this.bossesDefeated++;
		this.boss = null;
		this.mice = this.mice.filter((m) => !m.drone);
		this.dropBits(cells);
		this.events.push({
			type: "bossDie",
			cells,
			kind: b.kind,
			points
		});
		this.completeLevel();
	}
};
//#endregion
//#region src/replay.ts
/**
* Replays. The engine is deterministic, so a run is fully described by its options plus the
* inputs applied at each 16 ms simulation frame. Used for instant replays, watching
* leaderboard runs, and server-side score verification (bundled into api/_engine.js).
*/
var FRAME_MS = 16;
/** Hard cap so a malicious replay can't keep the server busy: 40 minutes of play. */
var MAX_FRAMES = 15e4;
var MODES = [
	"classic",
	"arcade",
	"daily",
	"zen",
	"rhythm",
	"versus",
	"custom",
	"endless"
];
var CLASSES = [
	"racer",
	"viper",
	"cobra",
	"python"
];
var DIR_CODE = {
	up: "U",
	down: "D",
	left: "L",
	right: "R"
};
var CODE_DIR = {
	U: "up",
	D: "down",
	L: "left",
	R: "right"
};
function applyInput(g, i) {
	switch (i.t) {
		case "turn":
			g.turn(i.d, i.p);
			break;
		case "shed":
			g.shed(i.p);
			break;
		case "hold":
			g.setHeld(i.p, i.on);
			break;
		case "draft": g.chooseMutation(i.i);
	}
}
function inputCode(i) {
	const p = i.p === 1 ? "!" : "";
	switch (i.t) {
		case "turn": return p + DIR_CODE[i.d];
		case "shed": return `${p}S`;
		case "hold": return p + (i.on ? "H" : "h");
		case "draft": return `${p}#${i.i}`;
	}
}
function parseCode(c) {
	const p = c.startsWith("!") ? 1 : 0;
	const body = p ? c.slice(1) : c;
	if (CODE_DIR[body]) return {
		p,
		t: "turn",
		d: CODE_DIR[body]
	};
	if (body === "S") return {
		p,
		t: "shed"
	};
	if (body === "H" || body === "h") return {
		p,
		t: "hold",
		on: body === "H"
	};
	const m = /^#([0-2])$/.exec(body);
	if (m) return {
		p,
		t: "draft",
		i: Number(m[1])
	};
	return null;
}
var b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
var unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
/** Compact text form: v1|mode|seed|classes|frames|level|inputs ("<delta><code>" joined by "."). */
function encodeReplay(r) {
	let last = 0;
	const inputs = r.inputs.map(({ f, i }) => {
		const d = f - last;
		last = f;
		return `${d}${inputCode(i)}`;
	}).join(".");
	const level = r.level ? b64url(JSON.stringify(r.level)) : "";
	return [
		"v1",
		r.mode,
		r.seed >>> 0,
		r.classes.join(","),
		r.frames,
		level,
		inputs
	].join("|");
}
function decodeReplay(s) {
	if (typeof s !== "string" || s.length > 4e5) return null;
	const parts = s.split("|");
	if (parts.length !== 7 || parts[0] !== "v1") return null;
	const [, mode, seedS, classesS, framesS, levelS, inputsS] = parts;
	if (!MODES.includes(mode)) return null;
	const seed = Number(seedS);
	const frames = Number(framesS);
	if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) return null;
	if (!Number.isInteger(frames) || frames < 0 || frames > 15e4) return null;
	const classes = classesS.split(",").filter((c) => CLASSES.includes(c));
	if (!classes.length || classes.length > 2) return null;
	let level;
	if (levelS) {
		try {
			level = sanitizeLevel(JSON.parse(unb64url(levelS))) ?? void 0;
		} catch {
			return null;
		}
		if (!level) return null;
	}
	const inputs = [];
	let f = 0;
	if (inputsS) for (const tok of inputsS.split(".")) {
		const m = /^(\d+)(.+)$/.exec(tok);
		if (!m) return null;
		f += Number(m[1]);
		const i = parseCode(m[2]);
		if (!i || f > frames) return null;
		inputs.push({
			f,
			i
		});
	}
	return {
		v: 1,
		mode,
		seed,
		classes,
		level,
		frames,
		inputs
	};
}
function gameFor(r) {
	return new Game({
		mode: r.mode,
		seed: r.seed,
		classes: r.classes,
		level: r.level
	});
}
/** Re-run a replay to the end. Returns the final game, or null if the replay is inconsistent. */
function simulate(r) {
	const g = gameFor(r);
	let k = 0;
	for (let f = 0; f < r.frames; f++) {
		while (k < r.inputs.length && r.inputs[k].f === f) applyInput(g, r.inputs[k++].i);
		if (g.status === "draft") return null;
		if (g.status === "over") break;
		g.update(16);
	}
	return g;
}
/** Server-side check for a leaderboard submission. */
function verifyRun(replay, board, claimed) {
	const r = decodeReplay(replay);
	if (!r) return {
		ok: false,
		error: "bad_replay"
	};
	if (r.level) return {
		ok: false,
		error: "bad_mode"
	};
	const daily = /^daily:(\d{4}-\d{2}-\d{2})$/.exec(board);
	if (daily) {
		if (r.mode !== "daily" || r.seed !== dailySeed(daily[1])) return {
			ok: false,
			error: "wrong_seed"
		};
	} else if (r.mode !== board) return {
		ok: false,
		error: "bad_mode"
	};
	const g = simulate(r);
	if (!g || g.status !== "over") return {
		ok: false,
		error: "replay_incomplete"
	};
	if (g.score !== claimed) return {
		ok: false,
		error: "score_mismatch"
	};
	return {
		ok: true,
		score: g.score,
		level: g.level,
		timeMs: g.time,
		cls: g.p0.cls
	};
}
//#endregion
export { DIR_LIST, FRAME_MS, MAX_FRAMES, applyInput, dailySeed, decodeReplay, encodeReplay, gameFor, simulate, verifyRun };
