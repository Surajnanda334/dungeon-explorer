// =============================================================================
// DUNGEON EXPLORER: INFINITE DESCENT
// Vanilla JS + Canvas 2D — no external libraries
// =============================================================================

'use strict';

// =============================================================================
// 1. CONSTANTS & CONFIG
// =============================================================================
const CANVAS_W = 1280;
const CANVAS_H = 720;
const TILE     = 48;

const COLORS = {
  player  : '#00ffff',
  goblin  : '#88ff44',
  ogre    : '#ff4400',
  archer  : '#ffee44',
  wraith  : '#cc44ff',
  bullet  : '#ffffff',
  heal    : '#ff4488',
  ammo    : '#44aaff',
  armor   : '#88aaff',
  floor1  : '#12121f',
  floor2  : '#14142a',
  wall    : '#0a1520',
  corridor: '#0f0f22',
};

const WEAPON_DEFS = {
  PISTOL  : { name:'Pistol',   damage:18, fireRate:0.28, bulletSpeed:520, ammoMax:30,  pellets:1, spread:0.04, color:'#00ffff',  range:600, knockback:80  },
  SHOTGUN : { name:'Shotgun',  damage:14, fireRate:0.85, bulletSpeed:380, ammoMax:8,   pellets:6, spread:0.32, color:'#ff8800',  range:320, knockback:160 },
  SMG     : { name:'SMG',      damage:9,  fireRate:0.09, bulletSpeed:620, ammoMax:60,  pellets:1, spread:0.12, color:'#00ff88',  range:500, knockback:40  },
  MELEE   : { name:'Blade',    damage:35, fireRate:0.55, bulletSpeed:0,   ammoMax:999, pellets:0, spread:0,    color:'#ffffff',  range:58,  knockback:200 },
};

const ENEMY_DEFS = {
  GOBLIN  : { hp:40,  dmg:8,  spd:105, radius:14, detect:185, color:COLORS.goblin,  xp:10 },
  OGRE    : { hp:220, dmg:28, spd:55,  radius:28, detect:225, color:COLORS.ogre,    xp:40 },
  ARCHER  : { hp:65,  dmg:14, spd:72,  radius:15, detect:260, color:COLORS.archer,  xp:20 },
  WRAITH  : { hp:85,  dmg:16, spd:115, radius:16, detect:210, color:COLORS.wraith,  xp:30 },
};

const TILE_VOID   = 0;
const TILE_FLOOR  = 1;
const TILE_WALL   = 2;
const TILE_CORR   = 3;

// Perk definitions for super chest selection
const PERK_DEFS = {
  DMG      : { name:'+8% DAMAGE',    color:'#ff4400', icon:'D+' },
  CRIT     : { name:'+5% CRIT',      color:'#ffaa00', icon:'CR' },
  FIRERATE : { name:'+10% FIRERATE', color:'#00ffff', icon:'FR' },
  MAXHP    : { name:'+12% MAX HP',   color:'#ff4488', icon:'HP' },
  RESIST   : { name:'+10% RESIST',   color:'#4488ff', icon:'RS' },
  POTION   : { name:'+1 POTION',     color:'#ff88ff', icon:'PT' },
  LIFESTEAL: { name:'5% LIFESTEAL',  color:'#ff0066', icon:'LS' },
  SPEED    : { name:'+8% SPEED',     color:'#ffff00', icon:'SP' },
  DASHCD   : { name:'-10% DASH CD',  color:'#00ff88', icon:'DC' },
  RELOAD   : { name:'+10% RELOAD',   color:'#88ff00', icon:'RL' },
};

const ROOM_SPAWN  = 'spawn';
const ROOM_EXIT   = 'exit';
const ROOM_COMBAT = 'combat';
const ROOM_LOOT   = 'loot';
const ROOM_BOSS   = 'boss';

// =============================================================================
// 2. SEEDED PRNG — Mulberry32
// =============================================================================
class RNG {
  constructor(seed) { this.s = (seed >>> 0) || 1; }

  next() {
    let t = this.s += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(a, b)  { return a + this.next() * (b - a); }
  int(a, b)    { return Math.floor(this.range(a, b)); }
  pick(arr)    { return arr[this.int(0, arr.length)]; }
  bool(p = 0.5){ return this.next() < p; }
}

// =============================================================================
// 3. MATH UTILITIES
// =============================================================================
const lerp    = (a, b, t) => a + (b - a) * t;
const clamp   = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const dist2   = (ax, ay, bx, by) => { const dx=ax-bx, dy=ay-by; return Math.sqrt(dx*dx+dy*dy); };
const dist2sq = (ax, ay, bx, by) => { const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; };
const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
const vecNorm = (vx, vy) => { const l=Math.sqrt(vx*vx+vy*vy)||1; return [vx/l, vy/l]; };
const rndSign = () => Math.random() < 0.5 ? 1 : -1;

function circleRect(cx, cy, cr, rx, ry, rw, rh) {
  const nearX = clamp(cx, rx, rx + rw);
  const nearY = clamp(cy, ry, ry + rh);
  const dx = cx - nearX, dy = cy - nearY;
  return dx * dx + dy * dy < cr * cr;
}

function lineOfSight(x0, y0, x1, y1, map, mapW) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return true;
  const sx = dx / steps, sy = dy / steps;
  for (let i = 1; i < steps; i++) {
    const tx = Math.floor(x0 + sx * i);
    const ty = Math.floor(y0 + sy * i);
    const t = map[ty * mapW + tx];
    if (t === TILE_WALL || t === TILE_VOID) return false;
  }
  return true;
}

// =============================================================================
// 4. INPUT HANDLER
// =============================================================================
class InputHandler {
  constructor(canvas) {
    this.keys  = {};
    this.mouse = { x: CANVAS_W / 2, y: CANVAS_H / 2, down: false, rightDown: false, wheel: 0 };
    this._justPressed  = {};
    this._justReleased = {};
    this._lastWheelTime = 0;

    window.addEventListener('keydown', e => {
      if (!this.keys[e.code]) this._justPressed[e.code] = true;
      this.keys[e.code] = true;
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
      this._justReleased[e.code] = true;
    });
    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      const scaleX = CANVAS_W / r.width;
      const scaleY = CANVAS_H / r.height;
      this.mouse.x = (e.clientX - r.left) * scaleX;
      this.mouse.y = (e.clientY - r.top)  * scaleY;
    });
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.mouse.rightDown = true;
    });
    canvas.addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rightDown = false;
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const now = performance.now();
      if (now - this._lastWheelTime < 150) return;
      this.mouse.wheel = Math.sign(e.deltaY);
      this._lastWheelTime = now;
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  isDown(code)     { return !!this.keys[code]; }
  justPressed(code){ const v = !!this._justPressed[code]; this._justPressed[code] = false; return v; }
  
  getWheel() {
    const w = this.mouse.wheel;
    this.mouse.wheel = 0;
    return w;
  }

  flush()          { this._justPressed = {}; this._justReleased = {}; this.mouse.wheel = 0; }

  get moveX() {
    return (this.isDown('KeyD') || this.isDown('ArrowRight') ? 1 : 0)
         - (this.isDown('KeyA') || this.isDown('ArrowLeft')  ? 1 : 0);
  }
  get moveY() {
    return (this.isDown('KeyS') || this.isDown('ArrowDown')  ? 1 : 0)
         - (this.isDown('KeyW') || this.isDown('ArrowUp')    ? 1 : 0);
  }
}

// =============================================================================
// 5. OBJECT POOL
// =============================================================================
class Pool {
  constructor(factory, reset, initialSize = 0) {
    this._factory = factory;
    this._reset   = reset;
    this._pool    = [];
    for (let i = 0; i < initialSize; i++) this._pool.push(factory());
  }
  get()    { return this._pool.length ? this._pool.pop() : this._factory(); }
  free(obj){ this._reset(obj); this._pool.push(obj); }
}

// =============================================================================
// 6. SPATIAL GRID
// =============================================================================
class SpatialGrid {
  constructor(cellSize) {
    this.cs    = cellSize;
    this.cells = new Map();
  }
  _key(gx, gy) { return (gx & 0xffff) | ((gy & 0xffff) << 16); }
  _cell(x, y)  { return this._key((x / this.cs) | 0, (y / this.cs) | 0); }

  insert(obj, x, y, r) {
    const x0 = ((x - r) / this.cs) | 0;
    const y0 = ((y - r) / this.cs) | 0;
    const x1 = ((x + r) / this.cs) | 0;
    const y1 = ((y + r) / this.cs) | 0;
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const k = this._key(gx, gy);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(obj);
      }
    }
  }

  query(x, y, r) {
    const x0 = ((x - r) / this.cs) | 0;
    const y0 = ((y - r) / this.cs) | 0;
    const x1 = ((x + r) / this.cs) | 0;
    const y1 = ((y + r) / this.cs) | 0;
    const seen = new Set();
    const out  = [];
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const cell = this.cells.get(this._key(gx, gy));
        if (!cell) continue;
        for (const obj of cell) {
          if (!seen.has(obj)) { seen.add(obj); out.push(obj); }
        }
      }
    }
    return out;
  }

  clear() { this.cells.clear(); }
}

// =============================================================================
// 7. CAMERA
// =============================================================================
class Camera {
  constructor() {
    this.x = 0; this.y = 0;
    this.tx = 0; this.ty = 0;
    this.shakeAmt = 0; this.shakeDur = 0; this.shakeTimer = 0;
    this._ox = 0; this._oy = 0;
  }

  follow(target, dt) {
    this.tx = target.x - CANVAS_W / 2;
    this.ty = target.y - CANVAS_H / 2;
    const spd = 1 - Math.pow(0.005, dt);
    this.x = lerp(this.x, this.tx, spd);
    this.y = lerp(this.y, this.ty, spd);

    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      const f = (this.shakeTimer / this.shakeDur);
      this._ox = (Math.random() * 2 - 1) * this.shakeAmt * f;
      this._oy = (Math.random() * 2 - 1) * this.shakeAmt * f;
    } else {
      this._ox = 0; this._oy = 0;
    }
  }

  shake(amt, dur) {
    if (amt > this.shakeAmt || this.shakeTimer <= 0) {
      this.shakeAmt = amt; this.shakeDur = dur; this.shakeTimer = dur;
    }
  }

  apply(ctx) {
    ctx.save();
    ctx.translate(
      Math.round(-this.x + this._ox),
      Math.round(-this.y + this._oy)
    );
  }

  restore(ctx) { ctx.restore(); }

  toWorld(sx, sy) { return { x: sx + this.x - this._ox, y: sy + this.y - this._oy }; }
  toScreen(wx, wy){ return { x: wx - this.x + this._ox, y: wy - this.y + this._oy }; }
}

// =============================================================================
// 8. PARTICLE SYSTEM
// =============================================================================
class Particle {
  constructor() {
    this.alive = false;
    this.x = 0; this.y = 0; this.px = 0; this.py = 0;
    this.vx = 0; this.vy = 0;
    this.life = 0; this.maxLife = 1;
    this.size = 3; this.color = '#fff';
    this.alpha = 1; this.drag = 0.92; this.gravity = 0;
    this.type = 'dot'; // dot | spark | blood | glow | shell
    this.rot = 0; this.rotSpd = 0;
  }
}

class ParticleSystem {
  constructor(maxCount = 2000) {
    this.particles = Array.from({ length: maxCount }, () => new Particle());
    this._idx = 0;
  }

  emit(x, y, vx, vy, opts = {}) {
    // Cycle through array to find a slot (fast, no GC)
    const max = this.particles.length;
    let p = null;
    for (let i = 0; i < max; i++) {
      const candidate = this.particles[(this._idx + i) % max];
      if (!candidate.alive) { p = candidate; this._idx = (this._idx + i + 1) % max; break; }
    }
    if (!p) { p = this.particles[this._idx % max]; this._idx = (this._idx + 1) % max; }

    p.alive   = true;
    p.x = p.px = x; p.y = p.py = y;
    p.vx      = vx || 0; p.vy = vy || 0;
    p.life    = p.maxLife = opts.life   || 0.6;
    p.size    = opts.size   || 3;
    p.color   = opts.color  || '#fff';
    p.alpha   = opts.alpha  || 1;
    p.drag    = opts.drag   !== undefined ? opts.drag : 0.88;
    p.gravity = opts.gravity || 0;
    p.type    = opts.type   || 'dot';
    p.rot     = opts.rot    || 0;
    p.rotSpd  = opts.rotSpd || 0;
    return p;
  }

