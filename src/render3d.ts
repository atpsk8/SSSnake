import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Game } from './game/engine';
import { DIRS, H, W, type Dir, type GameEvent, type PickupKind, type Vec } from './game/types';
import { BIOMES, LANDMARK_NAME, type BiomeId } from './game/world';
import type { SkinId } from './storage';

/**
 * "Neo": the 3D renderer. Glossy neon tube snakes on a reflective arena, bloom, a follow
 * camera that swoops in for instant replays, GPU-ish particles and light shockwaves.
 * Same contract as the 2D Renderer: reset / handle(events) / draw(game, dt).
 * Boards bigger than 24x24 (Endless) get a biome-tinted floor and a camera that follows the head.
 */

export type Quality = 'high' | 'low';

const COLORS = {
  bg: 0x05070d,
  floor: 0x0b1220,
  grid: '#1d2b48',
  wall: 0x22345c,
  p1: 0x38e1ff,
  p2: 0xff4fa3,
  rival: 0xa78bfa,
  boss: 0xff5470,
  food: 0xff4fa3,
  gold: 0xffd166,
  rot: 0x7a6a3a,
  mine: 0x2a2f3d,
  danger: 0xff5470,
  mouse: 0xd8dee9,
  drone: 0xc77dff,
  portalA: 0x38e1ff,
  portalB: 0xffa53d,
  well: 0xa78bfa,
  arrow: 0x2ee6b8,
  spit: 0x9dff6a,
  power: { phase: 0xc4a7ff, slowmo: 0x6ab8ff, magnet: 0xff8a3d, shrink: 0x9dff6a } as Record<string, number>,
};

const SKIN_COLOR: Record<SkinId, number> = { classic: COLORS.p1, ember: 0xff8a3d, ghost: 0xe6f0ff, gold: COLORS.gold };

/** Endless floor colour per biome. */
const BIOME_FLOOR: Record<BiomeId, number> = {
  meadow: COLORS.floor,
  glacier: 0x10233c,
  shadow: 0x030409,
  orchard: 0x101b0d,
  vortex: 0x180d28,
  circuit: 0x07191c,
  badlands: 0x210f0b,
};
/** Big boards only draw items this close (in cells) to the camera target. */
const CULL = 30;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// Board size of the game being drawn; set by Renderer3D.setBoard().
let BW = W;
let BH = H;
const wx = (x: number) => x - BW / 2 + 0.5;
const wz = (y: number) => y - BH / 2 + 0.5;

function slide(cur: Vec[], prev: Vec[], t: number): Vec[] {
  return cur.map((c, i) => {
    const p = prev[i] ?? prev[prev.length - 1] ?? c;
    if (Math.abs(p.x - c.x) + Math.abs(p.y - c.y) > 1) return c;
    return { x: lerp(p.x, c.x, t), y: lerp(p.y, c.y, t) };
  });
}

interface Burst {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  r: number;
  g: number;
  b: number;
}

interface Shock {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  radius: number;
}

interface Popup {
  el: HTMLElement;
  x: number;
  y: number;
  z: number;
  life: number;
  max: number;
}