  burst(x, y, count, opts = {}) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd   = (opts.speed || 120) * (0.4 + Math.random() * 0.6);
      this.emit(x, y, Math.cos(angle) * spd, Math.sin(angle) * spd, opts);
    }
  }

  cone(x, y, angle, spread, count, opts = {}) {
    for (let i = 0; i < count; i++) {
      const a   = angle + (Math.random() - 0.5) * spread;
      const spd = (opts.speed || 150) * (0.5 + Math.random() * 0.5);
      this.emit(x, y, Math.cos(a) * spd, Math.sin(a) * spd, opts);
    }
  }

  update(dt) {
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) { p.alive = false; continue; }
      p.px = p.x; p.py = p.y;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.vy += p.gravity * dt;
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.rot += p.rotSpd * dt;
    }
  }

  draw(ctx) {
    const alive = this.particles.filter(p => p.alive);
    if (!alive.length) return;

    ctx.save();
    for (const p of alive) {
      const t   = p.life / p.maxLife;
      const alpha = p.alpha * t;
      if (alpha <= 0.01) continue;

      ctx.globalAlpha = alpha;

      switch (p.type) {
        case 'spark': {
          ctx.strokeStyle = p.color;
          ctx.lineWidth   = p.size * 0.5;
          ctx.beginPath();
          ctx.moveTo(p.px, p.py);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          break;
        }
        case 'blood': {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.4 + t * 0.6), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'glow': {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
          g.addColorStop(0, p.color);
          g.addColorStop(1, 'transparent');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'shell': {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = '#ddaa44';
          ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8);
          ctx.restore();
          break;
        }
        default: { // dot
          ctx.fillStyle = p.color;
          ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// =============================================================================
// 11b. CRATE
// =============================================================================
class Crate {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.hp = 30;
    this.maxHp = 30;
    this.alive = true;
    this.radius = 20;
    this.shake = 0;
    this.hitFlash = 0;
  }

  takeDamage(amount, game) {
    this.hp -= amount;
    this.shake = 0.2;
    this.hitFlash = 0.15;
    
    // Wood debris
    game.particles.burst(this.x, this.y, 5, { 
      color: '#8b5a2b', type: 'dot', speed: 80, life: 0.4, size: 4, drag: 0.85 
    });

    if (this.hp <= 0) this._break(game);
  }

  _break(game) {
    this.alive = false;
    game.camera.shake(3, 0.15);
    // Wood burst
    game.particles.burst(this.x, this.y, 15, { color: '#8b5a2b', type: 'dot', speed: 120, life: 0.6, size: 5, drag: 0.88 });
    // Gold sparkle indicating rarity
    game.particles.burst(this.x, this.y, 18, { color: '#ffcc44', type: 'glow', speed: 100, life: 0.7, size: 7 });

    // Reward table
    const roll = Math.random();
    let count;
    if (roll < 0.25)       count = -1; // high-tier single reward
    else if (roll < 0.65)  count = 2;
    else if (roll < 0.90)  count = 3;
    else                   count = 4;

    if (count === -1) {
      const item = this._highTierReward(game);
      if (item) game.dungeon.items.push(item);
    } else {
      for (let i = 0; i < count; i++) {
        const item = this._basicReward(game, i);
        if (item) game.dungeon.items.push(item);
      }
    }
  }

  _highTierReward(game) {
    const r = Math.random();
    if (r < 0.18) {
      // Full ammo current weapon
      const w = game.player.weapon;
      if (w.pellets > 0) w.ammo = w.ammoMax;
      game.floatingTexts.push(new FloatingText(this.x, this.y - 24, 'FULL AMMO!', '#44aaff'));
      return null;
    } else if (r < 0.36) {
      // 25% max HP heal
      const heal = Math.round(game.player.maxHp * 0.25);
      game.player.hp = Math.min(game.player.maxHp, game.player.hp + heal);
      game.floatingTexts.push(new FloatingText(this.x, this.y - 24, '+' + heal + ' HP', '#ff4488'));
      return null;
    } else if (r < 0.52) {
      // Full armor
      game.player.armor = game.player.maxArmor;
      game.floatingTexts.push(new FloatingText(this.x, this.y - 24, 'FULL ARMOR!', '#8888ff'));
      return null;
    } else if (r < 0.66) {
      return new Item('BUFF_DMG', this.x, this.y, { duration: 15 });
    } else if (r < 0.80) {
      return new Item('BUFF_SPD', this.x, this.y, { duration: 12 });
    } else {
      // 1-hit shield
      game.player.hitShield = true;
      game.floatingTexts.push(new FloatingText(this.x, this.y - 24, 'SHIELD UP!', '#00ffff'));
      return null;
    }
  }

  _basicReward(game, idx) {
    const spread = (Math.random() - 0.5) * 36;
    const r = Math.random();
    if (r < 0.40) {
      const aTypes = ['PISTOL', 'SHOTGUN', 'SMG'];
      const ammoType = game.rng.pick(aTypes);
      const ammoAmount = ammoType === 'SHOTGUN' ? 4 : ammoType === 'SMG' ? 30 : 15;
      return new Item('AMMO', this.x + spread, this.y + spread, { ammoType, ammoAmount });
    } else if (r < 0.65) {
      return new Item('POTION', this.x + spread, this.y + spread);
    } else if (r < 0.85) {
      return new Item(Math.random() < 0.5 ? 'BUFF_DMG' : 'BUFF_SPD', this.x, this.y);
    } else {
      return new Item('ARMOR', this.x + spread, this.y + spread);
    }
  }

  update(dt) {
    this.shake = Math.max(0, this.shake - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
  }

  draw(ctx) {
    const sx = this.shake > 0 ? (Math.random() - 0.5) * 6 : 0;
    const sy = this.shake > 0 ? (Math.random() - 0.5) * 6 : 0;

    ctx.save();
    ctx.translate(this.x + sx, this.y + sy);

    // Gold rarity glow
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.12 + Math.sin(Date.now() * 0.003) * 0.06;
    const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 38);
    rg.addColorStop(0, '#ffcc44'); rg.addColorStop(1, 'transparent');
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(0, 0, 38, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 16, 22, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Box body
    const color = this.hitFlash > 0 ? '#ffaaaa' : '#8b5a2b';
    ctx.fillStyle = color;
    ctx.fillRect(-20, -20, 40, 40);
    
    // Details
    ctx.strokeStyle = '#5d3a1a';
    ctx.lineWidth = 2;
    ctx.strokeRect(-20, -20, 40, 40);
    ctx.beginPath();
    ctx.moveTo(-20, -20); ctx.lineTo(20, 20);
    ctx.moveTo(20, -20); ctx.lineTo(-20, 20);
    ctx.stroke();

    // Cracks if low HP
    if (this.hp < this.maxHp * 0.5) {
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-10, -5); ctx.lineTo(-15, 5); ctx.lineTo(-8, 12);
      ctx.moveTo(12, -12); ctx.lineTo(5, -5); ctx.lineTo(15, 8);
      ctx.stroke();
    }

    ctx.restore();
  }
}

// =============================================================================
// 9. DUNGEON GENERATOR — BSP Tree
// =============================================================================
class BSPNode {
  constructor(x, y, w, h) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.left = null; this.right = null;
    this.room = null;
  }
}

class DungeonGenerator {
  constructor(rng, level) {
    this.rng   = rng;
    this.level = level;
    // Map size grows slightly with level
    this.mapW  = 48 + Math.min(Math.floor(level / 3) * 4, 32);
    this.mapH  = 36 + Math.min(Math.floor(level / 3) * 3, 24);
  }

  generate() {
    const { mapW, mapH } = this;
    const map = new Uint8Array(mapW * mapH); // all VOID

    // BSP split
    const root = new BSPNode(1, 1, mapW - 2, mapH - 2);
    const depth = 4 + Math.min(Math.floor(this.level / 5), 3);
    this._split(root, depth);

    // Collect leaf rooms
    const rooms = [];
    this._collectRooms(root, rooms);

    // Carve rooms into map
    for (const room of rooms) {
      this._carveRoom(map, mapW, room);
    }

    // Connect sibling pairs with corridors
    this._connectNode(root, map, mapW);

    // Fill walls around floor tiles
    this._buildWalls(map, mapW, mapH);

    // Tag rooms
    this._tagRooms(rooms);

    // Place torches, obstacles
    for (const room of rooms) {
      this._placeRoomContent(room, map, mapW);
    }

    return {
      map, mapW, mapH,
      rooms,
      torches : rooms.flatMap(r => r.torches),
      crates  : rooms.flatMap(r => r.crates),
      items   : [],
      decals  : [],
      spawnRoom: rooms.find(r => r.type === ROOM_SPAWN),
      exitRoom : rooms.find(r => r.type === ROOM_EXIT),
    };
  }

  _split(node, depth) {
    if (depth === 0 || node.w < 14 || node.h < 12) return;
    const horizontal = node.h > node.w ? true : node.w > node.h ? false : this.rng.bool();

    if (horizontal) {
      const split = this.rng.int(6, node.h - 6);
      node.left  = new BSPNode(node.x, node.y, node.w, split);
      node.right = new BSPNode(node.x, node.y + split, node.w, node.h - split);
    } else {
      const split = this.rng.int(6, node.w - 6);
      node.left  = new BSPNode(node.x, node.y, split, node.h);
      node.right = new BSPNode(node.x + split, node.y, node.w - split, node.h);
    }
    this._split(node.left,  depth - 1);
    this._split(node.right, depth - 1);
  }

  _collectRooms(node, out) {
    if (!node.left && !node.right) {
      // Create room within this partition (leave 1-2 tile border)
      const margin = 2;
      const x = node.x + margin;
      const y = node.y + margin;
      const w = Math.max(6, Math.min(node.w - margin * 2, this.rng.int(6, Math.min(14, node.w - margin))));
      const h = Math.max(5, Math.min(node.h - margin * 2, this.rng.int(5, Math.min(11, node.h - margin))));
      const room = {
        id: out.length,
        type: ROOM_COMBAT,
        x, y, w, h,
        cx: x + (w >> 1),
        cy: y + (h >> 1),
        torches: [],
        obstacles: [],
        crates: [],
        enemies: [],
        connected: [],
      };
      node.room = room;
      out.push(room);
      return;
    }
    if (node.left)  this._collectRooms(node.left, out);
    if (node.right) this._collectRooms(node.right, out);
  }

  _carveRoom(map, mapW, room) {
    for (let dy = 0; dy < room.h; dy++) {
      for (let dx = 0; dx < room.w; dx++) {
        map[(room.y + dy) * mapW + (room.x + dx)] = TILE_FLOOR;
      }
    }
  }

  _connectNode(node, map, mapW) {
    if (!node.left || !node.right) return;
    this._connectNode(node.left, map, mapW);
    this._connectNode(node.right, map, mapW);

    const rA = this._getLeafRoom(node.left);
    const rB = this._getLeafRoom(node.right);
    if (rA && rB) {
      this._carveCorridor(map, mapW, rA, rB);
      rA.connected.push(rB.id);
      rB.connected.push(rA.id);
    }
  }

  _getLeafRoom(node) {
    if (!node) return null;
    if (node.room) return node.room;
    return this._getLeafRoom(node.left) || this._getLeafRoom(node.right);
  }

  _carveCorridor(map, mapW, rA, rB) {
    let x = rA.cx, y = rA.cy;
    const tx = rB.cx, ty = rB.cy;
    // L-shaped corridor
    if (this.rng.bool()) {
      this._carveHLine(map, mapW, x, tx, y);
      this._carveVLine(map, mapW, y, ty, tx);
    } else {
      this._carveVLine(map, mapW, y, ty, x);
      this._carveHLine(map, mapW, x, tx, ty);
    }
  }

  _carveHLine(map, mapW, x0, x1, y) {
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    for (let x = lo; x <= hi; x++) {
      if (map[y * mapW + x] === TILE_VOID) map[y * mapW + x] = TILE_CORR;
      if (map[(y-1) * mapW + x] === TILE_VOID) map[(y-1) * mapW + x] = TILE_CORR;
    }
  }

  _carveVLine(map, mapW, y0, y1, x) {
    const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    for (let y = lo; y <= hi; y++) {
      if (map[y * mapW + x] === TILE_VOID) map[y * mapW + x] = TILE_CORR;
      if (map[y * mapW + (x+1)] === TILE_VOID) map[y * mapW + (x+1)] = TILE_CORR;
    }
  }

  _buildWalls(map, mapW, mapH) {
    const copy = map.slice();
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        if (copy[y * mapW + x] !== TILE_VOID) continue;
        // If adjacent to floor/corridor → make wall
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= mapW || ny >= mapH) continue;
            const t = copy[ny * mapW + nx];
            if (t === TILE_FLOOR || t === TILE_CORR) {
              map[y * mapW + x] = TILE_WALL;
            }
          }
        }
      }
    }
  }

  _tagRooms(rooms) {
    if (!rooms.length) return;
    // BFS from room 0 to find distances
    const dist = new Array(rooms.length).fill(Infinity);
    const idMap = new Map(rooms.map(r => [r.id, r]));
    dist[0] = 0;
    const queue = [rooms[0]];
    while (queue.length) {
      const cur = queue.shift();
      for (const nid of cur.connected) {
        const n = idMap.get(nid);
        if (n && dist[n.id] === Infinity) {
          dist[n.id] = dist[cur.id] + 1;
          queue.push(n);
        }
      }
    }

    let maxDist = 0, maxRoom = rooms[0];
    rooms.forEach((r, i) => { if (dist[i] > maxDist) { maxDist = dist[i]; maxRoom = r; } });

    rooms[0].type   = ROOM_SPAWN;
    maxRoom.type    = ROOM_EXIT;

    // Tag loot/boss rooms
    rooms.forEach((r, i) => {
      if (r.type !== ROOM_COMBAT) return;
      const d = dist[i];
      if (d === Infinity) return;
      if (i % 5 === 3) r.type = ROOM_BOSS;
      else if (i % 5 === 1) r.type = ROOM_LOOT;
    });
  }

  _placeRoomContent(room, map, mapW) {
    const rng = this.rng;

    // Torches at corners (if floor tile)
    const corners = [
      { x: room.x + 1,          y: room.y + 1          },
      { x: room.x + room.w - 2, y: room.y + 1          },
      { x: room.x + 1,          y: room.y + room.h - 2 },
      { x: room.x + room.w - 2, y: room.y + room.h - 2 },
    ];
    for (const c of corners) {
      if (rng.bool(0.7)) {
        room.torches.push({
          x: c.x * TILE + TILE / 2,
          y: c.y * TILE + TILE / 2,
          flicker: rng.range(0.8, 1.2),
          offset: rng.range(0, Math.PI * 2),
          radius: rng.range(70, 110),
        });
      }
    }

    // Obstacles (pillars) — skip spawn room
    if (room.type !== ROOM_SPAWN && room.type !== ROOM_EXIT) {
      const count = rng.int(0, 3);
      for (let i = 0; i < count; i++) {
        const ox = rng.int(room.x + 2, room.x + room.w - 2);
        const oy = rng.int(room.y + 2, room.y + room.h - 2);
        // Don't block center
        if (Math.abs(ox - room.cx) < 2 && Math.abs(oy - room.cy) < 2) continue;
        map[oy * mapW + ox] = TILE_WALL;
        room.obstacles.push({ x: ox, y: oy });
      }
    }

    // Crates — rare (20% per room, max 1, never in boss or spawn rooms)
    if (room.type !== ROOM_SPAWN && room.type !== ROOM_BOSS && rng.bool(0.20)) {
      const cx = rng.int(room.x + 1, room.x + room.w - 1);
      const cy = rng.int(room.y + 1, room.y + room.h - 1);
      if (map[cy * mapW + cx] === TILE_FLOOR) {
        room.crates.push(new Crate(cx * TILE + TILE / 2, cy * TILE + TILE / 2));
      }
    }

    // Enemy types per room type
    const types = Object.keys(ENEMY_DEFS);
    let pool = [];
    switch (room.type) {
      case ROOM_SPAWN: break;
      case ROOM_EXIT:  break;
      case ROOM_LOOT:  pool = [rng.pick(['GOBLIN']), rng.pick(['ARCHER'])]; break;
      case ROOM_BOSS:  pool = ['OGRE', rng.pick(types), rng.pick(types)]; break;
      default: {
        const n = 2 + Math.floor(this.level / 2) + rng.int(0, 3);
        for (let i = 0; i < n; i++) pool.push(rng.pick(types));
      }
    }

    // Place enemies at random floor positions within room
    for (const type of pool) {
      let ex, ey, tries = 0;
      do {
        ex = rng.int(room.x + 1, room.x + room.w - 1);
        ey = rng.int(room.y + 1, room.y + room.h - 1);
        tries++;
      } while (map[ey * mapW + ex] !== TILE_FLOOR && tries < 20);
      if (tries < 20) room.enemies.push({ type, tx: ex * TILE + TILE / 2, ty: ey * TILE + TILE / 2 });
    }
  }
}


// =============================================================================
// 10. PROJECTILE
// =============================================================================
class Projectile {
  constructor() {
    this.alive = false;
    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.damage = 0; this.life = 0;
    this.color = '#fff'; this.owner = null;
    this.radius = 4;
  }

  fire(x, y, vx, vy, damage, color, owner, range) {
    this.alive  = true;
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.damage = damage;
    this.color  = color;
    this.owner  = owner;
    this.radius = 4;
    const spd = Math.sqrt(vx * vx + vy * vy) || 1;
    this.life = (range || 500) / spd;
    this.maxLife = this.life;
  }

  update(dt, map, mapW, particles) {
    if (!this.alive) return;
    this.life -= dt;
    if (this.life <= 0) { this.alive = false; return; }

    const nx = this.x + this.vx * dt;
    const ny = this.y + this.vy * dt;
    const tx = (nx / TILE) | 0;
    const ty = (ny / TILE) | 0;
    const tile = map[ty * mapW + tx];

    if (tile === TILE_WALL || tile === TILE_VOID) {
      this.alive = false;
      if (particles) {
        const angle = Math.atan2(this.vy, this.vx) + Math.PI;
        particles.cone(this.x, this.y, angle, 0.8, 6, {
          speed: 80, life: 0.3, size: 2, color: this.color, type: 'spark', drag: 0.85
        });
      }
      return;
    }

    this.x = nx; this.y = ny;
  }

  draw(ctx) {
    if (!this.alive) return;
    const spd  = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    const trailLen = Math.min(spd * 0.04, 22);
    const nx   = this.vx / spd, ny = this.vy / spd;

    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.lineWidth   = 2.5;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    ctx.moveTo(this.x, this.y);
    ctx.lineTo(this.x - nx * trailLen, this.y - ny * trailLen);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.fillStyle   = '#ffffff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35;
    const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius * 3);
    g.addColorStop(0, this.color);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// =============================================================================
// 11. ITEM / PICKUP
// =============================================================================
class FloatingText {
  constructor(x, y, text, color) {
    this.x = x; this.y = y; this.text = text; this.color = color;
    this.life = 1.0; this.maxLife = 1.0;
    this.alive = true;
  }
  update(dt) {
    this.y -= 30 * dt;
    this.life -= dt;
    if (this.life <= 0) this.alive = false;
  }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = this.life / this.maxLife;
    ctx.fillStyle = this.color;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.text, this.x, this.y);
    ctx.restore();
  }
}

class Item {
  constructor(type, x, y, opts = {}) {
    this.type   = type;
    this.x = x; this.y = y;
    this.alive  = true;
    this.radius = 16;
    this.bobT   = Math.random() * Math.PI * 2;
    this.despawnTimer = 12.0;
    this.ammoType   = opts.ammoType   || 'PISTOL';
    this.ammoAmount = opts.ammoAmount || 10;
    this.duration   = opts.duration   || 10;
    
    switch (type) {
      case 'POTION': this.color = '#ff4488'; this.label = 'HP'; break;
      case 'AMMO': {
        this.color = '#44aaff';
        this.label = this.ammoType.slice(0, 1);
        if (this.ammoType === 'SHOTGUN') this.color = '#ff8800';
        if (this.ammoType === 'SMG')     this.color = '#00ff88';
        break;
      }
      case 'ARMOR':  this.color = '#8888ff'; this.label = 'ARM'; break;
      case 'BUFF_DMG': this.color = '#ff4400'; this.label = 'DMG+'; break;
      case 'BUFF_SPD': this.color = '#ffff00'; this.label = 'SPD+'; break;
      default:       this.color = '#ffcc00'; this.label = '?';
    }
  }

  update(dt) {
    this.bobT += dt * 2.5;
    this.despawnTimer -= dt;
    if (this.despawnTimer <= 0) this.alive = false;
  }

  draw(ctx) {
    const bob = Math.sin(this.bobT) * 6;
    const y   = this.y + bob;
    const pulse = 0.7 + Math.sin(this.bobT * 1.3) * 0.3;
    const blink = this.despawnTimer < 3 ? (Math.sin(Date.now() * 0.015) > 0 ? 1 : 0.3) : 1;

    ctx.save();
    ctx.globalAlpha = blink;
    
    // Glow
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3 * pulse * blink;
    const g = ctx.createRadialGradient(this.x, y, 0, this.x, y, this.radius * 3);
    g.addColorStop(0, this.color);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, y, this.radius * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1.0 * blink;
    
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 12, this.radius * 0.8, this.radius * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Core
    ctx.fillStyle   = this.color;
    ctx.beginPath();
    ctx.arc(this.x, y, this.radius * 0.7, 0, Math.PI * 2);
    ctx.fill();

    // Icon/Label
    ctx.fillStyle    = '#ffffff';
    ctx.font         = 'bold 10px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.label, this.x, y);
    ctx.restore();
  }
}

// =============================================================================
// 12. TILE RENDERER
// =============================================================================
function renderTiles(ctx, dungeon) {
  const { map, mapW, mapH } = dungeon;
  ctx.clearRect(0, 0, mapW * TILE, mapH * TILE);

  for (let ty = 0; ty < mapH; ty++) {
    for (let tx = 0; tx < mapW; tx++) {
      const t = map[ty * mapW + tx];
      if (t === TILE_VOID) continue;

      const px = tx * TILE, py = ty * TILE;

      if (t === TILE_FLOOR || t === TILE_CORR) {
        const shade = ((tx + ty) & 1) === 0 ? COLORS.floor1 : COLORS.floor2;
        ctx.fillStyle = shade;
        ctx.fillRect(px, py, TILE, TILE);

        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth   = 0.5;
        ctx.strokeRect(px, py, TILE, TILE);

        if ((tx * 7 + ty * 13) % 11 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.03)';
          ctx.fillRect(px + 10, py + 10, 3, 3);
        }
      } else if (t === TILE_WALL) {
        ctx.fillStyle = COLORS.wall;
        ctx.fillRect(px, py, TILE, TILE);

        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(px, py, TILE, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(px, py, 2, TILE);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(px, py + TILE - 2, TILE, 2);
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(px + TILE - 2, py, 2, TILE);

        const above = map[(ty - 1) * mapW + tx];
        if (above === TILE_FLOOR || above === TILE_CORR) {
          ctx.fillStyle = 'rgba(0,200,255,0.09)';
          ctx.fillRect(px, py, TILE, 4);
        }
      }
    }
  }

  const exit = dungeon.exitRoom;
  if (exit) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle   = '#00ff88';
    ctx.fillRect(exit.x * TILE, exit.y * TILE, exit.w * TILE, exit.h * TILE);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle   = '#00ff88';
    ctx.font        = 'bold 22px monospace';
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.fillText('EXIT', exit.cx * TILE + TILE / 2, exit.cy * TILE + TILE / 2);
    ctx.restore();
  }
}