export class Renderer3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private width = 1;
  private height = 1;
  private clock = 0;
  private shake = 0;
  private flash = 0;
  private beat = 0;
  private target = new THREE.Vector3();
  private orbit = 0;

  private keyLight: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private headLights: THREE.PointLight[] = [];
  private floorMat: THREE.MeshStandardMaterial;
  private floor: THREE.Mesh;
  private outer: THREE.Mesh;
  private frame: THREE.LineSegments;
  private bw = W;
  private bh = H;
  private lastBiome: BiomeId | null = null;
  private landmarksSeen = new Set<number>();

  private walls: THREE.InstancedMesh;
  private ringWalls: THREE.InstancedMesh;
  private pending: THREE.InstancedMesh;
  private sheds: THREE.InstancedMesh;
  private coilTiles: THREE.InstancedMesh;
  private boardKey = '';

  private tubes: THREE.Mesh[] = [];
  private tubeUsed = 0;
  private heads: THREE.Group[] = [];
  private headUsed = 0;

  private pickupMeshes = new Map<number, THREE.Object3D>();
  private mineMeshes: THREE.Group[] = [];
  private mouseMeshes = new Map<number, THREE.Object3D>();
  private portalMeshes: THREE.Object3D[] = [];
  private wellMeshes: THREE.Object3D[] = [];
  private arrowMeshes: THREE.Object3D[] = [];
  private projectileMeshes: THREE.Mesh[] = [];
  private queen: THREE.Group;
  private crown: THREE.Group;

  private points: THREE.Points;
  private pointPos: Float32Array;
  private pointCol: Float32Array;
  private bursts: Burst[] = [];
  private shocks: Shock[] = [];
  private coil: { cells: Vec[]; life: number } | null = null;

  private overlay: HTMLDivElement;
  private popups: Popup[] = [];
  private labels: HTMLDivElement[] = [];

  private geo = {
    head: new THREE.SphereGeometry(0.42, 24, 16),
    eye: new THREE.SphereGeometry(0.11, 12, 8),
    pupil: new THREE.SphereGeometry(0.06, 8, 6),
    food: new THREE.IcosahedronGeometry(0.27, 1),
    gold: new THREE.OctahedronGeometry(0.34, 0),
    bit: new THREE.SphereGeometry(0.12, 10, 8),
    power: new THREE.BoxGeometry(0.46, 0.46, 0.46),
    mineCore: new THREE.IcosahedronGeometry(0.22, 0),
    spike: new THREE.ConeGeometry(0.06, 0.22, 6),
    mouse: new THREE.CapsuleGeometry(0.14, 0.22, 4, 8),
    drone: new THREE.OctahedronGeometry(0.22, 0),
    portal: new THREE.TorusGeometry(0.36, 0.06, 10, 32),
    well: new THREE.TorusGeometry(0.4, 0.035, 8, 32),
    projectile: new THREE.SphereGeometry(0.15, 12, 10),
    shock: new THREE.TorusGeometry(1, 0.03, 6, 48),
    tile: new THREE.PlaneGeometry(0.94, 0.94),
  };

  ghost: Vec[] | null = null;
  marker: Vec | null = null;
  camera: { x: number; y: number; zoom: number } | null = null;
  skin: SkinId = 'classic';
  reducedMotion = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    container: HTMLElement,
    readonly quality: Quality,
  ) {
    const high = quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: high, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.background = new THREE.Color(COLORS.bg);
    this.scene.fog = new THREE.Fog(COLORS.bg, 28, 62);
    if (high) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.35;
      pmrem.dispose();
    }

    this.cam = new THREE.PerspectiveCamera(40, 1, 0.5, 120);
    this.cam.position.set(0, 24, 17);
    this.cam.lookAt(0, 0, 0);

    this.hemi = new THREE.HemisphereLight(0x8fb8ff, 0x0b0f1a, 0.55);
    this.scene.add(this.hemi);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.keyLight.position.set(8, 22, 10);
    if (high) {
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.set(2048, 2048);
      const s = this.keyLight.shadow.camera;
      s.left = -15;
      s.right = 15;
      s.top = 15;
      s.bottom = -15;
      s.near = 1;
      s.far = 60;
      this.keyLight.shadow.bias = -0.0005;
    }
    this.scene.add(this.keyLight);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(i ? COLORS.p2 : COLORS.p1, 0, 7, 1.6);
      this.headLights.push(l);
      this.scene.add(l);
    }

    // Arena floor with a faint glowing grid.
    this.floorMat = new THREE.MeshStandardMaterial({
      color: COLORS.floor,
      roughness: 0.32,
      metalness: 0.55,
      emissive: 0xffffff,
      emissiveMap: gridTexture(W, 1),
      emissiveIntensity: 0.6,
    });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = high;
    this.scene.add(this.floor);
    this.outer = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 140),
      new THREE.MeshStandardMaterial({ color: 0x03050a, roughness: 0.9, metalness: 0 }),
    );
    this.outer.rotation.x = -Math.PI / 2;
    this.outer.position.y = -0.02;
    this.scene.add(this.outer);

    const edge = new THREE.EdgesGeometry(new THREE.BoxGeometry(W, 0.001, H));
    this.frame = new THREE.LineSegments(edge, new THREE.LineBasicMaterial({ color: COLORS.p1, transparent: true, opacity: 0.6 }));
    this.frame.position.y = 0.01;
    this.scene.add(this.frame);

    const wallMat = new THREE.MeshStandardMaterial({ color: COLORS.wall, roughness: 0.25, metalness: 0.35, emissive: 0x0a1838, emissiveIntensity: 1 });
    this.walls = new THREE.InstancedMesh(new THREE.BoxGeometry(0.92, 0.9, 0.92), wallMat, W * H);
    this.walls.castShadow = high;
    this.walls.receiveShadow = high;
    this.walls.count = 0;
    this.scene.add(this.walls);
    this.ringWalls = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.96, 0.5, 0.96),
      new THREE.MeshStandardMaterial({ color: 0x3a0d18, emissive: COLORS.danger, emissiveIntensity: 0.35, transparent: true, opacity: 0.75 }),
      W * H,
    );
    this.ringWalls.count = 0;
    this.scene.add(this.ringWalls);
    this.pending = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.9),
      new THREE.MeshBasicMaterial({ color: COLORS.danger, wireframe: true, transparent: true, opacity: 0.5 }),
      W * H,
    );
    this.pending.count = 0;
    this.scene.add(this.pending);
    this.sheds = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.86, 0.45, 0.86),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.25, transparent: true, opacity: 0.55, roughness: 0.2 }),
      W * H,
    );
    this.sheds.count = 0;
    this.scene.add(this.sheds);
    this.coilTiles = new THREE.InstancedMesh(
      this.geo.tile,
      new THREE.MeshBasicMaterial({ color: COLORS.gold, transparent: true, opacity: 0.4, depthWrite: false }),
      W * H,
    );
    this.coilTiles.count = 0;
    this.scene.add(this.coilTiles);

    this.queen = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.9, 0),
      new THREE.MeshStandardMaterial({ color: COLORS.boss, emissive: COLORS.boss, emissiveIntensity: 0.6, roughness: 0.3, metalness: 0.4 }),
    );
    core.name = 'core';
    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x6ab8ff, wireframe: true, transparent: true, opacity: 0.35 }),
    );
    shield.name = 'shield';
    this.queen.add(core, shield);
    this.queen.visible = false;
    this.scene.add(this.queen);

    this.crown = new THREE.Group();
    const crownMat = new THREE.MeshStandardMaterial({ color: COLORS.gold, emissive: COLORS.gold, emissiveIntensity: 0.5, metalness: 0.8, roughness: 0.25 });
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 6), crownMat);
      const a = (i / 5) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.22, 0.15, Math.sin(a) * 0.22);
      this.crown.add(spike);
    }
    this.crown.visible = false;
    this.scene.add(this.crown);

    const CAP = 900;
    this.pointPos = new Float32Array(CAP * 3);
    this.pointCol = new Float32Array(CAP * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pointPos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pointCol, 3));
    pg.setDrawRange(0, 0);
    this.points = new THREE.Points(
      pg,
      new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    if (high) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.cam));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.4, 0.5);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }

    this.overlay = document.createElement('div');
    this.overlay.className = 'popups3d';
    container.appendChild(this.overlay);
  }

  dispose() {
    this.overlay.remove();
    this.renderer.dispose();
  }

  setVisible(v: boolean) {
    this.canvas.style.display = v ? 'block' : 'none';
    this.overlay.style.display = v ? 'block' : 'none';
  }

  resize(w: number, h: number) {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));
    this.renderer.setSize(this.width, this.height, false);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.composer?.setSize(this.width, this.height);
    this.cam.aspect = this.width / this.height;
    this.cam.updateProjectionMatrix();
  }

  reset() {
    this.bursts = [];
    for (const s of this.shocks) this.scene.remove(s.mesh);
    this.shocks = [];
    for (const p of this.popups) p.el.remove();
    this.popups = [];
    this.coil = null;
    this.shake = 0;
    this.flash = 0;
    this.ghost = null;
    this.boardKey = '';
    this.lastBiome = null;
    this.landmarksSeen.clear();
  }

  private get big() {
    return this.bw > W || this.bh > H;
  }

  /** Match the floor, frame and instance buffers to this game's board size. */
  private setBoard(game: Game) {
    BW = game.w;
    BH = game.h;
    const tintKey = game.world ? game.world.biome : null;
    if (game.w === this.bw && game.h === this.bh && (this.floorMat.map?.userData.biome ?? null) === tintKey) return;
    const resized = game.w !== this.bw || game.h !== this.bh;
    this.bw = game.w;
    this.bh = game.h;
    if (resized) {
      this.floor.geometry.dispose();
      this.floor.geometry = new THREE.PlaneGeometry(this.bw, this.bh);
      this.floorMat.emissiveMap?.dispose();
      this.floorMat.emissiveMap = this.big ? gridTexture(16, this.bw / 16) : gridTexture(W, 1);
      this.outer.geometry.dispose();
      this.outer.geometry = new THREE.PlaneGeometry(Math.max(140, this.bw + 80), Math.max(140, this.bh + 80));
      this.frame.geometry.dispose();
      this.frame.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(this.bw, 0.001, this.bh));
      const cap = this.bw * this.bh;
      this.walls = this.regrow(this.walls, cap);
      this.ringWalls = this.regrow(this.ringWalls, cap);
      this.pending = this.regrow(this.pending, cap);
      this.sheds = this.regrow(this.sheds, cap);
      this.coilTiles = this.regrow(this.coilTiles, cap);
      this.boardKey = '';
      if (this.big) {
        this.scene.fog = new THREE.Fog(COLORS.bg, 24, 52);
        this.scene.add(this.keyLight.target);
      } else {
        this.scene.fog = new THREE.Fog(COLORS.bg, 28, 62);
        this.keyLight.position.set(8, 22, 10);
        this.keyLight.target.position.set(0, 0, 0);
        this.keyLight.target.updateMatrixWorld();
      }
    }
    // Endless: tint the floor by biome, one texel per chunk, blended at the borders.
    this.floorMat.map?.dispose();
    if (game.world) {
      const wd = game.world;
      const data = new Uint8Array(wd.cols * wd.rows * 4);
      for (let i = 0; i < wd.biome.length; i++) {
        const hex = BIOME_FLOOR[BIOMES[wd.biome[i]].id];
        // Texture rows run bottom-up; chunk rows run top-down (north first).
        const row = wd.rows - 1 - Math.floor(i / wd.cols);
        data.set([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255], (row * wd.cols + (i % wd.cols)) * 4);
      }
      const tex = new THREE.DataTexture(data, wd.cols, wd.rows);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      tex.userData.biome = wd.biome;
      this.floorMat.map = tex;
      this.floorMat.color.setHex(0xffffff);
    } else {
      this.floorMat.map = null;
      this.floorMat.color.setHex(COLORS.floor);
    }
    this.floorMat.needsUpdate = true;
  }

  private regrow(old: THREE.InstancedMesh, cap: number): THREE.InstancedMesh {
    this.scene.remove(old);
    old.dispose();
    const m = new THREE.InstancedMesh(old.geometry, old.material, cap);
    m.castShadow = old.castShadow;
    m.receiveShadow = old.receiveShadow;
    m.count = 0;
    this.scene.add(m);
    return m;
  }

  /** Big boards: is a cell near enough to the camera to be worth drawing? */
  private near(p: Vec): boolean {
    return !this.big || (Math.abs(wx(p.x) - this.target.x) <= CULL && Math.abs(wz(p.y) - this.target.z) <= CULL);
  }

  /** Endless: pop the biome's name on entering it, and a landmark's when it first comes close. */
  private announce(game: Game) {
    const wd = game.world;
    const head = game.p0.body[0];
    if (!wd || !head || game.status !== 'playing' || this.camera) return;
    if (game.biome && game.biome !== this.lastBiome) {
      this.lastBiome = game.biome;
      const b = BIOMES.find((x) => x.id === game.biome)!;
      this.popup(b.name.toUpperCase(), { x: head.x, y: head.y - 2 }, '#e6f7ff', true);
    }
    wd.landmarks.forEach((l, i) => {
      if (this.landmarksSeen.has(i) || Math.max(Math.abs(l.pos.x - head.x), Math.abs(l.pos.y - head.y)) > 7) return;
      this.landmarksSeen.add(i);
      this.popup(LANDMARK_NAME[l.kind].toUpperCase(), { x: l.pos.x, y: l.pos.y - 2 }, '#ffd166', true);
    });
  }

  // ---------------------------------------------------------------- effects

  private burst(cells: Vec[], color: number, perCell: number, speed = 3.5, up = 2.5) {
    const c = new THREE.Color(color);
    for (const cell of cells) {
      for (let i = 0; i < perCell && this.bursts.length < 900; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = (0.3 + Math.random()) * speed;
        const life = 400 + Math.random() * 600;
        this.bursts.push({
          x: wx(cell.x),
          y: 0.5,
          z: wz(cell.y),
          vx: Math.cos(a) * s,
          vy: Math.random() * up + 0.5,
          vz: Math.sin(a) * s,
          life,
          max: life,
          r: c.r,
          g: c.g,
          b: c.b,
        });
      }
    }
  }

  private shock(at: Vec, radius: number, color: number, life = 600) {
    const mesh = new THREE.Mesh(this.geo.shock, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(wx(at.x), 0.08, wz(at.y));
    this.scene.add(mesh);
    this.shocks.push({ mesh, life, max: life, radius });
  }

  private popup(text: string, at: Vec, color = '#e6f7ff', big = false) {
    const el = document.createElement('div');
    el.className = `pop3d${big ? ' big' : ''}`;
    el.textContent = text;
    el.style.color = color;
    this.overlay.appendChild(el);
    this.popups.push({ el, x: wx(at.x), y: 0.9, z: wz(at.y), life: 1100, max: 1100 });
    while (this.popups.length > 12) this.popups.shift()!.el.remove();
  }

  private addShake(a: number) {
    if (!this.reducedMotion) this.shake = Math.max(this.shake, a);
  }

  handle(events: GameEvent[], game: Game) {
    this.setBoard(game);
    const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
    for (const e of events) {
      switch (e.type) {
        case 'eat': {
          const col = e.kind === 'golden' ? COLORS.gold : COLORS.food;
          this.burst([e.pos], col, e.kind === 'golden' ? 40 : 16);
          this.shock(e.pos, 1.2, col, 400);
          this.popup(`+${e.points}${e.mult > 1 ? ` x${+e.mult.toFixed(1)}` : ''}`, e.pos, hex(e.player === 1 ? COLORS.p2 : COLORS.p1));
          break;
        }
        case 'rot':
          this.burst([e.pos], COLORS.rot, 10);
          this.popup('rotten -10', e.pos, '#b9a774');
          break;
        case 'combo':
          this.popup(`COMBO x${e.combo}`, { x: e.pos.x, y: e.pos.y - 1 }, hex(COLORS.gold), true);
          break;
        case 'power':
          this.burst([e.pos], COLORS.power[e.kind] ?? COLORS.gold, 24);
          this.shock(e.pos, 1.8, COLORS.power[e.kind] ?? COLORS.gold);
          this.popup(e.kind.toUpperCase(), { x: e.pos.x, y: e.pos.y - 1 }, hex(COLORS.power[e.kind] ?? COLORS.gold), true);
          break;
        case 'shrink':
          this.burst(e.cells, COLORS.power.shrink, 8);
          break;
        case 'shed':
          this.burst(e.cells, e.player === 1 ? COLORS.p2 : this.p1Color(), 6, 2, 1.5);
          this.addShake(0.25);
          if (e.cells.length) this.popup('SHED', e.cells[0]);
          break;
        case 'cut':
          this.burst(e.cells, COLORS.p1, 5);
          break;
        case 'mouse':
          this.burst([e.pos], e.drone ? COLORS.drone : COLORS.mouse, 14);
          this.popup(`+${e.points}`, e.pos);
          break;
        case 'portal':
          this.burst([e.from, e.to], COLORS.portalA, 12, 2, 4);
          this.shock(e.to, 1.4, COLORS.portalA, 500);
          break;
        case 'rivalDie':
          this.burst(e.cells, COLORS.rival, 10);
          this.addShake(0.35);
          if (e.byPlayer && e.cells.length) this.popup(`RIVAL DOWN +${e.points}`, e.cells[0], hex(COLORS.rival), true);
          break;
        case 'coil': {
          this.coil = { cells: e.cells, life: 900 };
          const c = e.cells[Math.floor(e.cells.length / 2)] ?? { x: 12, y: 12 };
          this.shock(c, 4, COLORS.gold, 800);
          this.popup(`COIL x${e.captured} +${e.points}`, c, hex(COLORS.gold), true);
          this.addShake(0.3);
          break;
        }
        case 'defuse':
          this.burst([e.pos], COLORS.danger, 10);
          this.shock(e.pos, 1.5, COLORS.danger);
          break;
        case 'shift':
        case 'collapse':
          this.addShake(0.5);
          break;
        case 'levelup':
          this.burst(game.snake, this.p1Color(), 5, 3, 5);
          break;
        case 'dash':
          for (const c of e.cells) this.burst([c], this.p1Color(), 6, 1.5, 1);
          this.addShake(0.2);
          break;
        case 'spitHit':
          this.burst([e.pos], COLORS.spit, 20, 5);
          this.shock(e.pos, 1.6, COLORS.spit);
          break;
        case 'stun':
          this.shock(e.pos, 3.5, 0x6ab8ff, 700);
          this.popup('RATTLE', e.pos);
          break;
        case 'armour':
          this.shock(e.pos, 2.2, 0xffffff, 700);
          this.popup('ARMOUR HELD', e.pos, '#ffffff', true);
          this.addShake(0.5);
          break;
        case 'rewind':
          this.flash = 0.8;
          break;
        case 'bossHit':
          this.burst([e.pos], COLORS.boss, 40, 6, 4);
          this.shock(e.pos, 3, COLORS.boss, 800);
          this.popup(e.hp > 0 ? `HIT! ${e.hp} LEFT` : 'FINISHED', e.pos, hex(COLORS.boss), true);
          this.addShake(0.7);
          break;
        case 'bossDie':
          this.burst(e.cells, COLORS.boss, 14, 7, 6);
          this.burst(e.cells, COLORS.gold, 8, 5, 6);
          this.shock(e.cells[0] ?? { x: 12, y: 12 }, 8, COLORS.gold, 1200);
          this.popup(`BOSS DOWN +${e.points}`, e.cells[0] ?? { x: 12, y: 12 }, hex(COLORS.gold), true);
          this.addShake(1);
          this.flash = 0.6;
          break;
        case 'shield':
          if (!e.up && game.boss) this.popup('SHIELD DOWN', game.boss.core, hex(COLORS.gold), true);
          break;
        case 'beat':
          this.beat = e.strong ? 1 : 0.5;
          break;
        case 'onbeat':
          if (game.p0.body.length) this.popup(e.streak > 1 ? `SYNC x${e.streak}` : 'SYNC', game.p0.body[0], hex(COLORS.gold));
          break;
        case 'offbeat':
          if (game.p0.body.length) this.popup('MISS', game.p0.body[0], '#8892a6');
          break;
        case 'die':
          this.burst(e.cells, e.player === 1 ? COLORS.p2 : this.p1Color(), 6, 4, 3);
          this.burst([e.pos], COLORS.danger, 60, 8, 6);
          this.shock(e.pos, 5, COLORS.danger, 900);
          this.addShake(0.9);
          this.flash = 1;
          break;
      }
    }
  }

  private p1Color() {
    return SKIN_COLOR[this.skin] ?? COLORS.p1;
  }

  // ---------------------------------------------------------------- frame

  draw(game: Game, dt: number) {
    this.clock += dt;
    const t = this.clock / 1000;
    this.shake = Math.max(0, this.shake - dt * 0.0025);
    this.flash = Math.max(0, this.flash - dt / 500);
    this.beat = Math.max(0, this.beat - dt / 220);

    this.setBoard(game);
    this.updateBoard(game);
    this.announce(game);
    this.tubeUsed = 0;
    this.headUsed = 0;

    const dark = game.modifiers.has('dark');
    const slow = game.players.some((p) => p.alive && p.effects.slowmo);
    this.hemi.intensity = dark ? 0.04 : 0.55;
    this.keyLight.intensity = dark ? 0.05 : 1.4;
    this.floorMat.emissiveIntensity = (dark ? 0.12 : 0.55) + this.beat * 0.6;
    (this.scene.fog as THREE.Fog).color.setHex(slow ? 0x0a1830 : COLORS.bg);
    (this.scene.background as THREE.Color).setHex(slow ? 0x0a1426 : COLORS.bg);
    if (this.bloom) this.bloom.strength = 0.5 + (slow ? 0.2 : 0) + this.flash * 0.6;

    // Players
    game.players.forEach((pl, i) => {
      const light = this.headLights[i];
      if (!pl.body.length || (!pl.alive && game.status !== 'over')) {
        light.intensity = 0;
        return;
      }
      const pts = game.status === 'over' ? pl.body : slide(pl.body, pl.prevBody, game.alphaFor(pl));
      const color = i === 1 ? COLORS.p2 : this.p1Color();
      const phase = !!pl.effects.phase && pl.alive;
      const ghostSkin = i === 0 && this.skin === 'ghost';
      this.snake(pts, color, 0.34, {
        opacity: pl.alive ? (phase ? 0.4 + 0.15 * Math.sin(t * 8) : 1) : 0.35,
        wire: ghostSkin,
        metal: i === 0 && this.skin === 'gold',
        glow: pl.alive ? 0.22 : 0.05,
      });
      this.head(pts[0], pl.dir, color, pl.alive ? 1 : 0.4, 0.42);
      light.color.setHex(color);
      light.intensity = pl.alive ? (dark ? 14 : 3) : 0;
      light.distance = dark ? 9 : 6;
      light.position.set(wx(pts[0].x), 0.9, wz(pts[0].y));
    });

    if (this.ghost?.length) this.snake(this.ghost, 0xe6f0ff, 0.28, { opacity: 0.18, glow: 0.2 });
    if (game.rival) {
      const r = game.rival;
      const pts = slide(r.body, r.prevBody, game.worldAlpha);
      this.snake(pts, COLORS.rival, 0.3, { opacity: r.stunned > 0 ? 0.5 : 1, glow: 0.2 });
      this.head(pts[0], r.dir, COLORS.rival, 1, 0.36);
    }
    this.drawBoss(game, t);
    this.hideUnused();

    this.drawPickups(game, t);
    this.drawMines(game, t);
    this.drawMice(game, t);
    this.drawStatics(game, t);
    this.drawProjectiles(game);
    this.drawSheds(game);
    this.drawCoil(dt);
    this.drawParticles(dt);
    this.drawShocks(dt);

    this.updateCamera(game, dt);
    this.drawPopups(dt);
    this.drawLabels(game);

    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.cam);
  }

  // ---------------------------------------------------------------- board

  private updateBoard(game: Game) {
    let h = 0;
    const solid = game.solid;
    for (let i = 0; i < solid.length; i++) if (solid[i]) h = (Math.imul(h, 31) + i + 1) | 0;
    const key = `${game.ring}|${h}`;
    if (key !== this.boardKey) {
      this.boardKey = key;
      const m = new THREE.Matrix4();
      let n = 0;
      let r = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!solid[y * W + x]) continue;
          const ring = x < game.ring || y < game.ring || x >= W - game.ring || y >= H - game.ring;
          if (ring) {
            m.makeTranslation(wx(x), 0.25, wz(y));
            this.ringWalls.setMatrixAt(r++, m);
          } else {
            m.makeTranslation(wx(x), 0.45, wz(y));
            this.walls.setMatrixAt(n++, m);
          }
        }
      }
      this.walls.count = n;
      this.ringWalls.count = r;
      this.walls.instanceMatrix.needsUpdate = true;
      this.ringWalls.instanceMatrix.needsUpdate = true;
    }
    const pend = game.pendingMaze ?? [];
    const m = new THREE.Matrix4();
    const s = 0.9 + 0.1 * Math.sin(this.clock / 120);
    pend.forEach((c, i) => {
      m.makeScale(s, s, s).setPosition(wx(c.x), 0.45, wz(c.y));
      this.pending.setMatrixAt(i, m);
    });
    this.pending.count = pend.length;
    this.pending.instanceMatrix.needsUpdate = true;
    (this.frame.material as THREE.LineBasicMaterial).opacity = game.wraps ? 0.25 + 0.2 * Math.sin(this.clock / 300) : 0.6;
  }

  private drawSheds(game: Game) {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const bg = new THREE.Color(COLORS.bg);
    game.shedWalls.forEach((w, i) => {
      const life = w.ttl < 2000 ? w.ttl / 2000 : 1;
      m.makeScale(1, 0.3 + 0.7 * life, 1).setPosition(wx(w.pos.x), 0.22 * (0.3 + 0.7 * life), wz(w.pos.y));
      this.sheds.setMatrixAt(i, m);
      c.setHex(w.owner === 1 ? COLORS.p2 : this.p1Color()).lerp(bg, 1 - life * 0.9);
      this.sheds.setColorAt(i, c);
    });
    this.sheds.count = game.shedWalls.length;
    this.sheds.instanceMatrix.needsUpdate = true;
    if (this.sheds.instanceColor) this.sheds.instanceColor.needsUpdate = true;
  }

  private drawCoil(dt: number) {
    if (!this.coil) {
      this.coilTiles.count = 0;
      return;
    }
    this.coil.life -= dt;
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    this.coil.cells.forEach((c, i) => {
      m.copy(rot).setPosition(wx(c.x), 0.03, wz(c.y));
      this.coilTiles.setMatrixAt(i, m);
    });
    this.coilTiles.count = this.coil.cells.length;
    this.coilTiles.instanceMatrix.needsUpdate = true;
    (this.coilTiles.material as THREE.MeshBasicMaterial).opacity = Math.max(0, this.coil.life / 900) * 0.45;
    if (this.coil.life <= 0) this.coil = null;
  }

  // ---------------------------------------------------------------- bodies

  private snake(pts: Vec[], color: number, radius: number, o: { opacity?: number; wire?: boolean; metal?: boolean; glow?: number }) {
    if (!pts.length) return;
    // Split at wraps/portals.
    const runs: THREE.Vector3[][] = [[]];
    let prev: Vec | null = null;
    for (const p of pts) {
      if (prev && Math.abs(prev.x - p.x) + Math.abs(prev.y - p.y) > 1.5) runs.push([]);
      runs[runs.length - 1].push(new THREE.Vector3(wx(p.x), 0.42, wz(p.y)));
      prev = p;
    }
    for (const run of runs) {
      if (run.length < 2) continue;
      // Taper toward the tail by sinking the last points slightly.
      const curve = new THREE.CatmullRomCurve3(run, false, 'centripetal', 0.5);
      const mesh = this.tubeMesh();
      mesh.geometry.dispose();
      mesh.geometry = new THREE.TubeGeometry(curve, Math.max(6, run.length * 6), radius, 12, false);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(color);
      mat.emissive.setHex(color);
      mat.emissiveIntensity = o.glow ?? 0.5;
      mat.metalness = o.metal ? 0.9 : 0.15;
      mat.roughness = o.metal ? 0.2 : 0.28;
      mat.wireframe = !!o.wire;
      mat.opacity = o.opacity ?? 1;
      mat.transparent = mat.opacity < 1;
      mesh.visible = true;
    }
  }

  private tubeMesh(): THREE.Mesh {
    if (this.tubeUsed >= this.tubes.length) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.15 }));
      m.castShadow = this.quality === 'high';
      this.scene.add(m);
      this.tubes.push(m);
    }
    return this.tubes[this.tubeUsed++];
  }

  private head(p: Vec, dir: Dir, color: number, opacity: number, size: number) {
    if (this.headUsed >= this.heads.length) {
      const g = new THREE.Group();
      const skull = new THREE.Mesh(this.geo.head, new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.15 }));
      skull.name = 'skull';
      skull.castShadow = this.quality === 'high';
      g.add(skull);
      const white = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 });
      const black = new THREE.MeshBasicMaterial({ color: 0x05070d });
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(this.geo.eye, white);
        eye.position.set(0.16 * s, 0.17, 0.27);
        const pupil = new THREE.Mesh(this.geo.pupil, black);
        pupil.position.set(0.16 * s, 0.19, 0.36);
        g.add(eye, pupil);
      }
      this.scene.add(g);
      this.heads.push(g);
    }
    const g = this.heads[this.headUsed++];
    g.visible = true;
    g.position.set(wx(p.x), 0.42, wz(p.y));
    const d = DIRS[dir];
    g.rotation.y = Math.atan2(d.x, d.y);
    g.scale.setScalar(size / 0.42);
    const skull = g.getObjectByName('skull') as THREE.Mesh;
    const mat = skull.material as THREE.MeshStandardMaterial;
    mat.color.setHex(color);
    mat.emissive.setHex(color);
    mat.emissiveIntensity = 0.25;
    mat.opacity = opacity;
    mat.transparent = opacity < 1;
  }

  private hideUnused() {
    for (let i = this.tubeUsed; i < this.tubes.length; i++) this.tubes[i].visible = false;
    for (let i = this.headUsed; i < this.heads.length; i++) this.heads[i].visible = false;
  }

  private drawBoss(game: Game, t: number) {
    const b = game.boss;
    this.queen.visible = !!b && b.kind === 'queen';
    this.crown.visible = !!b && b.kind === 'serpent';
    if (!b) return;
    const hurt = b.invuln > 0 && Math.sin(this.clock / 40) > 0;
    if (b.kind === 'serpent') {
      const pts = slide(b.body, b.prevBody, game.worldAlpha);
      this.snake(pts, hurt ? 0xffffff : COLORS.boss, 0.44, { glow: 0.3 });
      this.head(pts[0], b.dir, hurt ? 0xffffff : COLORS.boss, 1, 0.52);
      this.crown.position.set(wx(pts[0].x), 0.95, wz(pts[0].y));
      this.crown.rotation.y = t;
      return;
    }
    this.queen.position.set(wx(b.core.x + 0.5), 1.1 + Math.sin(t * 2) * 0.12, wz(b.core.y + 0.5));
    const core = this.queen.getObjectByName('core') as THREE.Mesh;
    core.rotation.y = t * 1.3;
    core.rotation.x = t * 0.7;
    (core.material as THREE.MeshStandardMaterial).emissiveIntensity = hurt ? 2 : 0.6;
    const shield = this.queen.getObjectByName('shield') as THREE.Mesh;
    shield.visible = b.shield;
    shield.rotation.y = -t * 0.5;
  }

  // ---------------------------------------------------------------- items

  private material(color: number, glow = 0.8, metal = 0.2) {
    return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: glow, roughness: 0.3, metalness: metal });
  }

  private drawPickups(game: Game, t: number) {
    const seen = new Set<number>();
    for (const pk of game.pickups) {
      if (!this.near(pk.pos)) continue;
      seen.add(pk.id);
      let mesh = this.pickupMeshes.get(pk.id);
      if (!mesh) {
        mesh = this.makePickup(pk.kind);
        this.scene.add(mesh);
        this.pickupMeshes.set(pk.id, mesh);
      }
      const fade = pk.ttl < 2000 ? 0.4 + 0.6 * (pk.ttl / 2000) : 1;
      mesh.position.set(wx(pk.pos.x), 0.45 + Math.sin(t * 3 + pk.id) * 0.08, wz(pk.pos.y));
      mesh.rotation.y = t * 1.5 + pk.id;
      mesh.rotation.x = pk.kind === 'golden' ? t : 0;
      mesh.scale.setScalar(fade);
    }
    for (const [id, mesh] of this.pickupMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.pickupMeshes.delete(id);
      }
    }
  }

  private makePickup(kind: PickupKind): THREE.Object3D {
    switch (kind) {
      case 'food':
        return new THREE.Mesh(this.geo.food, this.material(COLORS.food, 0.7));
      case 'golden':
        return new THREE.Mesh(this.geo.gold, this.material(COLORS.gold, 0.9, 0.8));
      case 'bit':
        return new THREE.Mesh(this.geo.bit, this.material(COLORS.food, 0.8));
      case 'rot':
        return new THREE.Mesh(this.geo.food, this.material(COLORS.rot, 0.1, 0));
      default: {
        const g = new THREE.Group();
        const box = new THREE.Mesh(this.geo.power, this.material(COLORS.power[kind] ?? 0xffffff, 0.7, 0.3));
        box.castShadow = this.quality === 'high';
        g.add(box);
        const label = document.createElement('canvas');
        label.width = label.height = 64;
        const c = label.getContext('2d')!;
        c.fillStyle = '#05070d';
        c.font = '700 44px "Space Grotesk", system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText({ phase: 'P', slowmo: 'S', magnet: 'M', shrink: '-' }[kind as string] ?? '?', 32, 34);
        const tex = new THREE.CanvasTexture(label);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
        sprite.scale.setScalar(0.42);
        sprite.position.y = 0.01;
        g.add(sprite);
        return g;
      }
    }
  }

  private drawMines(game: Game, t: number) {
    const mines = this.big ? game.mines.filter((m) => this.near(m.pos)) : game.mines;
    while (this.mineMeshes.length < mines.length) {
      const g = new THREE.Group();
      const core = new THREE.Mesh(this.geo.mineCore, this.material(COLORS.mine, 0, 0.7));
      core.name = 'core';
      g.add(core);
      for (let i = 0; i < 8; i++) {
        const sp = new THREE.Mesh(this.geo.spike, (core.material as THREE.Material).clone());
        const a = (i / 8) * Math.PI * 2;
        sp.position.set(Math.cos(a) * 0.26, 0, Math.sin(a) * 0.26);
        sp.rotation.z = -Math.PI / 2;
        sp.rotation.y = -a;
        g.add(sp);
      }
      this.scene.add(g);
      this.mineMeshes.push(g);
    }
    this.mineMeshes.forEach((g, i) => {
      const m = mines[i];
      g.visible = !!m;
      if (!m) return;
      const lit = game.mineLit(m);
      const warn = game.mineWarn(m);
      g.position.set(wx(m.pos.x), 0.3, wz(m.pos.y));
      g.rotation.y = t * (lit ? 3 : 0.5);
      g.scale.setScalar(lit ? 1.2 + 0.08 * Math.sin(t * 20) : 1 + warn * 0.15);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          const mat = o.material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(lit || warn > 0 ? COLORS.danger : COLORS.mine);
          mat.emissiveIntensity = lit ? 1.6 : warn * 1.2;
        }
      });
    });
  }

  private drawMice(game: Game, t: number) {
    const seen = new Set<number>();
    for (const m of game.mice) {
      seen.add(m.id);
      let mesh = this.mouseMeshes.get(m.id);
      if (!mesh) {
        mesh = m.drone ? new THREE.Mesh(this.geo.drone, this.material(COLORS.drone, 0.9)) : new THREE.Mesh(this.geo.mouse, this.material(COLORS.mouse, 0.15, 0.1));
        if (!m.drone) mesh.rotation.z = Math.PI / 2;
        this.scene.add(mesh);
        this.mouseMeshes.set(m.id, mesh);
      }
      const jump = Math.abs(m.prev.x - m.pos.x) + Math.abs(m.prev.y - m.pos.y) > 1;
      const a = game.worldAlpha;
      const x = jump ? m.pos.x : lerp(m.prev.x, m.pos.x, a);
      const y = jump ? m.pos.y : lerp(m.prev.y, m.pos.y, a);
      mesh.position.set(wx(x), m.drone ? 0.7 + Math.sin(t * 4 + m.id) * 0.15 : 0.2, wz(y));
      if (m.drone) mesh.rotation.y = t * 4;
      else mesh.rotation.y = Math.atan2(m.pos.x - m.prev.x, m.pos.y - m.prev.y) + Math.PI / 2;
    }
    for (const [id, mesh] of this.mouseMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(mesh);
        this.mouseMeshes.delete(id);
      }
    }
  }

  private drawStatics(game: Game, t: number) {
    const portals = game.arena.portals.flatMap((pair, i) => pair.map((p) => ({ p, i })));
    while (this.portalMeshes.length < portals.length) {
      const m = new THREE.Mesh(this.geo.portal, this.material(COLORS.portalA, 1.2));
      this.scene.add(m);
      this.portalMeshes.push(m);
    }
    this.portalMeshes.forEach((m, k) => {
      const e = portals[k];
      m.visible = !!e;
      if (!e) return;
      ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).color.setHex(e.i ? COLORS.portalB : COLORS.portalA);
      ((m as THREE.Mesh).material as THREE.MeshStandardMaterial).emissive.setHex(e.i ? COLORS.portalB : COLORS.portalA);
      m.position.set(wx(e.p.x), 0.45, wz(e.p.y));
      m.rotation.y = t * (e.i ? -1.5 : 1.5);
    });

    const wells = this.big ? game.wells.filter((w) => this.near(w)) : game.wells;
    while (this.wellMeshes.length < wells.length * 3) {
      const m = new THREE.Mesh(this.geo.well, new THREE.MeshBasicMaterial({ color: COLORS.well, transparent: true, opacity: 0.6 }));
      m.rotation.x = Math.PI / 2;
      this.scene.add(m);
      this.wellMeshes.push(m);
    }
    this.wellMeshes.forEach((m, k) => {
      const w = wells[Math.floor(k / 3)];
      m.visible = !!w;
      if (!w) return;
      const f = (t * 0.8 + (k % 3) / 3) % 1;
      m.position.set(wx(w.x), 0.05 + f * 0.3, wz(w.y));
      m.scale.setScalar(1.6 - f * 1.3);
      ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.2 + f * 0.6;
    });

    const arrows = this.big ? game.arrows.filter((a) => this.near(a.pos)) : game.arrows;
    while (this.arrowMeshes.length < arrows.length) {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.35);
      shape.lineTo(0.28, -0.05);
      shape.lineTo(0.1, -0.05);
      shape.lineTo(0.1, -0.32);
      shape.lineTo(-0.1, -0.32);
      shape.lineTo(-0.1, -0.05);
      shape.lineTo(-0.28, -0.05);
      shape.closePath();
      const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: COLORS.arrow, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      this.scene.add(m);
      this.arrowMeshes.push(m);
    }
    this.arrowMeshes.forEach((m, k) => {
      const a = arrows[k];
      m.visible = !!a;
      if (!a) return;
      m.position.set(wx(a.pos.x), 0.04, wz(a.pos.y));
      const d = DIRS[a.dir];
      m.rotation.z = Math.atan2(-d.x, -d.y) + Math.PI;
      ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(t * 4);
    });
  }

  private drawProjectiles(game: Game) {
    while (this.projectileMeshes.length < game.projectiles.length) {
      const m = new THREE.Mesh(this.geo.projectile, this.material(COLORS.spit, 1.5));
      this.scene.add(m);
      this.projectileMeshes.push(m);
    }
    const a = game.worldAlpha;
    this.projectileMeshes.forEach((m, i) => {
      const pr = game.projectiles[i];
      m.visible = !!pr;
      if (!pr) return;
      const jump = Math.abs(pr.prev.x - pr.pos.x) + Math.abs(pr.prev.y - pr.pos.y) > 2;
      m.position.set(wx(jump ? pr.pos.x : lerp(pr.prev.x, pr.pos.x, a)), 0.5, wz(jump ? pr.pos.y : lerp(pr.prev.y, pr.pos.y, a)));
    });
  }

  // ---------------------------------------------------------------- fx

  private drawParticles(dt: number) {
    const s = dt / 1000;
    let n = 0;
    const keep: Burst[] = [];
    for (const b of this.bursts) {
      b.life -= dt;
      if (b.life <= 0) continue;
      b.vy -= 7 * s;
      b.x += b.vx * s;
      b.y = Math.max(0.05, b.y + b.vy * s);
      b.z += b.vz * s;
      b.vx *= 0.97;
      b.vz *= 0.97;
      const f = b.life / b.max;
      this.pointPos[n * 3] = b.x;
      this.pointPos[n * 3 + 1] = b.y;
      this.pointPos[n * 3 + 2] = b.z;
      this.pointCol[n * 3] = b.r * f;
      this.pointCol[n * 3 + 1] = b.g * f;
      this.pointCol[n * 3 + 2] = b.b * f;
      n++;
      keep.push(b);
    }
    this.bursts = keep;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  private drawShocks(dt: number) {
    this.shocks = this.shocks.filter((s) => {
      s.life -= dt;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        (s.mesh.material as THREE.Material).dispose();
        return false;
      }
      const f = 1 - s.life / s.max;
      s.mesh.scale.setScalar(0.2 + f * s.radius);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - f) * 0.9;
      return true;
    });
  }

  private updateCamera(game: Game, dt: number) {
    const aspect = this.width / this.height;
    // Pull back far enough to see the whole arena on narrow screens.
    const fit = aspect < 1 ? 1 / aspect : 1;
    let height = 22 * Math.min(1.9, fit * 0.95 + 0.05);
    let back = 15 * Math.min(1.9, fit * 0.95 + 0.05);
    const head = game.players.find((p) => p.alive)?.body[0] ?? game.p0.body[0];
    const k = 1 - Math.pow(0.04, dt / 1000);
    // Small arenas lean a little toward the head; big boards follow it, looking slightly ahead.
    const follow = this.big ? 1 : 0.3;
    const lead = this.big && head ? DIRS[game.p0.dir] : { x: 0, y: 0 };
    let tx = head ? wx(head.x + lead.x * 2) * follow : 0;
    let tz = head ? wz(head.y + lead.y * 2) * follow : 0;
    const len = game.p0.body.length;
    height += Math.min(6, len * 0.08);
    back += Math.min(4, len * 0.05);
    if (game.boss) {
      height += 2;
      back += 1.5;
    }
    if (this.camera) {
      // Instant replay: swoop toward the focus and orbit slowly.
      const z = this.camera.zoom;
      tx = wx(this.camera.x);
      tz = wz(this.camera.y);
      height /= z * 1.4;
      back /= z * 1.2;
      this.orbit += dt / 6000;
    } else this.orbit *= 0.95;
    this.target.x += (tx - this.target.x) * k * 2;
    this.target.z += (tz - this.target.z) * k * 2;
    const ox = Math.sin(this.orbit) * back;
    const oz = Math.cos(this.orbit) * back;
    const want = new THREE.Vector3(this.target.x + ox, height, this.target.z + oz);
    this.cam.position.lerp(want, Math.min(1, k * 3));
    if (this.shake > 0) {
      this.cam.position.x += (Math.random() - 0.5) * this.shake;
      this.cam.position.y += (Math.random() - 0.5) * this.shake;
    }
    this.cam.lookAt(this.target.x, 0, this.target.z);
    if (this.big) {
      // The shadow camera only covers +-15 cells, so the key light travels with the view.
      this.keyLight.position.set(this.target.x + 8, 22, this.target.z + 10);
      this.keyLight.target.position.set(this.target.x, 0, this.target.z);
      this.keyLight.target.updateMatrixWorld();
    }
  }

  private project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.cam);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height, visible: v.z < 1 };
  }

  private drawPopups(dt: number) {
    this.popups = this.popups.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) {
        p.el.remove();
        return false;
      }
      p.y += (dt / 1000) * 1.1;
      const s = this.project(p.x, p.y, p.z);
      p.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
      p.el.style.opacity = String(Math.min(1, (p.life / p.max) * 2.5));
      return true;
    });
  }

  private drawLabels(game: Game) {
    const want = game.players.length > 1 ? game.players.length : 0;
    while (this.labels.length < want) {
      const el = document.createElement('div');
      el.className = 'pop3d tag';
      this.overlay.appendChild(el);
      this.labels.push(el);
    }
    this.labels.forEach((el, i) => {
      const pl = game.players[i];
      if (i >= want || !pl?.alive || !pl.body.length) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.textContent = `P${i + 1}`;
      el.style.color = i ? '#ff4fa3' : '#38e1ff';
      const s = this.project(wx(pl.body[0].x), 1.3, wz(pl.body[0].y));
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
    });
  }
}

/** Glowing grid lines for the floor: `cells` squares per tile, repeated `repeat` times. */
function gridTexture(cells: number, repeat: number): THREE.CanvasTexture {
  const grid = document.createElement('canvas');
  grid.width = grid.height = 512;
  const g2 = grid.getContext('2d')!;
  g2.fillStyle = '#000';
  g2.fillRect(0, 0, 512, 512);
  g2.strokeStyle = COLORS.grid;
  g2.lineWidth = 2;
  for (let i = 0; i <= cells; i++) {
    const p = (i / cells) * 512;
    g2.beginPath();
    g2.moveTo(p, 0);
    g2.lineTo(p, 512);
    g2.moveTo(0, p);
    g2.lineTo(512, p);
    g2.stroke();
  }
  const tex = new THREE.CanvasTexture(grid);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat !== 1) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    tex.anisotropy = 4;
  }
  return tex;
}

/** Is WebGL usable here? */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