// =============================================================================
// 13. PLAYER
// =============================================================================
class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.px = x; this.py = y;
    this.vx = 0; this.vy = 0;

    this.hp    = 100; this.maxHp    = 100;
    this.armor = 0;   this.maxArmor = 60;
    this.stamina = 100; this.maxStamina = 100;

    this.weapons    = [
      { ...WEAPON_DEFS.PISTOL,  ammo: WEAPON_DEFS.PISTOL.ammoMax  },
      { ...WEAPON_DEFS.SHOTGUN, ammo: 0 },
      { ...WEAPON_DEFS.SMG,     ammo: 0 },
      { ...WEAPON_DEFS.MELEE,   ammo: WEAPON_DEFS.MELEE.ammoMax   },
    ];
    this.weaponIdx  = 0;
    this.potions    = 3;
    this.fireCooldown  = 0;
    this.meleeCooldown = 0;
    this.meleeActive   = 0;
    this.meleeAngle    = 0;

    this.dashCd   = 0;
    this.dashDur  = 0;
    this.dashVx   = 0; this.dashVy = 0;
    this.dashing  = false;

    this.shieldCd     = 0;
    this.shieldActive = false;
    this.shieldTimer  = 0;
    this.combo        = 0;
    this.comboTimer   = 0;

    this.invincible   = 0;
    this.facing       = 0;
    this.potionCd     = 0;
    this.radius       = 14;
    this.alive        = true;
    this.hitFlash     = 0;
    this.walkT        = 0;
    this.idleT        = Math.random() * Math.PI * 2;

    this.weaponPopupTimer = 0;
    this.weaponScale = 1;

    this.buffDmg = 0;
    this.buffSpd = 0;
    this.stunTimer = 0;

    // Perk system
    this.perks        = [];
    this.dmgPerkMult  = 0;
    this.critChance   = 0;
    this.fireRateBonus= 0;
    this.resistMult   = 0;
    this.lifesteal    = 0;
    this.spdPerkMult  = 0;
    this.reloadBonus  = 0;
    this.dashCdMult   = 1;
    this.hitShield    = false;
    this.potionCapacity = 5;
  }

  get weapon() { return this.weapons[this.weaponIdx]; }

  update(dt, input, dungeon, game) {
    if (!this.alive) return;
    this.px = this.x; this.py = this.y;

    this.idleT += dt;
    const spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (spd > 10) {
      this.walkT += dt * (spd / 100) * 4;
    } else {
      this.walkT = 0;
    }

    this.fireCooldown  = Math.max(0, this.fireCooldown  - dt);
    this.meleeCooldown = Math.max(0, this.meleeCooldown - dt);
    this.meleeActive   = Math.max(0, this.meleeActive   - dt);
    this.invincible    = Math.max(0, this.invincible    - dt);
    this.potionCd      = Math.max(0, this.potionCd      - dt);
    this.hitFlash      = Math.max(0, this.hitFlash      - dt);
    this.dashCd        = Math.max(0, this.dashCd        - dt);
    this.shieldCd      = Math.max(0, this.shieldCd      - dt);
    this.weaponPopupTimer = Math.max(0, this.weaponPopupTimer - dt);
    this.weaponScale = lerp(this.weaponScale, 1, 1 - Math.pow(0.001, dt));
    
    this.buffDmg = Math.max(0, this.buffDmg - dt);
    this.buffSpd = Math.max(0, this.buffSpd - dt);
    this.stunTimer = Math.max(0, this.stunTimer - dt);

    if (this.shieldActive) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) { this.shieldActive = false; this.shieldCd = 20; }
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    if (!this.dashing) {
      this.stamina = Math.min(this.maxStamina, this.stamina + 18 * dt);
    }

    const mw = game.camera.toWorld(input.mouse.x, input.mouse.y);
    this.facing = Math.atan2(mw.y - this.y, mw.x - this.x);

    const wheel = input.getWheel();
    if (wheel !== 0) this._switchWeapon(wheel);
    
    if (input.justPressed('Digit1')) this.weaponIdx = 0;
    if (input.justPressed('Digit2')) this.weaponIdx = 1;
    if (input.justPressed('Digit3')) this.weaponIdx = 2;
    if (input.justPressed('Digit4')) this.weaponIdx = 3;

    if (this.weapon.pellets > 0) {
      if (input.mouse.down && this.fireCooldown <= 0 && this.weapon.ammo > 0) {
        this._fire(game);
      }
    } else {
      if (input.mouse.down && this.meleeCooldown <= 0) {
        this._melee(game);
      }
    }

    if (input.justPressed('KeyF') && this.potions > 0 && this.potionCd <= 0) {
      this.hp = Math.min(this.maxHp, this.hp + 35);
      this.potions--;
      this.potionCd = 1.0;
      game.particles.burst(this.x, this.y, 12, { color: '#ff44aa', type: 'glow', speed: 60, life: 0.5 });
    }

    const wantsDash = input.justPressed('Space') || input.justPressed('ShiftLeft');
    if (wantsDash && this.dashCd <= 0 && this.stamina >= 25 && !this.dashing) {
      this._startDash(input);
    }

    this._handleMovement(dt, input);
    this._resolveWalls(dungeon);
  }

  _switchWeapon(dir) {
    this.weaponIdx = ((this.weaponIdx + dir) + this.weapons.length) % this.weapons.length;
    this.fireCooldown = 0.1;
    this.weaponPopupTimer = 1.2;
    this.weaponScale = 1.35;
  }

  addPerk(type, game) {
    let entry = this.perks.find(p => p.type === type);
    if (!entry) { entry = { type, stacks: 0 }; this.perks.push(entry); }
    const mult = Math.pow(0.7, entry.stacks); // diminishing returns per stack
    entry.stacks++;

    switch (type) {
      case 'DMG'      : this.dmgPerkMult   += 0.08 * mult; break;
      case 'CRIT'     : this.critChance    += 0.05 * mult; break;
      case 'FIRERATE' : this.fireRateBonus += 0.10 * mult; break;
      case 'MAXHP'    : {
        const bonus = Math.round(this.maxHp * 0.12 * mult);
        this.maxHp += bonus; this.hp = Math.min(this.maxHp, this.hp + bonus); break;
      }
      case 'RESIST'   : this.resistMult   += 0.10 * mult; break;
      case 'POTION'   : this.potionCapacity++; this.potions = Math.min(this.potionCapacity, this.potions + 1); break;
      case 'LIFESTEAL': this.lifesteal    += 0.05 * mult; break;
      case 'SPEED'    : this.spdPerkMult  += 0.08 * mult; break;
      case 'DASHCD'   : this.dashCdMult   *= (1 - 0.10 * mult); break;
      case 'RELOAD'   : this.reloadBonus  += 0.10 * mult; break;
    }
    const def = PERK_DEFS[type];
    game.particles.burst(this.x, this.y, 22, { color: def.color, type: 'glow', speed: 90, life: 0.8, size: 6 });
  }

  _fire(game) {
    const w = this.weapon;
    this.fireCooldown = w.fireRate * Math.max(0.1, 1 - this.fireRateBonus);
    w.ammo--;

    const mw = game.camera.toWorld(game.input.mouse.x, game.input.mouse.y);
    const baseAngle = Math.atan2(mw.y - this.y, mw.x - this.x);
    const ox = Math.cos(baseAngle) * (this.radius + 6);
    const oy = Math.sin(baseAngle) * (this.radius + 6);

    let dmg = this.buffDmg > 0 ? w.damage * 1.5 : w.damage;
    dmg *= (1 + this.dmgPerkMult);
    const isCrit = Math.random() < this.critChance;
    if (isCrit) {
      dmg *= 1.5;
      game.floatingTexts.push(new FloatingText(this.x, this.y - 30, 'CRIT!', '#ffff00'));
    }

    for (let i = 0; i < w.pellets; i++) {
      const a = baseAngle + (Math.random() - 0.5) * w.spread;
      const proj = game.projPool.get();
      proj.fire(
        this.x + ox, this.y + oy,
        Math.cos(a) * w.bulletSpeed,
        Math.sin(a) * w.bulletSpeed,
        dmg, w.color, 'player', w.range
      );
      game.projectiles.push(proj);
    }

    const shellAngle = baseAngle + Math.PI + (Math.random() - 0.5) * 0.8;
    game.particles.emit(this.x + ox, this.y + oy,
      Math.cos(shellAngle) * 80, Math.sin(shellAngle) * 80,
      { life: 0.7, size: 3, type: 'shell', drag: 0.9, gravity: 60 }
    );

    game.muzzleFlash = { active: true, x: this.x + ox * 1.8, y: this.y + oy * 1.8, timer: 0.06, color: w.color };

    game.particles.cone(this.x + ox, this.y + oy, baseAngle, 0.4, 3, {
      speed: 60, life: 0.12, size: 2, color: '#ffffff', type: 'spark', drag: 0.8
    });

    game.camera.shake(w.pellets > 1 ? 3 : 1.5, 0.08);
  }

  _melee(game) {
    this.meleeCooldown = this.weapon.fireRate;
    this.meleeActive   = 0.22;
    this.meleeAngle    = this.facing;

    const arcR = this.weapon.range;
    const half  = Math.PI * 0.45;
    const dmg = this.buffDmg > 0 ? this.weapon.damage * 1.5 : this.weapon.damage;

    for (const e of game.enemies) {
      if (!e.alive) continue;
      const d = dist2(this.x, this.y, e.x, e.y);
      if (d > arcR + e.radius) continue;
      const angle = Math.atan2(e.y - this.y, e.x - this.x);
      let diff = angle - this.facing;
      while (diff >  Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < half) {
        e.takeDamage(dmg, game);
        const [kx, ky] = vecNorm(e.x - this.x, e.y - this.y);
        e.vx += kx * this.weapon.knockback;
        e.vy += ky * this.weapon.knockback;
        game.triggerHitStop();
        game.camera.shake(5, 0.12);
        game.particles.burst(e.x, e.y, 8, { color: '#ffffff', type: 'spark', speed: 120, life: 0.2 });
      }
    }

    // Crates
    for (const c of game.dungeon.crates) {
      if (!c.alive) continue;
      const d = dist2(this.x, this.y, c.x, c.y);
      if (d > arcR + c.radius) continue;
      const angle = Math.atan2(c.y - this.y, c.x - this.x);
      let diff = angle - this.facing;
      while (diff >  Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < half) {
        c.takeDamage(dmg, game);
        game.triggerHitStop();
        game.camera.shake(4, 0.12);
      }
    }

    game.particles.cone(this.x, this.y, this.facing, Math.PI * 0.9, 10, {
      speed: 100, life: 0.18, size: 2.5, color: '#ffffff', type: 'spark', drag: 0.8
    });
  }

  _startDash(input) {
    let dx = input.moveX, dy = input.moveY;
    if (dx === 0 && dy === 0) { dx = Math.cos(this.facing); dy = Math.sin(this.facing); }
    const [nx, ny] = vecNorm(dx, dy);
    this.dashVx = nx * 480; this.dashVy = ny * 480;
    this.dashing   = true;
    this.dashDur   = 0.18;
    this.dashCd    = 0.8 * this.dashCdMult;
    this.stamina  -= 25;
    this.invincible = this.dashDur;
  }

  _handleMovement(dt, input) {
    if (this.dashing) {
      this.dashDur -= dt;
      if (this.dashDur <= 0) {
        this.dashing = false;
        this.vx *= 0.3; this.vy *= 0.3;
      } else {
        this.vx = this.dashVx; this.vy = this.dashVy;
      }
    } else {
      const accel    = 1100;
      const friction = Math.pow(0.008, dt);
      let dx = input.moveX, dy = input.moveY;
      if (dx !== 0 && dy !== 0) { dx *= 0.707; dy *= 0.707; }
      
      let speedMult = this.buffSpd > 0 ? 1.4 : 1;
      speedMult *= (1 + this.spdPerkMult);
      if (this.stunTimer > 0) speedMult *= 0.4;
      
      this.vx += dx * accel * dt * speedMult;
      this.vy += dy * accel * dt * speedMult;
      this.vx *= friction;
      this.vy *= friction;
      const spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      const maxSpd = 200 * speedMult;
      if (spd > maxSpd) { this.vx = this.vx / spd * maxSpd; this.vy = this.vy / spd * maxSpd; }
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  _resolveWalls(dungeon) {
    const { map, mapW, mapH } = dungeon;
    const r = this.radius;

    const check = (cx, cy) => {
      const tx = (cx / TILE) | 0;
      const ty = (cy / TILE) | 0;
      if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return true;
      const t = map[ty * mapW + tx];
      return t === TILE_WALL || t === TILE_VOID;
    };

    const nx = this.x;
    if (check(nx + r, this.y) || check(nx - r, this.y)) {
      this.x = this.px; this.vx = 0;
    }
    const ny = this.y;
    if (check(this.x, ny + r) || check(this.x, ny - r)) {
      this.y = this.py; this.vy = 0;
    }
  }

  takeDamage(amount, game) {
    if (this.invincible > 0 || this.shieldActive) return;
    // One-hit negation shield from crate/perk
    if (this.hitShield) {
      this.hitShield = false;
      game.floatingTexts.push(new FloatingText(this.x, this.y - 24, 'BLOCKED!', '#00ffff'));
      game.particles.burst(this.x, this.y, 10, { color: '#00ffff', type: 'spark', speed: 100, life: 0.3 });
      return;
    }
    amount *= (1 - Math.min(0.70, this.resistMult));
    const absorbed = Math.min(amount * 0.6, this.armor);
    this.armor -= absorbed;
    amount    -= absorbed;
    this.hp    = Math.max(0, this.hp - amount);
    this.invincible = 0.3;
    this.hitFlash   = 0.25;

    if (amount > 18 && this.shieldCd <= 0) {
      this.shieldActive = true;
      this.shieldTimer  = 2.0;
    }

    game.camera.shake(5 + amount * 0.3, 0.18);
    game.hitFlashTimer = 0.2;
    game.particles.burst(this.x, this.y, 8, { color: '#ff2244', type: 'blood', speed: 80, life: 0.4 });

    if (this.hp <= 0) { this.alive = false; }
  }

  onKill(game) {
    this.combo++;
    this.comboTimer = 2.5;
    if (this.combo >= 3) {
      this.hp = Math.min(this.maxHp, this.hp + 5);
    }
  }

  draw(ctx, game) {
    const depth = 0.85 + (this.y / (game.dungeon.mapH * TILE)) * 0.28;
    const r = this.radius * depth;
    const walk = Math.sin(this.walkT * 10) * 4;
    const breathe = Math.sin(this.idleT * 2) * 1.5;
    const recoil = this.fireCooldown > 0 ? (this.fireCooldown / this.weapon.fireRate) * 6 : 0;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.facing);

    // 1. Soft Shadow (offset by rotation so it's always beneath)
    ctx.save();
    ctx.rotate(-this.facing);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.85, r * 1.1, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Dash Trail
    if (this.dashing) {
      ctx.save();
      ctx.rotate(-this.facing);
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = COLORS.player;
      ctx.beginPath();
      ctx.arc(this.px - this.x, this.py - this.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. Shield
    if (this.shieldActive) {
      ctx.save();
      ctx.rotate(-this.facing);
      const pulse = 0.6 + Math.sin(Date.now() * 0.012) * 0.4;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.3 * pulse;
      const sg = ctx.createRadialGradient(0, 0, r * 1.2, 0, 0, r * 2.5);
      sg.addColorStop(0, '#88ccff');
      sg.addColorStop(1, 'transparent');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(0, 0, r * 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    const baseColor = this.hitFlash > 0 ? '#ff4444' : '#2a2a35';
    const rimColor = this.hitFlash > 0 ? '#ffaaaa' : COLORS.player;

    // 4. Body Armor / Vest
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.roundRect(-r * 0.8, -r * 0.9 + breathe, r * 1.6, r * 1.8, 4);
    ctx.fill();
    
    // 5. Shoulder Pads
    ctx.fillStyle = '#3a3a45';
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.8 + breathe, r * 0.6, r * 0.4, 0, 0, Math.PI * 2); // Left (top in top-down)
    ctx.ellipse(0, r * 0.8 + breathe, r * 0.6, r * 0.4, 0, 0, Math.PI * 2);  // Right (bottom in top-down)
    ctx.fill();

    // 6. Boots (moving during walk)
    const legOffset = Math.sin(this.walkT * 10) * 6;
    ctx.fillStyle = '#1a1a20';
    ctx.fillRect(-r * 0.4 + legOffset, -r * 0.7, r * 0.6, r * 0.4);
    ctx.fillRect(-r * 0.4 - legOffset, r * 0.3, r * 0.6, r * 0.4);

    // 7. Tactical Helmet
    const hg = ctx.createRadialGradient(r * 0.3, 0, 0, r * 0.1, 0, r * 0.65);
    hg.addColorStop(0, '#6a6a75');
    hg.addColorStop(1, baseColor);
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(r * 0.1, 0, r * 0.65, 0, Math.PI * 2);
    ctx.fill();

    // 8. Visor Glow
    ctx.fillStyle = COLORS.player;
    ctx.shadowBlur = 8;
    ctx.shadowColor = COLORS.player;
    ctx.beginPath();
    ctx.roundRect(r * 0.4, -r * 0.35, r * 0.25, r * 0.7, 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 9. Rifle (if not melee)
    if (this.weapon.pellets > 0) {
      ctx.save();
      ctx.translate(-recoil, 0);
      ctx.fillStyle = '#111111';
      ctx.fillRect(r * 0.5, r * 0.4, r * 1.8, r * 0.3); // Gun body
      ctx.fillStyle = '#222222';
      ctx.fillRect(r * 0.8, r * 0.45, r * 0.6, r * 0.2); // Details
      
      // Rim light on rifle
      ctx.strokeStyle = rimColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.strokeRect(r * 0.5, r * 0.4, r * 1.8, r * 0.3);
      ctx.restore();
    }

    // 10. Rim Lighting (Neon edge)
    ctx.strokeStyle = rimColor;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(r * 0.1, 0, r * 0.65, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.stroke();

    // Melee arc
    if (this.meleeActive > 0) {
      ctx.restore(); // Exit player local space
      ctx.save();
      const t = this.meleeActive / 0.22;
      ctx.globalAlpha = t * 0.7;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.weapon.range * 0.85, this.meleeAngle - Math.PI * 0.45, this.meleeAngle + Math.PI * 0.45);
      ctx.stroke();
      ctx.globalAlpha = t * 0.12;
      ctx.fillStyle   = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.arc(this.x, this.y, this.weapon.range * 0.85, this.meleeAngle - Math.PI * 0.45, this.meleeAngle + Math.PI * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return; // Already restored
    }

    ctx.restore();
  }
}


// =============================================================================
// 14. ENEMY BASE CLASS + SUBTYPES
// =============================================================================
class Enemy {
  constructor(type, x, y, level, game) {
    const def = ENEMY_DEFS[type];
    const s   = level - 1;
    this.type    = type;
    this.x  = x; this.y  = y;
    this.px = x; this.py = y;
    this.vx = 0; this.vy = 0;
    this.hp      = def.hp  * Math.pow(1.15, s);
    this.maxHp   = this.hp;
    this.damage  = def.dmg * Math.pow(1.10, s);
    this.speed   = def.spd * Math.pow(1.03, s);
    this.radius  = def.radius;
    this.detect  = def.detect;
    this.color   = def.color;
    this.level   = level;
    this.alive   = true;
    this.state   = 'idle';
    this.stateTimer = Math.random() * 2;
    this.attackCd   = 0;
    this.patrolAngle = Math.random() * Math.PI * 2;
    this.patrolTimer = 0;
    this.walkT       = 0;
    this.idleT       = Math.random() * Math.PI * 2;
    this.hitFlash    = 0;

    // Level modifier
    this.modifier = null;
    if (level >= 10 && level < 20) this.modifier = 'EXPLODING';
    else if (level >= 20 && level < 30) { this.modifier = 'SHIELDED'; this.shield = 30; }
    else if (level >= 30 && level < 40) { this.modifier = 'FAST'; this.speed *= 1.5; this.radius *= 0.85; }
    else if (level >= 40) this.modifier = 'EXPLODING';

    // Elite system (level 5+)
    this.isElite     = false;
    this.isBoss      = false;
    this.bossTier    = 0;
    this.eliteMods   = [];
    this.eliteShield = 0;
    this.regenTimer  = 0;
    this.phaseCd     = 5 + Math.random() * 3;
    this._raging     = false;

    if (level >= 5) {
      const eliteChance = Math.min(0.35, 0.05 + Math.floor(level / 3) * 0.02);
      if (Math.random() < eliteChance) {
        this.isElite  = true;
        this.hp      *= 2; this.maxHp *= 2;
        this.damage  *= 1.3;
        this.radius  *= 1.12;
        const pool = ['SHIELDED_E','EXPLOSIVE_E','FRENZIED','REGEN','PHASE','REFLECTIVE']
          .sort(() => Math.random() - 0.5);
        const n = Math.random() < 0.3 ? 2 : 1;
        for (let i = 0; i < n; i++) this.eliteMods.push(pool[i]);
        if (this.eliteMods.includes('FRENZIED'))   { this.speed *= 1.4; }
        if (this.eliteMods.includes('SHIELDED_E')) { this.eliteShield = 3; }
      }
    }
  }

  update(dt, player, dungeon, game) {
    if (!this.alive) return;
    this.px = this.x; this.py = this.y;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);

    this.idleT += dt;
    const spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (spd > 10) {
      this.walkT += dt * (spd / 100) * 4;
    } else {
      this.walkT = 0;
    }

    // Knock-back friction
    this.vx *= Math.pow(0.05, dt);
    this.vy *= Math.pow(0.05, dt);

    const distToPlayer = dist2(this.x, this.y, player.x, player.y);
    const canSee = distToPlayer < this.detect &&
      lineOfSight(
        (this.x / TILE) | 0, (this.y / TILE) | 0,
        (player.x / TILE) | 0, (player.y / TILE) | 0,
        dungeon.map, dungeon.mapW
      );

    // Elite: regeneration
    if (this.isElite && this.eliteMods.includes('REGEN')) {
      this.regenTimer += dt;
      if (this.regenTimer >= 1.0) {
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.015);
        this.regenTimer = 0;
      }
    }
    // Elite: phase step (teleport near player)
    if (this.isElite && this.eliteMods.includes('PHASE') && this.state === 'chase') {
      this.phaseCd -= dt;
      if (this.phaseCd <= 0 && distToPlayer < 220) {
        const a = Math.atan2(player.y - this.y, player.x - this.x);
        const nx = player.x - Math.cos(a) * 55;
        const ny = player.y - Math.sin(a) * 55;
        const tx = (nx / TILE) | 0, ty = (ny / TILE) | 0;
        if (tx >= 0 && ty >= 0 && dungeon.map[ty * dungeon.mapW + tx] === TILE_FLOOR) {
          game.particles.burst(this.x, this.y, 10, { color: '#ffffff', type: 'glow', speed: 70, life: 0.3 });
          this.x = nx; this.y = ny;
          game.particles.burst(this.x, this.y, 10, { color: '#ffffff', type: 'glow', speed: 70, life: 0.3 });
        }
        this.phaseCd = 5 + Math.random() * 3;
      }
    }

    this._stateMachine(dt, player, dungeon, game, distToPlayer, canSee);

    // Move
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this._resolveWalls(dungeon);
  }

  _stateMachine(dt, player, dungeon, game, dist, canSee) {
    this.stateTimer -= dt;

    switch (this.state) {
      case 'idle':
        if (this.stateTimer <= 0) this._setState('patrol', 0.5 + Math.random() * 2);
        if (canSee) this._setState('chase', 0);
        break;

      case 'patrol':
        this.patrolTimer -= dt;
        if (this.patrolTimer <= 0) {
          this.patrolAngle += (Math.random() - 0.5) * Math.PI;
          this.patrolTimer = 1.5 + Math.random() * 2;
        }
        this.vx += Math.cos(this.patrolAngle) * this.speed * 0.3 * dt;
        this.vy += Math.sin(this.patrolAngle) * this.speed * 0.3 * dt;
        const spdP = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        if (spdP > this.speed * 0.35) { this.vx = this.vx / spdP * this.speed * 0.35; this.vy = this.vy / spdP * this.speed * 0.35; }
        if (canSee) this._setState('chase', 0);
        if (this.stateTimer <= 0) this._setState('idle', 1 + Math.random());
        break;

      case 'chase':
        this._moveToward(player.x, player.y, this.speed, dt);
        if (!canSee && this.stateTimer <= 0) this._setState('patrol', 2);
        this._doAttack(dt, player, dungeon, game, dist);
        break;

      case 'retreat':
        this._moveAwayFrom(player.x, player.y, this.speed * 0.7, dt);
        if (this.stateTimer <= 0 || dist > 220) this._setState('chase', 0);
        break;

      case 'special':
        this._doSpecial(dt, player, dungeon, game, dist);
        if (this.stateTimer <= 0) this._setState('chase', 0);
        break;
    }
  }

  _setState(s, dur) { this.state = s; this.stateTimer = dur; }

  _moveToward(tx, ty, spd, dt) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    this.vx += (dx / d) * spd * dt * 8;
    this.vy += (dy / d) * spd * dt * 8;
    const s = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (s > spd) { this.vx = this.vx / s * spd; this.vy = this.vy / s * spd; }
  }

  _moveAwayFrom(tx, ty, spd, dt) {
    const dx = this.x - tx, dy = this.y - ty;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    this.vx += (dx / d) * spd * dt * 8;
    this.vy += (dy / d) * spd * dt * 8;
    const s = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (s > spd) { this.vx = this.vx / s * spd; this.vy = this.vy / s * spd; }
  }

  _doAttack(dt, player, dungeon, game, distToPlayer) {
    // Override in subtypes
  }

  _doSpecial(dt, player, dungeon, game, distToPlayer) {
    // Override in subtypes
  }

  _resolveWalls(dungeon) {
    const { map, mapW, mapH } = dungeon;
    const r = this.radius;
    const check = (cx, cy) => {
      const tx = (cx / TILE) | 0, ty = (cy / TILE) | 0;
      if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return true;
      const t = map[ty * mapW + tx];
      return t === TILE_WALL || t === TILE_VOID;
    };
    if (check(this.x + r, this.y) || check(this.x - r, this.y)) { this.x = this.px; this.vx *= -0.3; this.patrolAngle += Math.PI * 0.5; }
    if (check(this.x, this.y + r) || check(this.x, this.y - r)) { this.y = this.py; this.vy *= -0.3; this.patrolAngle += Math.PI * 0.5; }
  }

  takeDamage(amount, game) {
    // Elite hit-absorb shield (absorbs 3 hits)
    if (this.isElite && this.eliteShield > 0) {
      this.eliteShield--;
      game.particles.burst(this.x, this.y, 8, { color: '#ffcc44', type: 'spark', speed: 110, life: 0.3 });
      game.floatingTexts.push(new FloatingText(this.x, this.y - 24, 'SHIELD!', '#ffcc44'));
      return;
    }
    // Elite reflective: bounce 20% damage back
    if (this.isElite && this.eliteMods.includes('REFLECTIVE') && game.player.invincible <= 0) {
      game.player.takeDamage(amount * 0.2, game);
    }
    if (this.modifier === 'SHIELDED' && this.shield > 0) {
      const abs = Math.min(amount, this.shield);
      this.shield -= abs; amount -= abs;
      game.particles.burst(this.x, this.y, 4, { color: '#88aaff', type: 'spark', speed: 80, life: 0.2 });
    }
    this.hp -= amount;
    this.hitFlash = 0.2;
    if (this.hp <= 0) this._die(game);
  }

  _die(game) {
    this.alive = false;
    // Boss / elite explosion modifiers
    if (this.isElite && this.eliteMods.includes('EXPLOSIVE_E')) {
      game.spawnExplosion(this.x, this.y, 100, 50);
    } else if (this.modifier === 'EXPLODING') {
      game.spawnExplosion(this.x, this.y, 80, 40);
    }
    game.onEnemyKilled(this);
    game.player.onKill(game);

    // Lifesteal on kill
    if (game.player.lifesteal > 0) {
      const heal = Math.round(this.maxHp * game.player.lifesteal * 0.15);
      if (heal > 0) {
        game.player.hp = Math.min(game.player.maxHp, game.player.hp + heal);
        game.floatingTexts.push(new FloatingText(this.x, this.y - 20, '+' + heal + ' HP', '#ff0066'));
      }
    }

    const elite = this.isElite;
    const hpPct = game.player.hp / game.player.maxHp;
    const dropChance = game.difficulty.getPotionDropChance(hpPct);
    if (elite || Math.random() < dropChance) {
      game.dungeon.items.push(new Item('POTION', this.x, this.y));
    }
    if (Math.random() < (elite ? 0.55 : 0.25)) {
      let ammoType = 'PISTOL', amount = 12;
      if (this.type === 'ARCHER') { ammoType = 'SHOTGUN'; amount = 4; }
      else if (this.type === 'WRAITH') { ammoType = 'SMG'; amount = 25; }
      else if (this.type === 'OGRE')   { ammoType = 'SHOTGUN'; amount = 8; }
      if (elite) amount = Math.floor(amount * 2);
      game.dungeon.items.push(new Item('AMMO', this.x, this.y, { ammoType, ammoAmount: amount }));
    }
    if (Math.random() < (elite ? 0.35 : 0.08)) {
      game.dungeon.items.push(new Item('ARMOR', this.x, this.y));
    }
  }

  draw(ctx, game) {
    const depth = 0.85 + (this.y / (game.dungeon.mapH * TILE)) * 0.28;
    const r = this.radius * depth;

    ctx.save();

    // Drop shadow
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + r * 0.9, r * 0.75, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Glow bloom
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.06;
    const gb = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r * 3.5);
    gb.addColorStop(0, this.color); gb.addColorStop(1, 'transparent');
    ctx.fillStyle = gb;
    ctx.beginPath(); ctx.arc(this.x, this.y, r * 3.5, 0, Math.PI * 2); ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // Body
    ctx.fillStyle = this.color;
    ctx.beginPath(); ctx.arc(this.x, this.y, r, 0, Math.PI * 2); ctx.fill();

    // Modifier ring
    if (this.modifier === 'SHIELDED' && this.shield > 0) {
      ctx.strokeStyle = '#aabbff'; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(this.x, this.y, r + 5, 0, Math.PI * 2); ctx.stroke();
    }
    if (this.modifier === 'FAST') {
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(this.x, this.y, r + 3, 0, Math.PI * 2); ctx.stroke();
    }

    ctx.globalAlpha = 1;

    // HP bar (only if damaged)
    if (this.hp < this.maxHp) {
      const bw = r * 2.2, bh = 4;
      const bx = this.x - bw / 2, by = this.y - r - 10;
      ctx.fillStyle = '#330000';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = this.hp / this.maxHp > 0.5 ? '#44ff44' : this.hp / this.maxHp > 0.25 ? '#ffaa00' : '#ff2222';
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
    }

    ctx.restore();
  }

  _drawEliteOverlay(ctx) {
    if (!this.isElite) return;
    const depth = 0.85 + (this.y / 1500) * 0.28;
    const r = this.radius * depth;
    const t = Date.now() * 0.001;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.28 + Math.sin(t * 5) * 0.12;
    const eg = ctx.createRadialGradient(this.x, this.y, r * 0.6, this.x, this.y, r * 2.4);
    eg.addColorStop(0, '#ffcc44'); eg.addColorStop(1, 'transparent');
    ctx.fillStyle = eg;
    ctx.beginPath(); ctx.arc(this.x, this.y, r * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#ffcc44';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(this.x, this.y, r + 5, 0, Math.PI * 2); ctx.stroke();
    if (this.eliteShield > 0) {
      for (let i = 0; i < this.eliteShield; i++) {
        const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
        ctx.fillStyle = '#ffcc44';
        ctx.beginPath();
        ctx.arc(this.x + Math.cos(a) * (r + 10), this.y + Math.sin(a) * (r + 10), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

// --- GOBLIN ---
class Goblin extends Enemy {
  constructor(x, y, level, game) {
    super('GOBLIN', x, y, level, game);
    this.dodgeCd = 0;
    this.stabCount = 0;
    this.stabTimer  = 0;
  }

  _doAttack(dt, player, dungeon, game, distToPlayer) {
    // Melee stab burst
    if (distToPlayer < 44 && this.attackCd <= 0) {
      this.stabCount = 3; this.stabTimer = 0.08; this.attackCd = 1.2;
    }
    if (this.stabCount > 0) {
      this.stabTimer -= dt;
      if (this.stabTimer <= 0) {
        player.takeDamage(this.damage * 0.5, game);
        game.particles.burst(player.x, player.y, 5, { color: COLORS.goblin, type: 'spark', speed: 80, life: 0.2 });
        this.stabCount--;
        this.stabTimer = 0.09;
      }
    }
    // Random dodge roll
    this.dodgeCd -= dt;
    if (this.dodgeCd <= 0 && distToPlayer < 120) {
      const perp = Math.atan2(player.y - this.y, player.x - this.x) + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1);
      this.vx += Math.cos(perp) * 220; this.vy += Math.sin(perp) * 220;
      this.dodgeCd = 2 + Math.random();
    }
  }

  draw(ctx, game) {
    const depth = 0.85 + (this.y / (game.dungeon.mapH * TILE)) * 0.28;
    const r = this.radius * depth;
    const jitter = Math.sin(this.idleT * 20) * 1.2;
    const walk = Math.sin(this.walkT * 15) * 5;
    const angle = Math.atan2(this.vy, this.vx) || 0;

    ctx.save();
    ctx.translate(this.x + jitter, this.y + jitter);
    ctx.rotate(angle);

    // 1. Smaller Shadow
    ctx.save();
    ctx.rotate(-angle);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.8, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const baseColor = this.hitFlash > 0 ? '#ff4444' : '#4d6d2d';
    const skinColor = this.hitFlash > 0 ? '#ff6666' : '#6d8d4d';

    // 2. Lean Body
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.1, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. Long Ears
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, -r * 0.5);
    ctx.lineTo(-r * 0.8, -r * 1.2);
    ctx.lineTo(r * 0.2, -r * 0.5);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.2, r * 0.5);
    ctx.lineTo(-r * 0.8, r * 1.2);
    ctx.lineTo(r * 0.2, r * 0.5);
    ctx.fill();

    // 4. Sharp Nose
    ctx.beginPath();
    ctx.moveTo(r * 0.6, -r * 0.2);
    ctx.lineTo(r * 1.2, 0);
    ctx.lineTo(r * 0.6, r * 0.2);
    ctx.fill();

    // 5. Dagger
    ctx.save();
    ctx.translate(r * 0.4 + walk, r * 0.7);
    ctx.rotate(0.5);
    ctx.fillStyle = '#777777';
    ctx.fillRect(0, -1, r * 0.8, 2); // Blade
    ctx.fillStyle = '#333333';
    ctx.fillRect(-2, -2, 4, 4); // Hilt
    ctx.restore();

    // 6. Yellow Glowing Eyes
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.arc(r * 0.5, -r * 0.25, 2, 0, Math.PI * 2);
    ctx.arc(r * 0.5, r * 0.25, 2, 0, Math.PI * 2);
    ctx.fill();

    // 7. Rim Light (from player)
    const player = game.player;
    const lightAngle = Math.atan2(player.y - this.y, player.x - this.x) - angle;
    ctx.strokeStyle = 'rgba(200,255,100,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.6, lightAngle - Math.PI * 0.3, lightAngle + Math.PI * 0.3);
    ctx.stroke();

    ctx.restore();

    this._drawEliteOverlay(ctx);
    // HP bar (only if damaged)
    if (this.hp < this.maxHp) {
      const bw = r * 2.2, bh = 3;
      const bx = this.x - bw / 2, by = this.y - r - 8;
      ctx.fillStyle = '#330000';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = this.hp / this.maxHp > 0.5 ? '#44ff44' : this.hp / this.maxHp > 0.25 ? '#ffaa00' : '#ff2222';
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
    }
  }
}

// --- OGRE ---
class Ogre extends Enemy {
  constructor(x, y, level, game) {
    super('OGRE', x, y, level, game);
    this.telegraphTimer = 0;
    this.telegraphRadius = 130;
    this.shockwaveActive = false;
    this.shockwaveR = 0;
    this.hasDamagedThisSmash = false;
  }

  _doAttack(dt, player, dungeon, game, distToPlayer) {
    // Ground shake on steps
    if (this.walkT > 0) {
      const step = Math.sin(this.walkT * 5);
      if (Math.abs(step) > 0.95 && !this._lastStep) {
        game.camera.shake(1.5, 0.1);
        this._lastStep = true;
      } else if (Math.abs(step) < 0.2) {
        this._lastStep = false;
      }
    }

    // Regular melee range check
    if (distToPlayer < this.radius + player.radius + 15 && this.attackCd <= 0) {
      player.takeDamage(this.damage * 0.5, game);
      const [kx, ky] = vecNorm(player.x - this.x, player.y - this.y);
      player.vx += kx * 250; player.vy += ky * 250;
      this.attackCd = 1.5;
      game.camera.shake(4, 0.15);
    }

    // Special Smash
    if (distToPlayer < 140 && this.attackCd <= 0 && this.state !== 'special') {
      this._setState('special', 1.4);
      this.telegraphTimer = 1.0;
      this.shockwaveActive = false;
      this.hasDamagedThisSmash = false;
      this.attackCd = 4.0;
    }
    
    if (this.hp / this.maxHp < 0.2 && this.state === 'chase') {
      this._setState('retreat', 3);
    }
  }

  _doSpecial(dt, player, dungeon, game, distToPlayer) {
    if (this.telegraphTimer > 0) {
      this.telegraphTimer -= dt;
      if (this.telegraphTimer <= 0) {
        this.shockwaveActive = true;
        this.shockwaveR = 0;
        game.camera.shake(12, 0.4);
        game.particles.burst(this.x, this.y, 30, { color: COLORS.ogre, type: 'spark', speed: 250, life: 0.5 });
      }
    }

    if (this.shockwaveActive) {
      this.shockwaveR += 350 * dt;
      const d = dist2(this.x, this.y, player.x, player.y);
      if (!this.hasDamagedThisSmash && d < this.telegraphRadius + player.radius) {
        player.takeDamage(this.damage, game);
        const [kx, ky] = vecNorm(player.x - this.x, player.y - this.y);
        player.vx += kx * 450;
        player.vy += ky * 450;
        player.stunTimer = 0.4;
        this.hasDamagedThisSmash = true;
        game.camera.shake(10, 0.25);
      }
      if (this.shockwaveR > this.telegraphRadius) this.shockwaveActive = false;
    }

    // Boss Tier 3: phase 2 at 50% HP — summon goblins
    if (this.isBoss && this.bossTier >= 3 && !this._phase2 && this.hp / this.maxHp < 0.5) {
      this._phase2 = true;
      game.floatingTexts.push(new FloatingText(this.x, this.y - 60, 'PHASE 2!', '#ff4400'));
      game.camera.shake(14, 0.5);
      game.particles.burst(this.x, this.y, 35, { color: '#ff4400', type: 'glow', speed: 120, life: 0.7 });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const gx = this.x + Math.cos(a) * 90, gy = this.y + Math.sin(a) * 90;
        const tx = (gx / TILE) | 0, ty = (gy / TILE) | 0;
        if (dungeon.map && dungeon.map[ty * dungeon.mapW + tx] === TILE_FLOOR) {
          game.enemies.push(new Goblin(gx, gy, game.level, game));
        }
      }
    }
    // Boss Tier 4: rage below 25%
    if (this.isBoss && this.bossTier >= 4 && !this._raging && this.hp / this.maxHp < 0.25) {
      this._raging = true;
      this.speed *= 1.6;
      game.floatingTexts.push(new FloatingText(this.x, this.y - 60, 'RAGE!', '#ff0000'));
      game.camera.shake(10, 0.4);
    }
  }

  draw(ctx, game) {
    const depth = 0.85 + (this.y / (game.dungeon.mapH * TILE)) * 0.28;
    const r = this.radius * depth;
    const walk = Math.sin(this.walkT * 5) * 6;
    const breathe = Math.sin(this.idleT * 1.5) * 2;
    const angle = Math.atan2(this.vy, this.vx) || 0;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(angle);

    // 1. Large Shadow
    ctx.save();
    ctx.rotate(-angle);
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.8, r * 1.4, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const baseColor = this.hitFlash > 0 ? '#ff6666' : '#2d4d2d';
    const muscleColor = this.hitFlash > 0 ? '#ff8888' : '#3d5d3d';

    // 2. Broad Shoulders
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.6 + breathe, r * 1.2, r * 0.7, 0, 0, Math.PI * 2);
    ctx.ellipse(0, r * 0.6 + breathe, r * 1.2, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. Thick Arms
    const armMove = Math.sin(this.walkT * 5) * 8;
    ctx.fillStyle = muscleColor;
    ctx.beginPath();
    ctx.ellipse(r * 0.4 + armMove, -r * 1.1 + breathe, r * 0.8, r * 0.5, 0.4, 0, Math.PI * 2);
    ctx.ellipse(r * 0.4 - armMove, r * 1.1 + breathe, r * 0.8, r * 0.5, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // 4. Club Weapon
    ctx.save();
    ctx.translate(r * 0.8 - armMove, r * 1.2 + breathe);
    ctx.rotate(0.3 + armMove * 0.05);
    ctx.fillStyle = '#4a3a2a'; // Wood
    ctx.fillRect(0, -r * 0.2, r * 1.5, r * 0.4);
    ctx.fillStyle = '#333333'; // Spikes/Heads
    ctx.beginPath();
    ctx.arc(r * 1.4, 0, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 5. Main Body
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // 6. Scars
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.3); ctx.lineTo(-r * 0.2, -r * 0.1);
    ctx.moveTo(-r * 0.4, r * 0.2); ctx.lineTo(-r * 0.1, r * 0.4);
    ctx.stroke();

    // 7. Head
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.arc(r * 0.3, 0, r * 0.6, 0, Math.PI * 2);
    ctx.fill();

    // 8. Red Glowing Eyes
    ctx.fillStyle = '#ff0000';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ff0000';
    ctx.beginPath();
    ctx.arc(r * 0.7, -r * 0.2, 3, 0, Math.PI * 2);
    ctx.arc(r * 0.7, r * 0.2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 9. Rim Highlight (from player)
    const player = game.player;
    const lightAngle = Math.atan2(player.y - this.y, player.x - this.x) - angle;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r, lightAngle - Math.PI * 0.4, lightAngle + Math.PI * 0.4);
    ctx.stroke();

    ctx.restore();

    // Telegraph circle
    if (this.state === 'special' && this.telegraphTimer > 0) {
      ctx.save();
      ctx.strokeStyle = '#ff2200';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.6 + Math.sin(Date.now() * 0.015) * 0.4;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.telegraphRadius, 0, Math.PI * 2);
      ctx.stroke();
      
      // Fill progress
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#ff2200';
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.arc(this.x, this.y, this.telegraphRadius, 0, Math.PI * 2 * (1 - this.telegraphTimer / 1.0));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Shockwave ring
    if (this.shockwaveActive && this.shockwaveR > 0) {
      ctx.save();
      ctx.strokeStyle = '#ff4400';
      ctx.lineWidth = 6;
      ctx.globalAlpha = Math.max(0, 1 - this.shockwaveR / this.telegraphRadius);
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.shockwaveR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Boss tier: orange-gold boss aura
    if (this.isBoss) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18 + Math.sin(Date.now() * 0.004) * 0.08;
      const bg2 = ctx.createRadialGradient(this.x, this.y, r, this.x, this.y, r * 3.5);
      bg2.addColorStop(0, '#ff6600'); bg2.addColorStop(1, 'transparent');
      ctx.fillStyle = bg2;
      ctx.beginPath(); ctx.arc(this.x, this.y, r * 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ff8800';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(this.x, this.y, r + 8, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    this._drawEliteOverlay(ctx);
    // HP bar (only if damaged)
    if (this.hp < this.maxHp && !this.isBoss) {
      const bw = r * 2.2, bh = 4;
      const bx = this.x - bw / 2, by = this.y - r - 15;
      ctx.fillStyle = '#330000';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = this.hp / this.maxHp > 0.5 ? '#44ff44' : this.hp / this.maxHp > 0.25 ? '#ffaa00' : '#ff2222';
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
    }
  }
}

// --- SKELETON ARCHER ---
class SkeletonArcher extends Enemy {
  constructor(x, y, level, game) {
    super('ARCHER', x, y, level, game);
    this.preferDist = 160;
  }

  _doAttack(dt, player, dungeon, game, distToPlayer) {
    // Keep preferred distance
    if (distToPlayer < 80) {
      this._setState('retreat', 2);
      return;
    }

    // Fire projectile (predictive aim)
    if (distToPlayer < this.detect && this.attackCd <= 0) {
      const bspd = 260;
      const t    = distToPlayer / bspd;
      const px   = player.x + player.vx * t;
      const py   = player.y + player.vy * t;
      const angle = Math.atan2(py - this.y, px - this.x) + (Math.random() - 0.5) * 0.15;
      const proj  = game.projPool.get();
      proj.fire(this.x, this.y, Math.cos(angle) * bspd, Math.sin(angle) * bspd,
        this.damage, COLORS.archer, 'enemy', 400);
      game.projectiles.push(proj);
      this.attackCd = 1.8 - Math.min(0.8, game.level * 0.04);
      game.particles.cone(this.x, this.y, angle, 0.2, 3, {
        speed: 60, life: 0.15, size: 2, color: COLORS.archer, type: 'spark'
      });
    }

    // Strafe sideways
    if (distToPlayer > this.preferDist - 30 && distToPlayer < this.preferDist + 50) {
      this.vx += Math.cos(Math.atan2(player.y - this.y, player.x - this.x) + Math.PI / 2) * this.speed * 0.4 * dt;
    }
  }

  draw(ctx, game) {
    const depth = 0.85 + (this.y / (game.dungeon.mapH * TILE)) * 0.28;
    const r = this.radius * depth;
    const walk = Math.sin(this.walkT * 8) * 3;
    const breathe = Math.sin(this.idleT * 1.8) * 1.5;
    const player = game.player;
    const angle = Math.atan2(player.y - this.y, player.x - this.x);

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(angle);

    // 1. Shadow
    ctx.save();
    ctx.rotate(-angle);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.85, r * 1.1, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const boneColor = this.hitFlash > 0 ? '#ff6666' : '#e0e0d0';

    // 2. Rib Cage
    ctx.strokeStyle = boneColor;
    ctx.lineWidth = 2;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.arc(0, i * r * 0.3 + breathe, r * 0.7, -Math.PI * 0.4, Math.PI * 0.4);
      ctx.stroke();
    }
    // Spine
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, 0);
    ctx.lineTo(r * 0.3, 0);
    ctx.stroke();

    // 3. Skull
    ctx.fillStyle = boneColor;
    ctx.beginPath();
    ctx.arc(r * 0.4, 0, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    // Eye sockets
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(r * 0.7, -r * 0.2, 2, 0, Math.PI * 2);
    ctx.arc(r * 0.7, r * 0.2, 2, 0, Math.PI * 2);
    ctx.fill();

    // 4. Bow
    const isFiring = this.attackCd > 0.5;
    const pull = isFiring ? 6 : 0;
    ctx.strokeStyle = '#6a4a3a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(r * 1.2, 0, r * 1.5, -Math.PI * 0.3, Math.PI * 0.3);
    ctx.stroke();
    // Bowstring
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r * 1.2 + Math.cos(-Math.PI * 0.3) * r * 1.5, Math.sin(-Math.PI * 0.3) * r * 1.5);
    ctx.lineTo(r * 0.6 - pull, 0);
    ctx.lineTo(r * 1.2 + Math.cos(Math.PI * 0.3) * r * 1.5, Math.sin(Math.PI * 0.3) * r * 1.5);
    ctx.stroke();

    // 5. Rim Light (from player)
    const lightAngle = Math.atan2(player.y - this.y, player.x - this.x) - angle;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.8, lightAngle - Math.PI * 0.4, lightAngle + Math.PI * 0.4);
    ctx.stroke();

    // 6. Transparency Glow
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.1;
    const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.5);
    bg.addColorStop(0, COLORS.archer); bg.addColorStop(1, 'transparent');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.5, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
    this._drawEliteOverlay(ctx);

    // HP bar
    if (this.hp < this.maxHp) {
      const bw = r * 2.2, bh = 3;
      const bx = this.x - bw / 2, by = this.y - r - 10;
      ctx.fillStyle = '#330000';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = this.hp / this.maxHp > 0.5 ? '#44ff44' : this.hp / this.maxHp > 0.25 ? '#ffaa00' : '#ff2222';
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
    }
  }
}

// --- SHADOW WRAITH ---
class ShadowWraith extends Enemy {
  constructor(x, y, level, game) {
    super('WRAITH', x, y, level, game);
    this.teleportCd   = 4 + Math.random() * 2;
    this.invisible    = false;
    this.invisTimer   = 0;
    this.drainTimer   = 0;
    this.baseAlpha    = 0.28;
  }

  update(dt, player, dungeon, game) {
    this.teleportCd -= dt;
    if (this.hp / this.maxHp < 0.5 && !this.invisible) {
      this.invisible = true; this.invisTimer = 3;
    }
    if (this.invisible) {
      this.invisTimer -= dt;
      if (this.invisTimer <= 0) this.invisible = false;
    }

    // Teleport
    if (this.teleportCd <= 0) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = 80 + Math.random() * 140;
      const nx = player.x + Math.cos(angle) * dist;
      const ny = player.y + Math.sin(angle) * dist;
      const tx = (nx / TILE) | 0, ty = (ny / TILE) | 0;
      if (dungeon.map[ty * dungeon.mapW + tx] === TILE_FLOOR) {
        game.particles.burst(this.x, this.y, 15, { color: COLORS.wraith, type: 'glow', speed: 80, life: 0.4 });
        this.x = nx; this.y = ny;
        game.particles.burst(this.x, this.y, 15, { color: COLORS.wraith, type: 'glow', speed: 80, life: 0.4 });
      }
      this.teleportCd = 4 + Math.random() * 2;
    }

    // Life drain
    const d = dist2(this.x, this.y, player.x, player.y);
    if (d < 65 && this.alive) {
      this.drainTimer += dt;
      if (this.drainTimer >= 0.5) {
        player.takeDamage(3, game);
        this.hp = Math.min(this.maxHp, this.hp + 3);
        this.drainTimer = 0;
        game.particles.emit(
          (this.x + player.x) / 2, (this.y + player.y) / 2,
          (this.x - player.x) * 0.5, (this.y - player.y) * 0.5,
          { color: COLORS.wraith, type: 'glow', life: 0.4, size: 4 }
        );
      }
    } else { this.drainTimer = 0; }

    // Smoky particles
    if (Math.random() < 0.2) {
      game.particles.emit(this.x + (Math.random()-0.5)*20, this.y + (Math.random()-0.5)*20, 
        (Math.random()-0.5)*20, (Math.random()-0.5)*20, 
        { color: COLORS.wraith, type: 'glow', life: 0.6, size: 3, alpha: 0.3 }
      );
    }

    super.update(dt, player, dungeon, game);
  }

  draw(ctx, game) {
    const depth = 0.85 + (this.y / (game.dungeon.mapH * TILE)) * 0.28;
    const r = this.radius * depth;
    const float = Math.sin(this.idleT * 3) * 5;
    const flicker = 0.7 + Math.sin(this.idleT * 15) * 0.3;
    const angle = Math.atan2(this.vy, this.vx) || 0;

    ctx.save();
    ctx.translate(this.x, this.y + float);
    ctx.rotate(angle);

    // 1. Faint Shadow
    ctx.save();
    ctx.rotate(-angle);
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(0, r * 1.2 - float, r * 0.8, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 2. Semi-transparent Smoky Body
    ctx.globalAlpha = (this.invisible ? 0.15 : 0.5) * flicker;
    ctx.globalCompositeOperation = 'lighter';
    
    const colors = [COLORS.wraith, '#4444ff', '#8844ff'];
    for (let i = 0; i < 3; i++) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * (1.5 + i * 0.5));
      g.addColorStop(0, colors[i]);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r * (1.5 + i * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Core Glow
    ctx.globalAlpha = 1.0 * flicker;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // 4. Ghostly Wisps
    const player = game.player;
    const lightAngle = Math.atan2(player.y - this.y, player.x - this.x) - angle;
    ctx.strokeStyle = COLORS.wraith;
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = (this.idleT * 5 + i * Math.PI * 0.5) % (Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.quadraticCurveTo(Math.cos(a + 0.5) * r * 2, Math.sin(a + 0.5) * r * 2, Math.cos(a + 1) * r * 1.5, Math.sin(a + 1) * r * 1.5);
      ctx.stroke();
    }

    // Rim light on core
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.4, lightAngle - Math.PI * 0.5, lightAngle + Math.PI * 0.5);
    ctx.stroke();

    ctx.restore();
    this._drawEliteOverlay(ctx);

    // HP bar
    if (this.hp < this.maxHp) {
      const bw = r * 2.2, bh = 3;
      const bx = this.x - bw / 2, by = this.y - r - 15;
      ctx.fillStyle = '#330000';
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = this.hp / this.maxHp > 0.5 ? '#44ff44' : this.hp / this.maxHp > 0.25 ? '#ffaa00' : '#ff2222';
      ctx.fillRect(bx, by, bw * (this.hp / this.maxHp), bh);
    }
  }
}

// =============================================================================
// 14c. SUPER CHEST — Level clear reward
// =============================================================================
class SuperChest {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.alive   = true;
    this.opened  = false;
    this.radius  = 28;
    this.pulseT  = 0;
    this.rayT    = 0;
    this.choices = null;
    this.interactRange = 70;
  }

  generateChoices() {
    const types = Object.keys(PERK_DEFS);
    for (let i = types.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [types[i], types[j]] = [types[j], types[i]];
    }
    this.choices = types.slice(0, 3);
  }

  tryOpen(player, game) {
    if (this.opened) return false;
    if (dist2(player.x, player.y, this.x, this.y) > this.interactRange) return false;
    this.opened = true;
    this.generateChoices();
    game.particles.burst(this.x, this.y, 35, { color: '#ffcc44', type: 'glow', speed: 130, life: 0.9, size: 8 });
    game.particles.burst(this.x, this.y, 20, { color: '#ffffff', type: 'spark', speed: 190, life: 0.5 });
    game.camera.shake(6, 0.3);
    return true;
  }

  update(dt) {
    this.pulseT += dt * 2.5;
    this.rayT   += dt * 0.4;
  }

  draw(ctx) {
    if (this.opened) return;
    const t = Date.now() * 0.001;
    const pulse = 0.75 + Math.sin(this.pulseT) * 0.25;

    ctx.save();
    ctx.translate(this.x, this.y);

    // Animated light rays
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + this.rayT;
      ctx.globalAlpha = 0.07 * pulse;
      ctx.strokeStyle = '#ffcc44';
      ctx.lineWidth = 5 + Math.sin(t * 2.5 + i) * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 95, Math.sin(a) * 95);
      ctx.stroke();
    }
    // Pulsing aura
    ctx.globalAlpha = 0.22 * pulse;
    const ag = ctx.createRadialGradient(0, 0, 0, 0, 0, 68);
    ag.addColorStop(0, '#ffcc44'); ag.addColorStop(1, 'transparent');
    ctx.fillStyle = ag;
    ctx.beginPath(); ctx.arc(0, 0, 68, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath(); ctx.ellipse(0, 28, 32, 11, 0, 0, Math.PI * 2); ctx.fill();

    // Chest body
    ctx.fillStyle = '#2a1800';
    ctx.fillRect(-27, -8, 54, 38);
    // Lid
    ctx.fillStyle = '#3d2400';
    ctx.fillRect(-27, -26, 54, 22);

    // Gold metal trim
    ctx.strokeStyle = '#ffcc44';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(-27, -26, 54, 22);
    ctx.strokeRect(-27, -8, 54, 38);
    ctx.beginPath(); ctx.moveTo(-27, -8); ctx.lineTo(27, -8); ctx.stroke();

    // Orbiting gold sparkles
    for (let i = 0; i < 4; i++) {
      const sa = (i / 4) * Math.PI * 2 + t * 1.8;
      const sr = 14 + Math.sin(t * 3 + i) * 4;
      ctx.globalAlpha = 0.5 + Math.sin(t * 4 + i) * 0.3;
      ctx.fillStyle = '#ffee88';
      ctx.beginPath();
      ctx.arc(Math.cos(sa) * sr, Math.sin(sa) * sr - 6, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Glowing lock
    ctx.fillStyle = '#ffcc44';
    ctx.shadowBlur = 12; ctx.shadowColor = '#ffcc44';
    ctx.beginPath(); ctx.arc(0, 6, 7, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // E prompt
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.75 + Math.sin(t * 5) * 0.25;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('[E] OPEN', 0, 52);
    ctx.globalAlpha = 1;

    ctx.restore();
  }
}

// =============================================================================
// 15. DIFFICULTY MANAGER
// =============================================================================
class DifficultyManager {
  constructor() {
    this.earlyDeaths = 0;
    this.level       = 1;
  }

  getSpawnCount(base) {
    let n = base + Math.floor(this.level / 2);
    if (this.earlyDeaths > 2 && this.level < 6) n = Math.max(1, n - 1);
    return n;
  }

  getPotionDropChance(hpPct) {
    return hpPct < 0.30 ? 0.35 : 0.15;
  }
}

// =============================================================================
// 16. RENDERER
// =============================================================================
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');

    this.bgOC    = new OffscreenCanvas(CANVAS_W, CANVAS_H);
    this.bgCtx   = this.bgOC.getContext('2d');

    this.worldOC  = new OffscreenCanvas(CANVAS_W, CANVAS_H);
    this.worldCtx = this.worldOC.getContext('2d');

    this.shadowOC  = new OffscreenCanvas(CANVAS_W, CANVAS_H);
    this.shadowCtx = this.shadowOC.getContext('2d');

    this.lightOC  = new OffscreenCanvas(CANVAS_W, CANVAS_H);
    this.lightCtx = this.lightOC.getContext('2d');

    this.bgDirty = true;
    this.bgMapW  = 0;
    this.bgMapH  = 0;
  }

  frame(game) {
    const { player, enemies, projectiles, particles, dungeon, camera } = game;

    // 1. Static bg tiles
    if (this.bgDirty) {
      const size = Math.max(dungeon.mapW, dungeon.mapH);
      if (this.bgOC.width < dungeon.mapW * TILE || this.bgOC.height < dungeon.mapH * TILE) {
        this.bgOC.width  = dungeon.mapW * TILE;
        this.bgOC.height = dungeon.mapH * TILE;
        this.bgCtx = this.bgOC.getContext('2d');
      }
      renderTiles(this.bgCtx, dungeon);
      this.bgDirty = false;
      this.bgMapW  = dungeon.mapW * TILE;
      this.bgMapH  = dungeon.mapH * TILE;
    }

    // 2. World canvas
    this.worldCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    camera.apply(this.worldCtx);

    this.worldCtx.drawImage(this.bgOC, 0, 0);

    // Decals
    for (const d of dungeon.decals) {
      this.worldCtx.globalAlpha = d.alpha * 0.5;
      this.worldCtx.fillStyle   = d.color;
      this.worldCtx.beginPath();
      this.worldCtx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      this.worldCtx.fill();
      this.worldCtx.globalAlpha = 1;
    }

    // Items
    for (const item of dungeon.items) {
      if (item.alive) item.draw(this.worldCtx);
    }

    // Torches (flicker)
    const now = Date.now() * 0.001;
    for (const t of dungeon.torches) {
      const f = 0.8 + Math.sin(now * t.flicker * 6 + t.offset) * 0.2;
      this.worldCtx.save();
      this.worldCtx.globalCompositeOperation = 'lighter';
      this.worldCtx.globalAlpha = 0.25 * f;
      const tg = this.worldCtx.createRadialGradient(t.x, t.y, 0, t.x, t.y, t.radius * f);
      tg.addColorStop(0, '#ffaa44');
      tg.addColorStop(0.5, '#ff6600');
      tg.addColorStop(1, 'transparent');
      this.worldCtx.fillStyle = tg;
      this.worldCtx.beginPath();
      this.worldCtx.arc(t.x, t.y, t.radius * f, 0, Math.PI * 2);
      this.worldCtx.fill();
      this.worldCtx.restore();

      // Torch core dot
      this.worldCtx.fillStyle = '#ffdd88';
      this.worldCtx.globalAlpha = 0.9;
      this.worldCtx.beginPath();
      this.worldCtx.arc(t.x, t.y, 3, 0, Math.PI * 2);
      this.worldCtx.fill();
      this.worldCtx.globalAlpha = 1;
    }

    // Super chest
    if (game.superChest && !game.superChest.opened) game.superChest.draw(this.worldCtx);

    // Y-sort and draw entities
    const entities = [...enemies.filter(e => e.alive), ...dungeon.crates.filter(c => c.alive), player].sort((a, b) => a.y - b.y);
    for (const e of entities) {
      if (e instanceof Player) e.draw(this.worldCtx, game);
      else e.draw(this.worldCtx, game);
    }

    // Projectiles
    for (const p of projectiles) p.draw(this.worldCtx);

    // Particles
    particles.draw(this.worldCtx);

    // Floating texts
    for (const ft of game.floatingTexts) ft.draw(this.worldCtx);

    camera.restore(this.worldCtx);

    // 3. Shadow map
    this._buildShadow(game, camera, now);

    // 4. Light map (additive glows)
    this._buildLights(game, camera, now);

    // 5. Composite to main
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.drawImage(this.worldOC, 0, 0);

    // Darkness overlay
    ctx.drawImage(this.shadowOC, 0, 0);

    // Additive light
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.lightOC, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    // 6. Screen FX
    this._screenFX(game, ctx, now);
  }

  _buildShadow(game, camera, now) {
    const { player, dungeon } = game;
    const sc = this.shadowCtx;

    sc.clearRect(0, 0, CANVAS_W, CANVAS_H);
    sc.fillStyle = 'rgba(0,0,15,0.93)';
    sc.fillRect(0, 0, CANVAS_W, CANVAS_H);

    sc.globalCompositeOperation = 'destination-out';

    const ps = camera.toScreen(player.x, player.y);
    const mw = game.camera.toWorld(game.input.mouse.x, game.input.mouse.y);
    const mouseAngle = Math.atan2(mw.y - player.y, mw.x - player.x);

    // Player ambient circle (flicker)
    const flick = 0.92 + Math.sin(now * 11.3) * 0.08;
    const ambR  = 195 * flick;
    const ag = sc.createRadialGradient(ps.x, ps.y, 0, ps.x, ps.y, ambR);
    ag.addColorStop(0,   'rgba(0,0,0,1)');
    ag.addColorStop(0.55,'rgba(0,0,0,0.75)');
    ag.addColorStop(0.82,'rgba(0,0,0,0.3)');
    ag.addColorStop(1,   'rgba(0,0,0,0)');
    sc.fillStyle = ag;
    sc.beginPath(); sc.arc(ps.x, ps.y, ambR, 0, Math.PI * 2); sc.fill();

    // Flashlight cone
    const coneRange = 290 * flick;
    const halfCone  = 0.38;
    sc.save();
    sc.beginPath();
    sc.moveTo(ps.x, ps.y);
    sc.arc(ps.x, ps.y, coneRange, mouseAngle - halfCone, mouseAngle + halfCone);
    sc.closePath();
    const cg = sc.createRadialGradient(ps.x, ps.y, 0, ps.x, ps.y, coneRange);
    cg.addColorStop(0,   'rgba(0,0,0,1)');
    cg.addColorStop(0.7, 'rgba(0,0,0,0.8)');
    cg.addColorStop(1,   'rgba(0,0,0,0)');
    sc.fillStyle = cg;
    sc.fill();
    sc.restore();

    // Torch light holes
    for (const t of dungeon.torches) {
      const ts = camera.toScreen(t.x, t.y);
      const tr = t.radius * (0.88 + Math.sin(now * t.flicker * 6 + t.offset) * 0.12);
      if (ts.x < -tr || ts.x > CANVAS_W + tr || ts.y < -tr || ts.y > CANVAS_H + tr) continue;
      const tg = sc.createRadialGradient(ts.x, ts.y, 0, ts.x, ts.y, tr);
      tg.addColorStop(0,   'rgba(0,0,0,0.9)');
      tg.addColorStop(0.6, 'rgba(0,0,0,0.5)');
      tg.addColorStop(1,   'rgba(0,0,0,0)');
      sc.fillStyle = tg;
      sc.beginPath(); sc.arc(ts.x, ts.y, tr, 0, Math.PI * 2); sc.fill();
    }

    // Explosion light holes
    for (const ex of game.explosions) {
      const es = camera.toScreen(ex.x, ex.y);
      const er = ex.radius * (ex.timer / ex.maxTimer);
      const eg = sc.createRadialGradient(es.x, es.y, 0, es.x, es.y, er);
      eg.addColorStop(0, 'rgba(0,0,0,1)');
      eg.addColorStop(1, 'rgba(0,0,0,0)');
      sc.fillStyle = eg;
      sc.beginPath(); sc.arc(es.x, es.y, er, 0, Math.PI * 2); sc.fill();
    }

    sc.globalCompositeOperation = 'source-over';
  }

  _buildLights(game, camera, now) {
    const { player, enemies } = game;
    const lc = this.lightCtx;
    lc.clearRect(0, 0, CANVAS_W, CANVAS_H);
    lc.globalCompositeOperation = 'lighter';

    // Muzzle flash
    const mf = game.muzzleFlash;
    if (mf && mf.active) {
      const ms = camera.toScreen(mf.x, mf.y);
      const ma = mf.timer / 0.06;
      const mg = lc.createRadialGradient(ms.x, ms.y, 0, ms.x, ms.y, 55);
      mg.addColorStop(0, `rgba(255,255,200,${0.6 * ma})`);
      mg.addColorStop(0.4, mf.color + '44');
      mg.addColorStop(1, 'transparent');
      lc.fillStyle = mg;
      lc.beginPath(); lc.arc(ms.x, ms.y, 55, 0, Math.PI * 2); lc.fill();
    }

    // Explosions
    for (const ex of game.explosions) {
      const es = camera.toScreen(ex.x, ex.y);
      const ep = ex.timer / ex.maxTimer;
      const eg = lc.createRadialGradient(es.x, es.y, 0, es.x, es.y, ex.radius * 1.5 * ep);
      eg.addColorStop(0, `rgba(255,180,60,${0.7 * ep})`);
      eg.addColorStop(0.5, `rgba(255,80,0,${0.3 * ep})`);
      eg.addColorStop(1, 'transparent');
      lc.fillStyle = eg;
      lc.beginPath(); lc.arc(es.x, es.y, ex.radius * 1.5 * ep, 0, Math.PI * 2); lc.fill();
    }

    // Super chest glow
    if (game.superChest && !game.superChest.opened) {
      const cs = camera.toScreen(game.superChest.x, game.superChest.y);
      const cpulse = 0.7 + Math.sin(now * 3) * 0.3;
      const cg2 = lc.createRadialGradient(cs.x, cs.y, 0, cs.x, cs.y, 80);
      cg2.addColorStop(0, `rgba(255,204,68,${0.4 * cpulse})`);
      cg2.addColorStop(1, 'transparent');
      lc.fillStyle = cg2;
      lc.beginPath(); lc.arc(cs.x, cs.y, 80, 0, Math.PI * 2); lc.fill();
    }

    // Enemy glows
    for (const e of enemies) {
      if (!e.alive) continue;
      const es = camera.toScreen(e.x, e.y);
      if (es.x < -80 || es.x > CANVAS_W + 80 || es.y < -80 || es.y > CANVAS_H + 80) continue;
      const eg = lc.createRadialGradient(es.x, es.y, 0, es.x, es.y, e.radius * 2.5);
      eg.addColorStop(0, e.color + '22');
      eg.addColorStop(1, 'transparent');
      lc.fillStyle = eg;
      lc.beginPath(); lc.arc(es.x, es.y, e.radius * 2.5, 0, Math.PI * 2); lc.fill();
    }

    lc.globalCompositeOperation = 'source-over';
  }

  _screenFX(game, ctx, now) {
    // Vignette
    const vg = ctx.createRadialGradient(
      CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.28,
      CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.85
    );
    vg.addColorStop(0, 'transparent');
    vg.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Hit flash (red)
    if (game.hitFlashTimer > 0) {
      ctx.fillStyle = `rgba(255,30,30,${game.hitFlashTimer * 0.55})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // Low HP pulse
    const hpPct = game.player.hp / game.player.maxHp;
    if (hpPct < 0.3 && game.state === 'PLAYING') {
      const pulse = Math.abs(Math.sin(now * 4)) * 0.18 * (1 - hpPct / 0.3);
      ctx.fillStyle = `rgba(200,0,0,${pulse})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // Level-up flash
    if (game.levelFlashTimer > 0) {
      ctx.fillStyle = `rgba(0,255,136,${game.levelFlashTimer * 0.35})`;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
  }
}

// =============================================================================
// 17. UI RENDERER
// =============================================================================
function renderUI(ctx, game, now) {
  const p = game.player;

  if (game.state === 'PLAYING') {
    // --- TOP LEFT: HP / Armor / Stamina ---
    const bx = 18, by = 18, bw = 160, bh = 12, gap = 6;

    const drawBar = (label, val, max, y, fillColor, bgColor) => {
      ctx.fillStyle = bgColor || '#111';
      roundRect(ctx, bx, y, bw, bh, 3); ctx.fill();
      ctx.fillStyle = fillColor;
      roundRect(ctx, bx, y, Math.max(0, bw * (val / max)), bh, 3); ctx.fill();
      ctx.strokeStyle = fillColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      roundRect(ctx, bx, y, bw, bh, 3); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label + ' ' + Math.ceil(val) + '/' + max, bx + 4, y + bh / 2);
    };

    drawBar('HP',  p.hp,      p.maxHp,      by,              '#00ffcc', '#0a1a15');
    drawBar('ARM', p.armor,   p.maxArmor,   by + bh + gap,   '#4488ff', '#0a0a1a');
    drawBar('STA', p.stamina, p.maxStamina, by + (bh+gap)*2, '#44ff88', '#0a1a0a');

    // Potion count
    ctx.fillStyle = '#ff4488';
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('POTION: ' + p.potions, bx, by + (bh + gap) * 3 + 4);

    // Active perk icons under potion row
    if (p.perks.length > 0) {
      const iconY = by + (bh + gap) * 3 + 24;
      p.perks.forEach((perk, idx) => {
        const def = PERK_DEFS[perk.type];
        const ix = bx + idx * 24;
        ctx.fillStyle = def.color;
        ctx.globalAlpha = 0.65;
        roundRect(ctx, ix, iconY, 22, 16, 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(def.icon, ix + 11, iconY + 8);
        if (perk.stacks > 1) {
          ctx.fillStyle = '#ffff00';
          ctx.font = '7px monospace';
          ctx.textAlign = 'left';
          ctx.fillText('x' + perk.stacks, ix + 15, iconY + 3);
        }
      });
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    }

    // Hit shield indicator
    if (p.hitShield) {
      ctx.fillStyle = '#00ffff';
      ctx.font = 'bold 12px monospace';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText('SHIELD', bx, by + (bh + gap) * 3 + 4 + (p.perks.length > 0 ? 22 : 0) + 18);
    }

    // --- BOTTOM: Weapon + Ammo ---
    const wy = CANVAS_H - 60, wx = CANVAS_W / 2;
    const w  = p.weapon;
    ctx.fillStyle = '#000a';
    roundRect(ctx, wx - 110, wy - 8, 220, 44, 6); ctx.fill();

    ctx.fillStyle = w.color;
    ctx.font = 'bold 15px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(w.name.toUpperCase(), wx, wy + 5);

    if (w.pellets > 0) {
      const ammoRatio = w.ammo / w.ammoMax;
      ctx.fillStyle = ammoRatio > 0.3 ? '#aaffcc' : '#ff4444';
      ctx.font = '11px monospace';
      ctx.fillText('[' + w.ammo + ' / ' + w.ammoMax + ']', wx, wy + 22);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px monospace';
      ctx.fillText('[MELEE]', wx, wy + 22);
    }

    // Weapon slots
    for (let i = 0; i < p.weapons.length; i++) {
      const sw = p.weapons[i];
      const sx = wx - 90 + i * 60, sy = wy - 30;
      const isCur = i === p.weaponIdx;
      const scale = isCur ? p.weaponScale : 1;
      
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(scale, scale);
      
      ctx.strokeStyle = isCur ? sw.color : '#444';
      ctx.lineWidth   = isCur ? 2 : 1;
      ctx.globalAlpha = isCur ? 1 : 0.5;
      roundRect(ctx, -22, -8, 44, 16, 3); ctx.stroke();
      ctx.fillStyle   = isCur ? sw.color : '#888';
      ctx.font        = '9px monospace';
      ctx.textAlign   = 'center';
      ctx.textBaseline= 'middle';
      ctx.fillText(sw.name.slice(0, 3).toUpperCase(), 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // Weapon popup name
    if (p.weaponPopupTimer > 0) {
      const alpha = Math.min(1, p.weaponPopupTimer / 0.3);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.weapon.color;
      ctx.font = 'bold 24px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(p.weapon.name.toUpperCase(), CANVAS_W / 2, CANVAS_H / 2 + 100);
      ctx.restore();
    }

    // Boss HP bar (top center, only when boss alive)
    if (game.bossEnemy && game.bossEnemy.alive) {
      const boss = game.bossEnemy;
      const bbw = 420, bbh = 20;
      const bbx = CANVAS_W / 2 - bbw / 2, bby = 12;
      ctx.fillStyle = '#110000';
      roundRect(ctx, bbx - 2, bby - 2, bbw + 4, bbh + 4, 5); ctx.fill();
      const hpFrac = boss.hp / boss.maxHp;
      const barColor = hpFrac > 0.5 ? '#ff4400' : hpFrac > 0.25 ? '#ff8800' : '#ff0000';
      ctx.fillStyle = barColor;
      roundRect(ctx, bbx, bby, Math.max(0, bbw * hpFrac), bbh, 3); ctx.fill();
      ctx.strokeStyle = '#ff6600'; ctx.lineWidth = 2;
      roundRect(ctx, bbx, bby, bbw, bbh, 3); ctx.stroke();
      // Pulse at low HP
      if (hpFrac < 0.25) {
        ctx.globalAlpha = 0.3 + Math.sin(now * 8) * 0.2;
        ctx.fillStyle = '#ff0000';
        roundRect(ctx, bbx, bby, bbw, bbh, 3); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('BOSS  TIER ' + boss.bossTier + '  ' + Math.ceil(boss.hp) + ' / ' + Math.ceil(boss.maxHp),
        CANVAS_W / 2, bby + bbh / 2);
    }

    // --- TOP RIGHT: Level + Enemies ---
    ctx.fillStyle = '#00ffcc';
    ctx.font      = 'bold 28px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('LEVEL ' + game.level, CANVAS_W - 18, 14);

    ctx.fillStyle    = '#ffffff';
    ctx.font         = '13px monospace';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    const living = game.enemies.filter(e => e.alive).length;
    ctx.fillText('ENEMIES: ' + living, CANVAS_W - 18, 50);
    ctx.fillText('KILLS:   ' + game.kills, CANVAS_W - 18, 68);

    // Combo indicator
    if (p.combo >= 2 && p.comboTimer > 0) {
      const ct = Math.min(1, p.comboTimer / 0.5);
      ctx.globalAlpha = ct;
      ctx.fillStyle   = '#ffee00';
      ctx.font        = 'bold 22px monospace';
      ctx.textAlign   = 'center';
      ctx.textBaseline= 'middle';
      ctx.fillText('x' + p.combo + ' COMBO!', CANVAS_W / 2, CANVAS_H - 110);
      ctx.globalAlpha = 1;
    }

    // Dash cooldown indicator (small arc)
    if (p.dashCd > 0) {
      ctx.strokeStyle = '#44ff88';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(bx + bw + 20, by + 20, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - p.dashCd / 0.8));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Super chest prompt (all enemies dead, chest not opened)
    if (game.superChest && !game.superChest.opened && game.enemies.every(e => !e.alive)) {
      const pulse3 = 0.6 + Math.sin(now * 4) * 0.4;
      ctx.globalAlpha = pulse3;
      ctx.fillStyle = '#ffcc44';
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('ALL CLEAR  —  Find the SUPER CHEST  [E]', CANVAS_W / 2, CANVAS_H - 90);
      ctx.globalAlpha = 1;
    }

    // Level-up banner
    if (game.levelFlashTimer > 0) {
      const alpha = Math.min(1, game.levelFlashTimer / 0.3);
      ctx.globalAlpha = alpha;
      ctx.fillStyle   = '#000c';
      ctx.fillRect(CANVAS_W / 2 - 180, CANVAS_H / 2 - 40, 360, 80);
      ctx.fillStyle   = '#00ff88';
      ctx.font        = 'bold 36px monospace';
      ctx.textAlign   = 'center';
      ctx.textBaseline= 'middle';
      ctx.fillText('LEVEL ' + game.level, CANVAS_W / 2, CANVAS_H / 2);
      ctx.globalAlpha = 1;
    }

  } else if (game.state === 'CHEST_SELECT') {
    // ── CHEST SELECTION OVERLAY ──────────────────────────────────────────
    // Dim background (game world still visible underneath)
    ctx.fillStyle = 'rgba(0,0,0,0.80)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Bright flash burst
    ctx.globalAlpha = 0.08 + Math.sin(now * 10) * 0.04;
    ctx.fillStyle = '#ffcc44';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.globalAlpha = 1;

    // Title
    ctx.fillStyle = '#ffcc44';
    ctx.font = 'bold 34px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('LEVEL CLEAR — CHOOSE YOUR BUFF', CANVAS_W / 2, CANVAS_H * 0.18);

    ctx.fillStyle = 'rgba(255,204,68,0.4)';
    ctx.fillRect(CANVAS_W / 2 - 320, CANVAS_H * 0.18 + 22, 640, 2);

    const chest = game.superChest;
    if (chest && chest.choices) {
      const cardW = 240, cardH = 160, cardGap = 24;
      const totalW = cardW * 3 + cardGap * 2;
      const startX = CANVAS_W / 2 - totalW / 2;
      const cardY = CANVAS_H * 0.34;

      chest.choices.forEach((type, i) => {
        const def = PERK_DEFS[type];
        const cx = startX + i * (cardW + cardGap);

        // Card bg
        ctx.fillStyle = 'rgba(8,8,22,0.97)';
        roundRect(ctx, cx, cardY, cardW, cardH, 10); ctx.fill();
        // Border glow
        ctx.strokeStyle = def.color; ctx.lineWidth = 2.5;
        roundRect(ctx, cx, cardY, cardW, cardH, 10); ctx.stroke();
        // Inner glow
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = def.color;
        roundRect(ctx, cx, cardY, cardW, cardH, 10); ctx.fill();
        ctx.restore();

        // Key hint
        ctx.fillStyle = def.color;
        ctx.font = 'bold 18px monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText('[' + (i + 1) + ']', cx + 12, cardY + 12);

        // Icon
        ctx.fillStyle = def.color;
        ctx.font = 'bold 36px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.shadowBlur = 12; ctx.shadowColor = def.color;
        ctx.fillText(def.icon, cx + cardW / 2, cardY + 66);
        ctx.shadowBlur = 0;

        // Name
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 15px monospace';
        ctx.fillText(def.name, cx + cardW / 2, cardY + 108);

        // Stack / diminishing returns note
        const existing = game.player.perks.find(pp => pp.type === type);
        if (existing) {
          const eff = Math.round(Math.pow(0.7, existing.stacks) * 100);
          ctx.fillStyle = '#aaaaaa';
          ctx.font = '11px monospace';
          ctx.fillText('(' + eff + '% effective)', cx + cardW / 2, cardY + 130);
        }
      });
    }

    // Currently held perks
    if (p.perks.length > 0) {
      ctx.fillStyle = '#888888';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('ACTIVE PERKS: ' + p.perks.map(pp => PERK_DEFS[pp.type].icon + (pp.stacks > 1 ? 'x' + pp.stacks : '')).join('  '),
        CANVAS_W / 2, CANVAS_H * 0.88);
    }

  } else if (game.state === 'GAME_OVER') {
    // Game over screen
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Title
    ctx.fillStyle = '#ff2244';
    ctx.font      = 'bold 56px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('YOU DIED', CANVAS_W / 2, CANVAS_H / 2 - 130);

    // Neon underline
    ctx.strokeStyle = '#ff2244';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(CANVAS_W / 2 - 200, CANVAS_H / 2 - 96);
    ctx.lineTo(CANVAS_W / 2 + 200, CANVAS_H / 2 - 96);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Stats
    const elapsed  = Math.floor(game.survivalTime);
    const minutes  = Math.floor(elapsed / 60);
    const seconds  = elapsed % 60;
    const statColor = '#aaccff';
    const stats = [
      ['LEVEL REACHED', game.level],
      ['TOTAL KILLS',   game.kills],
      ['TIME SURVIVED', minutes + ':' + String(seconds).padStart(2, '0')],
    ];

    ctx.font = '20px monospace';
    ctx.textAlign = 'center';
    stats.forEach(([label, val], i) => {
      ctx.fillStyle = statColor;
      ctx.fillText(label + ':  ' + val, CANVAS_W / 2, CANVAS_H / 2 - 40 + i * 36);
    });

    // Restart button
    const bw2 = 220, bh2 = 52, bx2 = CANVAS_W / 2 - bw2 / 2, by2 = CANVAS_H / 2 + 90;
    const pulse2 = 0.7 + Math.sin(now * 3) * 0.3;
    ctx.strokeStyle = `rgba(0,255,136,${pulse2})`;
    ctx.lineWidth   = 2.5;
    ctx.fillStyle   = 'rgba(0,40,20,0.8)';
    roundRect(ctx, bx2, by2, bw2, bh2, 8);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle    = '#00ff88';
    ctx.font         = 'bold 22px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('[ RESTART ]', CANVAS_W / 2, by2 + bh2 / 2);

    game._restartBtn = { x: bx2, y: by2, w: bw2, h: bh2 };
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// =============================================================================
// 18. GAME CONTROLLER
// =============================================================================
class Game {
  constructor(canvas) {
    this.canvas     = canvas;
    this.state      = 'PLAYING';
    this.level      = 1;
    this.seed       = Date.now();
    this.rng        = new RNG(this.seed);
    this.kills      = 0;
    this.survivalTime = 0;

    this.dungeon    = null;
    this.player     = null;
    this.enemies    = [];
    this.projectiles = [];
    this.explosions  = [];
    this.floatingTexts = [];
    this.muzzleFlash = { active: false };

    this.particles   = new ParticleSystem(2000);
    this.projPool    = new Pool(
      () => new Projectile(),
      p  => { p.alive = false; },
      200
    );

    this.camera      = new Camera();
    this.input       = new InputHandler(canvas);
    this.renderer    = new Renderer(canvas);
    this.difficulty  = new DifficultyManager();

    this.hitStopTimer    = 0;
    this.hitFlashTimer   = 0;
    this.levelFlashTimer = 0;

    this.superChest = null;
    this._superChestSpawned = false;
    this.bossEnemy  = null;

    this._restartBtn = null;
    this.lastTime    = performance.now();

    this._generateLevel(true);
  }

  _generateLevel(fresh = false) {
    this.dungeon  = new DungeonGenerator(this.rng, this.level).generate();
    this.renderer.bgDirty = true;
    this.difficulty.level = this.level;
    this.superChest = null;
    this._superChestSpawned = false;
    this.bossEnemy  = null;

    const spawn = this.dungeon.spawnRoom;
    const sx    = (spawn.cx * TILE + TILE / 2);
    const sy    = (spawn.cy * TILE + TILE / 2);

    if (!this.player || fresh) {
      this.player = new Player(sx, sy);
    } else {
      this.player.x = sx; this.player.y = sy;
      this.player.vx = 0; this.player.vy = 0;
      this.player.weapons.forEach(w => { if (w.pellets > 0) w.ammo = Math.min(w.ammoMax, w.ammo + Math.floor(w.ammoMax * 0.4)); });
      this.player.potions = Math.min(this.player.potionCapacity, this.player.potions + 1);
    }

    // Unlock weapons at certain levels
    if (this.level >= 3 && this.player.weapons[1].ammo === 0) this.player.weapons[1].ammo = WEAPON_DEFS.SHOTGUN.ammoMax;
    if (this.level >= 5 && this.player.weapons[2].ammo === 0) this.player.weapons[2].ammo = WEAPON_DEFS.SMG.ammoMax;

    // Spawn enemies — with boss evolution at multiples of 10
    this.enemies = [];
    let bossSpawned = false;
    for (const room of this.dungeon.rooms) {
      if (room.type === ROOM_SPAWN) continue;
      for (const ed of room.enemies) {
        const EClass = { GOBLIN: Goblin, OGRE: Ogre, ARCHER: SkeletonArcher, WRAITH: ShadowWraith }[ed.type] || Enemy;
        const enemy = new EClass(ed.tx, ed.ty, this.level, this);
        // Boss evolution: every 10 levels, elevate the first Ogre in a boss room
        if (!bossSpawned && room.type === ROOM_BOSS && ed.type === 'OGRE' && this.level % 10 === 0) {
          bossSpawned = true;
          enemy.isBoss   = true;
          enemy.bossTier = Math.floor(this.level / 10);
          const tier = enemy.bossTier;
          enemy.hp     *= Math.pow(1.4, tier); enemy.maxHp *= Math.pow(1.4, tier);
          enemy.damage *= Math.pow(1.2, tier);
          enemy.radius *= 1.3;
          enemy.telegraphRadius = 130 + tier * 22;
          this.bossEnemy = enemy;
        }
        this.enemies.push(enemy);
      }
    }

    this.explosions = [];
    this.projectiles = [];
    this.floatingTexts = [];
    this.camera.x = sx - CANVAS_W / 2;
    this.camera.y = sy - CANVAS_H / 2;
    this.levelFlashTimer = 1.2;
  }

  triggerHitStop() { this.hitStopTimer = 0.05; }

  spawnExplosion(x, y, radius, damage) {
    this.explosions.push({ x, y, radius, damage, timer: 0.45, maxTimer: 0.45 });
    this.camera.shake(7, 0.3);
    this.particles.burst(x, y, 25, { color: '#ff6600', type: 'glow', speed: 150, life: 0.5 });
    this.particles.burst(x, y, 15, { color: '#ffaa00', type: 'spark', speed: 200, life: 0.3 });
    // AOE damage
    if (dist2(x, y, this.player.x, this.player.y) < radius + this.player.radius) {
      this.player.takeDamage(damage, this);
    }
  }

  onEnemyKilled(enemy) {
    this.kills++;
    this.particles.burst(enemy.x, enemy.y, 18, { color: enemy.color, type: 'blood', speed: 90, life: 0.5 });
    this.particles.burst(enemy.x, enemy.y, 6,  { color: enemy.color, type: 'glow',  speed: 60, life: 0.4 });
    // Blood decal
    if (this.dungeon.decals.length < 80) {
      this.dungeon.decals.push({ x: enemy.x + (Math.random()-0.5)*10, y: enemy.y + (Math.random()-0.5)*10,
        r: 6 + Math.random() * 8, color: enemy.color, alpha: 0.6 });
    }
  }

  _checkLevelComplete(ePress = false) {
    if (this.state !== 'PLAYING') return;
    const allDead = this.enemies.every(e => !e.alive);
    if (!allDead) return;

    // Spawn Super Chest once at exit room center
    if (!this._superChestSpawned) {
      this._superChestSpawned = true;
      const exit = this.dungeon.exitRoom;
      if (exit) {
        const ex = exit.cx * TILE + TILE / 2;
        const ey = exit.cy * TILE + TILE / 2;
        this.superChest = new SuperChest(ex, ey);
        this.levelFlashTimer = 0.8;
      }
    }

    // Player interacts with Super Chest → CHEST_SELECT
    if (this.superChest && !this.superChest.opened && ePress) {
      if (this.superChest.tryOpen(this.player, this)) {
        this.state = 'CHEST_SELECT';
      }
    }
  }

  _checkPickups(interact = false) {
    const p = this.player;
    
    for (let i = this.dungeon.items.length - 1; i >= 0; i--) {
      const item = this.dungeon.items[i];
      if (!item.alive) { this.dungeon.items.splice(i, 1); continue; }
      
      const d = dist2(p.x, p.y, item.x, item.y);
      if (d < p.radius + item.radius + 15) {
        // If it's a potion, armor or buff, pick up on touch. 
        // If it's ammo, pick up with E.
        let picked = false;
        let text = '';
        
        if (item.type === 'AMMO') {
          if (interact) {
            const w = p.weapons.find(w => w.name.toUpperCase() === item.ammoType);
            if (w && w.ammo < w.ammoMax) {
              const add = Math.min(item.ammoAmount, w.ammoMax - w.ammo);
              w.ammo += add;
              text = '+' + add + ' ' + w.name.toUpperCase();
              picked = true;
            }
          }
        } else if (item.type === 'POTION' || item.type === 'ARMOR' || item.type.startsWith('BUFF')) {
          if (item.type === 'POTION') { p.hp = Math.min(p.maxHp, p.hp + 35); text = '+35 HP'; }
          else if (item.type === 'ARMOR') { p.armor = Math.min(p.maxArmor, p.armor + 20); text = '+20 ARMOR'; }
          else if (item.type === 'BUFF_DMG') { p.buffDmg = item.duration; text = 'DMG BOOST!'; }
          else if (item.type === 'BUFF_SPD') { p.buffSpd = item.duration; text = 'SPD BOOST!'; }
          picked = true;
        }

        if (picked) {
          item.alive = false;
          this.dungeon.items.splice(i, 1);
          this.particles.burst(item.x, item.y, 12, { color: item.color, type: 'glow', speed: 60, life: 0.4 });
          if (text) {
            this.floatingTexts.push(new FloatingText(item.x, item.y - 20, text, item.color));
          }
        }
      }
    }
  }

  _gameOver() {
    this.state = 'GAME_OVER';
    this.difficulty.earlyDeaths++;
  }

  restart() {
    this.seed      = Date.now();
    this.rng       = new RNG(this.seed);
    this.level     = 1;
    this.kills     = 0;
    this.survivalTime = 0;
    this.player     = null;
    this.enemies   = [];
    this.projectiles = [];
    this.explosions  = [];
    this.floatingTexts = [];
    this.hitFlashTimer = 0;
    this.levelFlashTimer = 0;
    this.superChest = null;
    this._superChestSpawned = false;
    this.bossEnemy  = null;
    this.state = 'PLAYING';
    this._generateLevel(true);
  }

  update(dt) {
    if (this.state === 'GAME_OVER') return;

    // CHEST_SELECT: freeze game, handle perk choice
    if (this.state === 'CHEST_SELECT') {
      const chest = this.superChest;
      if (chest && chest.choices) {
        for (let i = 0; i < 3; i++) {
          if (this.input.justPressed('Digit' + (i + 1))) {
            this.player.addPerk(chest.choices[i], this);
            this.superChest = null;
            this.state = 'PLAYING';
            this.level++;
            this._generateLevel(false);
            this.input.flush();
            return;
          }
        }
      }
      this.input.flush();
      return;
    }

    this.survivalTime += dt;

    // Hit stop time scale
    const eff = this.hitStopTimer > 0 ? dt * 0.06 : dt;
    this.hitStopTimer    = Math.max(0, this.hitStopTimer    - dt);
    this.hitFlashTimer   = Math.max(0, this.hitFlashTimer   - dt);
    this.levelFlashTimer = Math.max(0, this.levelFlashTimer - dt);
    if (this.muzzleFlash.active) {
      this.muzzleFlash.timer -= dt;
      if (this.muzzleFlash.timer <= 0) this.muzzleFlash.active = false;
    }

    this.camera.follow(this.player, dt);
    this.player.update(eff, this.input, this.dungeon, this);

    // Update enemies (skip if offscreen and idle)
    const camCx = this.camera.x + CANVAS_W / 2;
    const camCy = this.camera.y + CANVAS_H / 2;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const offscreen = dist2(e.x, e.y, camCx, camCy) > 1400;
      if (offscreen && e.state === 'idle') continue;
      e.update(eff, this.player, this.dungeon, this);
    }

    // Remove dead enemies
    this.enemies = this.enemies.filter(e => e.alive);

    // Projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      if (!proj.alive) { this.projectiles.splice(i, 1); this.projPool.free(proj); continue; }
      proj.update(eff, this.dungeon.map, this.dungeon.mapW, this.particles);

      if (!proj.alive) { this.projectiles.splice(i, 1); this.projPool.free(proj); continue; }

      // Hit detection
      if (proj.owner === 'player') {
        // Enemies
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (dist2(proj.x, proj.y, e.x, e.y) < proj.radius + e.radius) {
            e.takeDamage(proj.damage, this);
            // Lifesteal on hit
            if (this.player.lifesteal > 0) {
              const steal = proj.damage * this.player.lifesteal;
              this.player.hp = Math.min(this.player.maxHp, this.player.hp + steal);
            }
            this.triggerHitStop();
            this.camera.shake(2, 0.08);
            this.particles.burst(proj.x, proj.y, 6, { color: proj.color, type: 'spark', speed: 90, life: 0.2 });
            proj.alive = false;
            break;
          }
        }
        if (!proj.alive) { this.projectiles.splice(i, 1); this.projPool.free(proj); continue; }
        
        // Crates
        for (const c of this.dungeon.crates) {
          if (!c.alive) continue;
          if (dist2(proj.x, proj.y, c.x, c.y) < proj.radius + c.radius) {
            c.takeDamage(proj.damage, this);
            this.camera.shake(1.5, 0.08);
            proj.alive = false;
            break;
          }
        }
        if (!proj.alive) { this.projectiles.splice(i, 1); this.projPool.free(proj); continue; }
      } else {
        // Enemy projectile → player
        if (dist2(proj.x, proj.y, this.player.x, this.player.y) < proj.radius + this.player.radius) {
          this.player.takeDamage(proj.damage, this);
          proj.alive = false;
          this.projectiles.splice(i, 1);
          this.projPool.free(proj);
        }
      }
    }

    // Explosions
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      this.explosions[i].timer -= dt;
      if (this.explosions[i].timer <= 0) this.explosions.splice(i, 1);
    }

    // Floating texts
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      this.floatingTexts[i].update(dt);
      if (!this.floatingTexts[i].alive) this.floatingTexts.splice(i, 1);
    }

    // Particles
    this.particles.update(eff);

    // Items
    for (const item of this.dungeon.items) item.update(eff);

    // Crates
    for (const c of this.dungeon.crates) c.update(eff);

    // Super chest
    if (this.superChest) this.superChest.update(eff);

    const ePress = this.input.justPressed('KeyE');
    this._checkPickups(ePress);
    this._checkLevelComplete(ePress);
    this.input.flush();

    if (!this.player.alive) this._gameOver();
  }

  frame(timestamp) {
    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05);
    this.lastTime = timestamp;

    this.update(dt);
    this.renderer.frame(this);
    renderUI(this.renderer.ctx, this, timestamp * 0.001);

    requestAnimationFrame(ts => this.frame(ts));
  }
}

// =============================================================================
// 19. ENTRY POINT
// =============================================================================
window.addEventListener('load', () => {
  const canvas = document.getElementById('gameCanvas');
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;

  // Responsive scaling
  const resize = () => {
    const scaleX = window.innerWidth  / CANVAS_W;
    const scaleY = window.innerHeight / CANVAS_H;
    const scale  = Math.min(scaleX, scaleY);
    canvas.style.width  = Math.floor(CANVAS_W * scale) + 'px';
    canvas.style.height = Math.floor(CANVAS_H * scale) + 'px';
  };
  resize();
  window.addEventListener('resize', resize);

  const game = new Game(canvas);

  canvas.addEventListener('click', e => {
    if (game.state !== 'GAME_OVER' || !game._restartBtn) return;
    const r  = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / r.width;
    const scaleY = CANVAS_H / r.height;
    const cx = (e.clientX - r.left) * scaleX;
    const cy = (e.clientY - r.top)  * scaleY;
    const b  = game._restartBtn;
    if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
      game.restart();
    }
  });

  requestAnimationFrame(ts => { game.lastTime = ts; game.frame(ts); });
});
