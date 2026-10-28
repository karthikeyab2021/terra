'use strict';
/* THE BOOK OF REALMS: STICKMAN COMBAT  (Stage 1)
   Sections: 1 config, 2 input, 3 fighter, 4 combat, 5 AI, 6 rendering, 7 game flow, 8 main loop. */

// ===== 1. CONFIG =====
const W = 960, H = 540, GROUND = 460, ARENA_L = 50, ARENA_R = 910;
const STEP = 1 / 60, ROUND_TIME = 60;
const PHYS = { gravity: 2400, jump: 880, speed: 270, friction: 2600 };
const DASH = { dur: .22, speed: 760, cooldown: .8 };   // fast burst of movement, no invulnerability
const SHIELD = { dur: 1.0, cooldown: 3.5, damageTaken: .4, speedMul: .4 }; // the dodge: takes 40% damage, not 0%
const BOLT = { cooldown: .4, speed: 860, damage: 4, knock: 70, pop: 0, stun: .12, shake: 1, stop: .02, life: 1.3 }; // small light bullets
// Hitbox values are relative to the fighter's feet; "reach" extends in the facing direction.
const ATTACKS = {
  light: { startup: .07, active: .08, recovery: .16, damage: 6, reach: 62, top: -116, bottom: -70, knock: 170, pop: 0, stun: .24, shake: 2, stop: .04, pose: 'punch' },
  heavy: { startup: .20, active: .10, recovery: .32, damage: 14, reach: 86, top: -84, bottom: -12, knock: 360, pop: 260, stun: .42, shake: 6, stop: .09, pose: 'kick' },
  bolt: { startup: .08, active: .02, recovery: .12, proj: true, pose: 'punch' } // throws a projectile, no melee hitbox
};
const REALMS = {
  heaven: { name: 'Celestial Dominion', element: 'Light', boltName: 'Light Bullets',
    boltIcon: '<svg viewBox="0 0 32 32"><g fill="#fff" stroke="#ffd24a" stroke-width="1.5"><circle cx="24" cy="10" r="3"/><circle cx="24" cy="16" r="3"/><circle cx="24" cy="22" r="3"/></g><path d="M6 10h13M6 16h13M6 22h13" stroke="#ffd24a" stroke-width="2" stroke-linecap="round"/></svg>',
    colors: [{ color: '#8a5200', glow: '#ffb938' }, { color: '#1c4a99', glow: '#4aa8ff' }],
    flash: '#e8442a', flashGlow: '#ff7a5c', shadow: 'rgba(40,60,110,.3)', spark: ['#ffc933', '#4aa8ff'] },
  hell: { name: 'Ashen Throne', element: 'Fire', boltName: 'Fireballs',
    boltIcon: '<svg viewBox="0 0 32 32"><path d="M3 16c8-6 13-5 17 0-4 5-9 6-17 0z" fill="#ff5a1a" opacity=".8"/><circle cx="22" cy="16" r="6" fill="#ffd24a" stroke="#ff3b1a" stroke-width="2"/></svg>',
    colors: [{ color: '#fff0c8', glow: '#ff8a1a' }, { color: '#a8ecff', glow: '#27c4ff' }],
    flash: '#ff3b1f', flashGlow: '#ff3b1f', shadow: 'rgba(0,0,0,.45)', spark: ['#ff7a1a', '#ffe08a'] }
};
const R = () => REALMS[Game.realm]; // the realm currently being fought in
const BINDS = [
  { left: 'KeyA', right: 'KeyD', jump: 'KeyW', light: 'KeyJ', heavy: 'KeyK', bolt: 'KeyU', dash: 'ShiftLeft', shield: 'KeyL' },
  { left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp', light: 'Numpad1', heavy: 'Numpad2', bolt: 'Numpad4', dash: 'Numpad0', shield: 'Numpad3' }
];
const AI_LEVELS = { easy: { think: .45, aggr: .30, defend: .05, bolt: .15 }, normal: { think: .25, aggr: .50, defend: .25, bolt: .30 }, hard: { think: .12, aggr: .75, defend: .50, bolt: .40 } };
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const total = d => d.startup + d.active + d.recovery;

// ===== 2. INPUT =====
// "down" = currently held keys. "pressed" = keys that went down since the last physics step (one-shot actions).
const Input = {
  down: new Set(), pressed: new Set(),
  endStep() { this.pressed.clear(); },
  clear() { this.down.clear(); this.pressed.clear(); }
};
const GAME_KEYS = new Set(BINDS.flatMap(b => Object.values(b)));
addEventListener('keydown', e => {
  if (Game.state === 'playing' && GAME_KEYS.has(e.code)) e.preventDefault(); // stop page scrolling
  if (e.repeat) return;
  if (e.code === 'Escape' || e.code === 'KeyP') togglePause();
  if (e.code === 'KeyH') Game.debug = !Game.debug;
  Input.down.add(e.code); Input.pressed.add(e.code);
});
addEventListener('keyup', e => Input.down.delete(e.code));
addEventListener('blur', () => { Input.clear(); if (Game.state === 'playing') togglePause(); });

function humanController(n) {
  const b = BINDS[n];
  return () => ({
    left: Input.down.has(b.left), right: Input.down.has(b.right),
    jump: Input.pressed.has(b.jump), light: Input.pressed.has(b.light), heavy: Input.pressed.has(b.heavy),
    bolt: Input.pressed.has(b.bolt), dash: Input.pressed.has(b.dash), shield: Input.pressed.has(b.shield)
  });
}
const NO_INPUT = { left: false, right: false, jump: false, light: false, heavy: false, bolt: false, dash: false, shield: false };

// ===== 3. FIGHTER =====
class Fighter {
  constructor(o) { Object.assign(this, o); this.reset(); }
  reset() {
    this.x = this.spawn; this.y = GROUND; this.vx = 0; this.vy = 0; this.facing = this.spawn < W / 2 ? 1 : -1;
    this.health = 100; this.stun = 0; this.flash = 0; this.attack = null; this.buf = null;
    this.ko = false; this.onGround = true; this.animT = 0; this.dash = null; this.boltCd = 0; this.dashCd = 0; this.shield = null; this.shieldCd = 0; this.shieldFlash = 0; this.koT = 0; this.burst = false;
  }
  faceTo(foe) { this.facing = foe.x >= this.x ? 1 : -1; }
  phase() {
    if (!this.attack) return null;
    const d = ATTACKS[this.attack.type], t = this.attack.t;
    return t < d.startup ? 'startup' : t < d.startup + d.active ? 'active' : 'recovery';
  }
  spawnBolt() { // called every step; launches the bolt once, when the throw's startup ends
    const a = this.attack;
    if (a.type !== 'bolt' || a.hit || a.t < ATTACKS.bolt.startup) return;
    a.hit = true;
    Game.projectiles.push({ x: this.x + this.facing * 24, y: this.y - 86, vx: this.facing * BOLT.speed, owner: this, life: BOLT.life, spin: 0 });
  }
  update(dt, foe, inp) {
    this.animT += dt; this.flash = Math.max(0, this.flash - dt); this.shieldFlash = Math.max(0, this.shieldFlash - dt);
    if (this.ko) this.koT += dt;
    if (this.shield && (this.shield.t += dt) >= SHIELD.dur) this.shield = null;
    this.boltCd = Math.max(0, this.boltCd - dt); this.dashCd = Math.max(0, this.dashCd - dt); this.shieldCd = Math.max(0, this.shieldCd - dt);
    if (this.stun > 0) this.stun -= dt;
    const free = !this.ko && this.stun <= 0;
    if (free) {
      if (!this.attack) this.faceTo(foe);
      // Dash: a fast burst in the held direction (forward if none is held).
      if (inp.dash && !this.attack && !this.dash && this.dashCd <= 0) {
        this.dash = { t: 0, dir: (inp.right ? 1 : 0) - (inp.left ? 1 : 0) || this.facing };
        this.dashCd = DASH.cooldown; this.buf = null;
      }
      // Dodge shield: reduces damage while it lasts. You cannot attack while it is up.
      if (inp.shield && !this.attack && !this.dash && !this.shield && this.shieldCd <= 0) { this.shield = { t: 0 }; this.shieldCd = SHIELD.cooldown; this.buf = null; }
      if (this.dash) {
        this.dash.t += dt; this.vx = this.dash.dir * DASH.speed;
        if (this.dash.t >= DASH.dur) { this.dash = null; this.vx *= .2; }
      }
      // Input buffering: an attack pressed during recovery fires as soon as the fighter is free.
      if (inp.light) this.buf = { type: 'light', t: .15 };
      if (inp.heavy) this.buf = { type: 'heavy', t: .15 };
      if (inp.bolt) this.buf = { type: 'bolt', t: .15 };
      if (this.buf && (this.buf.t -= dt) <= 0) this.buf = null;
      if (!this.attack && !this.dash && !this.shield && this.buf) {
        const type = this.buf.type; this.buf = null;
        if (type !== 'bolt' || this.boltCd <= 0) { // a bolt on cooldown is simply ignored
          this.attack = { type, t: 0, hit: false };
          if (type === 'bolt') this.boltCd = BOLT.cooldown;
        }
      }
      if (this.attack) {
        this.attack.t += dt; this.spawnBolt();
        if (this.attack.t >= total(ATTACKS[this.attack.type])) this.attack = null;
      }
      const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), sp = PHYS.speed * (this.shield ? SHIELD.speedMul : 1);
      if (!this.attack && !this.dash) {
        if (this.onGround) { this.vx = dir * sp; if (inp.jump) { this.vy = -PHYS.jump; this.onGround = false; } }
        else this.vx += (dir * sp - this.vx) * Math.min(1, 6 * dt); // air control
      }
    }
    this.vy += PHYS.gravity * dt; this.y += this.vy * dt; this.x += this.vx * dt;
    if (this.y >= GROUND) { this.y = GROUND; this.vy = 0; this.onGround = true; } else this.onGround = false;
    if (this.onGround && (!free || this.attack)) { // ground friction while stunned or attacking
      const d = PHYS.friction * dt;
      this.vx = Math.abs(this.vx) <= d ? 0 : this.vx - Math.sign(this.vx) * d;
    }
    this.x = clamp(this.x, ARENA_L, ARENA_R);
  }
}

// ===== 4. COMBAT =====
const rectsOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const hurtbox = f => ({ x: f.x - 20, y: f.y - 124, w: 40, h: 124 });
function hitbox(f) {
  const d = ATTACKS[f.attack.type], x0 = f.x + f.facing * 14, x1 = f.x + f.facing * (14 + d.reach);
  return { x: Math.min(x0, x1), y: f.y + d.top, w: Math.abs(x1 - x0), h: d.bottom - d.top };
}
function applyHit(dir, b, d) { // dir: +1 pushes the target right, -1 left. d: any damage definition.
  const shielded = !!b.shield;
  b.health = Math.max(0, b.health - d.damage * (shielded ? SHIELD.damageTaken : 1));
  if (shielded) { // dodge shield: reduced (not zero) damage, little knockback, no stun, shield stays up
    b.vx = dir * d.knock * .3; b.shieldFlash = .18; Game.hitstop = d.stop * .5; Game.shake = d.shake * .4;
    spark(b.x - dir * 55, b.y - 70, R().spark[0], 8);
  } else {
    b.stun = d.stun; b.attack = null; b.dash = null; b.buf = null; b.flash = .12; b.facing = -dir;
    b.vx = dir * d.knock; if (d.pop) { b.vy = -d.pop; b.onGround = false; }
    Game.hitstop = d.stop; Game.shake = d.shake;
    spark(b.x - dir * 6, b.y - 90, R().spark[0], 10 + d.damage); spark(b.x, b.y - 90, R().spark[1], 6);
  }
  if (b.health <= 0) knockOut(b, dir);
}
function knockOut(b, dir) { // defeat: slow motion, light burst, shock rings, then the body dissolves upward as light
  b.ko = true; b.shield = null; b.dash = null; b.attack = null; b.vx = dir * 420; b.vy = -300; b.onGround = false;
  Game.slow = .9; Game.flash = 1; Game.shake = 14; Game.hitstop = .12; Game.rings.push({ x: b.x, y: b.y - 70, t: 0, fire: Game.realm === 'hell' });
  spark(b.x, b.y - 70, R().spark[0], 50); spark(b.x, b.y - 70, R().spark[1], 25);
}
function resolveHit(a, b) {
  if (!a.attack || a.attack.hit || a.ko || b.ko || a.phase() !== 'active') return;
  const d = ATTACKS[a.attack.type];
  if (d.proj || !rectsOverlap(hitbox(a), hurtbox(b))) return;
  a.attack.hit = true; // one hit per swing: this flag prevents damage every frame
  applyHit(a.facing, b, d);
}
function updateProjectiles(dt, a, b) {
  for (const s of Game.projectiles) {
    s.x += s.vx * dt; s.life -= dt;
    Game.particles.push({ x: s.x, y: s.y, vx: 0, vy: Game.realm === 'hell' ? -40 : 0, g: 0, life: .16, max: .16, size: 3, color: Game.realm === 'hell' ? (Math.random() < .5 ? '#ff7a1a' : '#ffd24a') : s.owner.glow });
    const t = s.owner === a ? b : a;
    if (!t.ko && rectsOverlap({ x: s.x - 8, y: s.y - 8, w: 16, h: 16 }, hurtbox(t))) { applyHit(Math.sign(s.vx), t, BOLT); s.life = 0; }
    else if (s.x < ARENA_L - 30 || s.x > ARENA_R + 30) { spark(s.x, s.y, R().spark[0], 5); s.life = 0; } // hits the arena edge
  }
  Game.projectiles = Game.projectiles.filter(s => s.life > 0);
}
function separate(a, b) { // stop fighters standing inside each other
  if (a.ko || b.ko || a.y < GROUND - 60 || b.y < GROUND - 60) return;
  const dx = b.x - a.x, ov = 34 - Math.abs(dx);
  if (ov <= 0) return;
  const dir = dx === 0 ? 1 : Math.sign(dx);
  a.x = clamp(a.x - dir * ov / 2, ARENA_L, ARENA_R); b.x = clamp(b.x + dir * ov / 2, ARENA_L, ARENA_R);
}
function spark(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, s = 80 + Math.random() * 280;
    Game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: .35 + Math.random() * .25, max: .6, size: 1.5 + Math.random() * 2.5, color });
  }
}

// ===== 5. AI =====
// The AI only produces an input object, exactly like a human. It follows the same rules as the player.
function makeAI(level) {
  const P = AI_LEVELS[level] || AI_LEVELS.normal;
  let timer = 0, retreat = 0, held = { left: false, right: false }, pending = null;
  return (me, foe, dt) => {
    timer -= dt;
    if (timer <= 0) {
      timer = P.think * (.7 + Math.random() * .6);
      const dx = foe.x - me.x, dist = Math.abs(dx), toward = dx > 0 ? 'right' : 'left', away = dx > 0 ? 'left' : 'right';
      const incoming = Game.projectiles.some(s => s.owner !== me && Math.abs(s.x - me.x) < 220 && Math.sign(s.vx) === Math.sign(me.x - s.x));
      held = { left: false, right: false }; retreat = Math.max(0, retreat - 1);
      if (retreat > 0) held[away] = true;
      else if (incoming && Math.random() < P.defend) pending = 'shield';
      else if (foe.attack && dist < 120 && Math.random() < P.defend) { if (Math.random() < .5) pending = 'shield'; else { retreat = 2; held[away] = true; } }
      else if (dist > 150 && Math.random() < P.bolt) pending = 'bolt';
      else if (dist > 220 && Math.random() < .15) { held[toward] = true; pending = 'dash'; }
      else if (dist > 85) { held[toward] = true; if (Math.random() < .08) pending = 'jump'; }
      else {
        const r = Math.random();
        if (r < P.aggr) pending = Math.random() < .65 ? 'light' : 'heavy';
        else if (r < P.aggr + .25) retreat = 2;
      }
    }
    const inp = { ...NO_INPUT, left: held.left, right: held.right };
    if (pending) { inp[pending] = true; pending = null; }
    return inp;
  };
}

// ===== 6. RENDERING =====
const canvas = $('game'), ctx = canvas.getContext('2d');
function layer() { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }
// Each realm has a sky layer (behind moving effects) and a land layer (in front of them).
const heavenSky = layer(), heavenLand = layer(), hellSky = layer(), hellLand = layer();
function paintHeaven(bgSky, bgLand) {
  let c = bgSky.getContext('2d');
  const sky = c.createLinearGradient(0, 0, 0, GROUND); sky.addColorStop(0, '#6fb6ee'); sky.addColorStop(.55, '#cfe9fb'); sky.addColorStop(1, '#ffffff');
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  ['#ff9eae', '#ffc995', '#fff2a6', '#b9f0b4', '#a9dcff', '#cdb9ff'].forEach((col, i) => { c.strokeStyle = col; c.globalAlpha = .5; c.lineWidth = 11; c.beginPath(); c.arc(W / 2, 440, 420 - i * 11, Math.PI * 1.08, Math.PI * 1.92); c.stroke(); });
  c.globalAlpha = 1;
  const halo = c.createRadialGradient(W / 2, 260, 20, W / 2, 260, 300); halo.addColorStop(0, 'rgba(255,255,255,.95)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = halo; c.fillRect(0, 0, W, H);

  c = bgLand.getContext('2d');
  c.fillStyle = '#a9d886'; c.beginPath(); c.moveTo(0, 440); c.quadraticCurveTo(160, 380, 330, 430); c.quadraticCurveTo(480, 400, 640, 430); c.quadraticCurveTo(800, 385, W, 425); c.lineTo(W, GROUND); c.lineTo(0, GROUND); c.fill();
  const wall = c.createLinearGradient(0, 120, 0, 420); wall.addColorStop(0, '#ffffff'); wall.addColorStop(1, '#f1e8cc'); // the white palace
  c.fillStyle = wall; c.shadowColor = 'rgba(255,240,180,.9)'; c.shadowBlur = 30;
  [[330, 270, 300, 150], [265, 310, 85, 110], [615, 310, 85, 110], [375, 215, 210, 60], [415, 160, 130, 60], [450, 118, 60, 45]].forEach(r => c.fillRect(...r));
  c.shadowBlur = 0; c.fillStyle = '#f0c75a'; c.beginPath(); c.moveTo(450, 118); c.lineTo(480, 70); c.lineTo(510, 118); c.fill();
  c.strokeStyle = 'rgba(190,165,110,.45)'; c.lineWidth = 2;
  for (let x = 345; x < 630; x += 26) { c.beginPath(); c.moveTo(x, 285); c.lineTo(x, 420); c.stroke(); }
  c.fillStyle = 'rgba(240,199,90,.8)'; for (let x = 395; x < 570; x += 34) c.fillRect(x, 232, 10, 22);
  [[85, 330, 24, 85], [135, 365, 17, 55], [880, 325, 26, 90], [830, 360, 17, 58]].forEach(([x, y, rx, ry]) => { // cypress trees
    c.fillStyle = '#2f7a46'; c.beginPath(); c.ellipse(x, y + ry * .5, rx, ry, 0, 0, 6.283); c.fill();
    c.fillStyle = 'rgba(180,240,150,.35)'; c.beginPath(); c.ellipse(x - rx * .3, y + ry * .3, rx * .4, ry * .7, 0, 0, 6.283); c.fill(); });
  [[700, 425, 46], [250, 430, 38]].forEach(([x, y, r]) => { // blossom bushes
    c.fillStyle = '#f19ac0'; c.beginPath(); c.ellipse(x, y, r, r * .55, 0, 0, 6.283); c.fill();
    c.fillStyle = '#5aa86a'; c.beginPath(); c.ellipse(x + r * .5, y + 6, r * .6, r * .4, 0, 0, 6.283); c.fill(); });
  const fl = c.createLinearGradient(0, GROUND, 0, H); fl.addColorStop(0, '#ffffff'); fl.addColorStop(1, '#c9dcf1'); // marble floor
  c.fillStyle = fl; c.fillRect(0, GROUND, W, H - GROUND);
  c.strokeStyle = 'rgba(120,150,200,.35)'; c.lineWidth = 1;
  for (let i = -10; i <= 20; i++) { c.beginPath(); c.moveTo(W / 2 + (i - 5) * 30, GROUND); c.lineTo(W / 2 + (i - 5) * 110, H); c.stroke(); }
  c.strokeStyle = '#ffc533'; c.shadowColor = '#ffc533'; c.shadowBlur = 14; c.lineWidth = 3; c.beginPath(); c.moveTo(0, GROUND); c.lineTo(W, GROUND); c.stroke();
}
function drawHeavenSky(t) { // animated layer between sky and land: light rays, drifting clouds, floating motes
  const c = ctx; c.drawImage(heavenSky, 0, 0);
  c.save(); c.fillStyle = 'rgba(255,240,170,.10)';
  for (let i = 0; i < 5; i++) { const a = -.5 + i * .25 + Math.sin(t * .4 + i) * .05, x = W / 2 + Math.tan(a) * 600; c.beginPath(); c.moveTo(W / 2, -20); c.lineTo(x - 40, 480); c.lineTo(x + 40, 480); c.fill(); }
  [[0, 90, 1], [260, 150, .7], [520, 60, 1.2], [780, 130, .9], [140, 200, .6]].forEach(([x0, y, s], i) => {
    const x = ((x0 + t * (8 + i * 3)) % (W + 300)) - 150; c.fillStyle = 'rgba(255,255,255,.88)'; c.beginPath();
    [[0, 0, 60], [45, -14, 48], [-45, 8, 40], [90, 6, 38]].forEach(([dx, dy, r]) => { c.moveTo(x + (dx + r) * s, y + dy * s); c.ellipse(x + dx * s, y + dy * s, r * s, r * .55 * s, 0, 0, 6.283); });
    c.fill(); });
  c.fillStyle = 'rgba(255,214,90,1)';
  for (let i = 0; i < 26; i++) { const x = (i * 137 + Math.sin(t * .5 + i) * 20) % W, y = H - ((i * 71 + t * (14 + i % 5 * 5)) % (H + 40)); c.globalAlpha = .4 + .4 * Math.sin(t * 2 + i); c.fillRect(x, y, 3, 3); }
  c.restore(); c.drawImage(heavenLand, 0, 0);
}
function paintHell(sky, land) { // lava cave: dark red rock, glowing lava, cracked red floor
  let c = sky.getContext('2d');
  const poly = (pts, fill) => { c.fillStyle = fill; c.beginPath(); pts.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); c.fill(); };
  const wall = c.createLinearGradient(0, 0, 0, GROUND); wall.addColorStop(0, '#4a0716'); wall.addColorStop(.6, '#2b0210'); wall.addColorStop(1, '#1c0108');
  c.fillStyle = wall; c.fillRect(0, 0, W, H);
  poly([[60, 0], [520, 0], [430, 110], [230, 100]], '#6a1022'); poly([[300, 0], [700, 0], [760, 70], [560, 100]], '#52091a');
  poly([[210, 150], [330, 95], [560, 120], [600, 230], [590, 420], [220, 420]], '#2a0000');
  poly([[600, 120], [690, 70], [780, 90], [770, 260], [690, 330], [610, 300]], '#6a1228'); poly([[690, 70], [780, 90], [770, 160], [700, 150]], '#8a1c34');
  poly([[800, 0], [W, 0], [W, 420], [850, 400], [830, 200]], '#3a0612');
  const glow = c.createRadialGradient(W / 2, 430, 20, W / 2, 430, 460); glow.addColorStop(0, 'rgba(255,120,20,.55)'); glow.addColorStop(1, 'rgba(255,60,0,0)');
  c.fillStyle = glow; c.fillRect(0, 0, W, H);

  c = land.getContext('2d');
  [[300, 410, 70, 60], [410, 425, 64, 46], [560, 440, 80, 40]].forEach(([x, y, w, h]) => { // stone stumps standing in the lava
    const g = c.createLinearGradient(0, y - h, 0, y); g.addColorStop(0, '#c4312f'); g.addColorStop(1, '#7a1228');
    c.fillStyle = g; c.fillRect(x - w / 2, y - h, w, h); c.fillStyle = '#2a0a3a'; c.beginPath(); c.ellipse(x, y - h, w / 2, 7, 0, 0, 6.283); c.fill(); });
  poly([[840, 462], [880, 390], [930, 370], [W, 380], [W, 462]], '#6a1228'); poly([[880, 390], [930, 370], [W, 380], [920, 420]], '#8a1c34');
  const fl = c.createLinearGradient(0, GROUND, 0, H); fl.addColorStop(0, '#c4282e'); fl.addColorStop(1, '#6a0f2a'); // cracked rock floor
  c.fillStyle = fl; c.fillRect(0, GROUND, W, H - GROUND);
  c.strokeStyle = '#ffb000'; c.shadowColor = '#ff7a00'; c.shadowBlur = 12; c.lineWidth = 3;
  [[[40, 480], [160, 492], [250, 486]], [[330, 520], [470, 500], [600, 508], [760, 490]], [[640, 470], [720, 478], [900, 472]], [[100, 525], [260, 515]]].forEach(pl => { c.beginPath(); pl.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.stroke(); });
  c.strokeStyle = '#ff7a1a'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, GROUND); c.lineTo(W, GROUND); c.stroke(); c.shadowBlur = 0;
  poly([[0, 0], [120, 0], [165, 240], [150, 462], [0, 462]], '#2e0a2e'); poly([[40, 300], [110, 280], [140, 330], [120, 462], [40, 462]], '#5a1255'); // dark rock at the left edge
  const vg = c.createRadialGradient(W / 2, H / 2, 250, W / 2, H / 2, 620); vg.addColorStop(0, 'rgba(10,0,5,0)'); vg.addColorStop(1, 'rgba(10,0,5,.6)');
  c.fillStyle = vg; c.fillRect(0, 0, W, H);
}
function drawHellSky(t) { // animated lava, bubbles and embers
  const c = ctx; c.drawImage(hellSky, 0, 0);
  const lv = c.createLinearGradient(0, 385, 0, GROUND); lv.addColorStop(0, '#ff3d00'); lv.addColorStop(.5, '#ff9f00'); lv.addColorStop(1, '#ffd21a');
  c.fillStyle = lv; c.fillRect(0, 385, W, GROUND - 383);
  c.save(); c.strokeStyle = 'rgba(255,230,120,.45)'; c.lineWidth = 3;
  for (let i = 0; i < 6; i++) { c.beginPath(); for (let x = 0; x <= W; x += 24) { const y = 398 + i * 11 + Math.sin(x * .02 + t * 1.5 + i * 1.7) * 3; x ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
  for (let i = 0; i < 6; i++) { const ph = (t * .5 + i * .37) % 1, x = 120 + i * 140 + Math.sin(i * 9) * 30, y = 450 - ph * 60, r = 3 + Math.sin(ph * Math.PI) * 7; c.fillStyle = 'rgba(255,225,90,.9)'; c.beginPath(); c.arc(x, y, r, 0, 6.283); c.fill(); }
  c.fillStyle = '#ff9628';
  for (let i = 0; i < 30; i++) { const x = (i * 97 + Math.sin(t * .7 + i) * 25) % W, y = 440 - ((i * 53 + t * (20 + i % 6 * 8)) % 440); c.globalAlpha = .3 + .6 * Math.abs(Math.sin(t * 3 + i)); c.fillRect(x, y, 3, 3); }
  c.restore(); c.drawImage(hellLand, 0, 0);
}
function drawSky(t) { if (Game.realm === 'hell') drawHellSky(t); else drawHeavenSky(t); }
paintHeaven(heavenSky, heavenLand); paintHell(hellSky, hellLand);
function drawFireball(x, y, r, tx, ty) { // (tx, ty) points from the ball toward its flame tail
  const c = ctx; c.save();
  const g = c.createRadialGradient(x, y, 1, x, y, r * 1.6); g.addColorStop(0, '#fff6c0'); g.addColorStop(.35, '#ffd24a'); g.addColorStop(.7, '#ff6a1a'); g.addColorStop(1, 'rgba(220,30,10,0)');
  c.fillStyle = g; c.shadowColor = '#ff5a00'; c.shadowBlur = 20;
  c.globalAlpha = .65; c.beginPath(); c.moveTo(x + tx * r * 3.6, y + ty * r * 3.6); c.lineTo(x - ty * r, y + tx * r); c.lineTo(x + ty * r, y - tx * r); c.closePath(); c.fill(); c.globalAlpha = 1;
  c.beginPath(); c.arc(x, y, r * 1.2, 0, 6.283); c.fill(); c.restore();
}
// ----- Title screen scene: floating islands in a hazy sky; the colours blend to embers when Ashen Throne is selected -----
const MENU_PAL = {
  heaven: { sky: ['#5f7ad4', '#8fa8ea', '#d8e1f8'], rock: '#6d7194', top: '#7cbc62', cloud: '#ffffff', glow: '#fff0c8', wall: '#e9dcc0', roof: '#b4543c', leaf: '#4f9a4a' },
  hell:   { sky: ['#240510', '#7a1a22', '#ff8a3c'], rock: '#3a1420', top: '#c4452a', cloud: '#5a1620', glow: '#ff8c32', wall: '#3a1a1e', roof: '#1a0a0e', leaf: '#6a1a1a' }
};
let menuMix = 0, menuFighters = null; // menuMix: 0 = heaven colours, 1 = hell colours (eases between them)
const hex = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
const mixc = (a, b, k) => { const x = hex(a), y = hex(b); return x.map((v, i) => Math.round(v + (y[i] - v) * k)); };
const rgba = (col, a = 1) => `rgba(${col[0]},${col[1]},${col[2]},${a})`;
function drawIsland(c, x, y, s, alpha, P) {
  c.save(); c.globalAlpha = alpha; c.translate(x, y); c.scale(s, s);
  c.fillStyle = rgba(P.rock); c.beginPath(); c.moveTo(-70, 0); c.lineTo(70, 0); c.lineTo(40, 50); c.lineTo(12, 105); c.lineTo(-8, 70); c.lineTo(-38, 48); c.closePath(); c.fill();
  c.fillStyle = rgba(P.top); c.beginPath(); c.ellipse(0, 0, 72, 13, 0, 0, 6.283); c.fill();
  c.fillStyle = rgba(P.wall); c.fillRect(-28, -30, 24, 24); c.fillStyle = rgba(P.roof); c.beginPath(); c.moveTo(-32, -30); c.lineTo(-16, -46); c.lineTo(0, -30); c.fill();
  c.fillStyle = rgba(P.leaf); c.beginPath(); c.arc(30, -26, 14, 0, 6.283); c.fill(); c.fillRect(28, -14, 4, 12);
  c.restore();
}
function drawMenuBg(t) {
  const c = ctx; menuMix += ((Game.realm === 'hell' ? 1 : 0) - menuMix) * .06;
  const P = {}; for (const k of Object.keys(MENU_PAL.heaven)) P[k] = k === 'sky' ? MENU_PAL.heaven.sky.map((h, i) => mixc(h, MENU_PAL.hell.sky[i], menuMix)) : mixc(MENU_PAL.heaven[k], MENU_PAL.hell[k], menuMix);
  const sky = c.createLinearGradient(0, 0, 0, H); P.sky.forEach((col, i) => sky.addColorStop(i / 2, rgba(col))); c.fillStyle = sky; c.fillRect(0, 0, W, H);
  const gl = c.createRadialGradient(W * .72, H * .3, 10, W * .72, H * .3, 340); gl.addColorStop(0, rgba(P.glow, .6)); gl.addColorStop(1, rgba(P.glow, 0)); c.fillStyle = gl; c.fillRect(0, 0, W, H);
  [[640, 140, .8, .5], [850, 230, 1.1, .75], [560, 320, .6, .4], [920, 70, .5, .35], [120, 150, .55, .35]].forEach(([x, y, s, a], i) => drawIsland(c, x, y + Math.sin(t * .6 + i * 1.3) * 9, s, a, P));
  c.save(); c.fillStyle = rgba(P.cloud, .55); // drifting clouds
  [[0, 330, 1], [300, 380, .8], [620, 300, 1.1], [820, 400, .9]].forEach(([x0, y, s], i) => {
    const x = ((x0 + t * (6 + i * 2)) % (W + 300)) - 150; c.beginPath();
    [[0, 0, 60], [50, -12, 46], [-48, 8, 40], [96, 6, 36]].forEach(([dx, dy, r]) => { c.moveTo(x + (dx + r) * s, y + dy * s); c.ellipse(x + dx * s, y + dy * s, r * s, r * .5 * s, 0, 0, 6.283); }); c.fill(); });
  c.fillStyle = rgba(mixc('#ffffff', '#ffb050', menuMix)); // twinkling diamonds
  for (let i = 0; i < 28; i++) {
    const x = (i * 173 + Math.sin(t * .6 + i) * 18) % W, y = H - ((i * 83 + t * (10 + i % 6 * 5)) % (H + 20)), r = 2 + i % 3;
    c.globalAlpha = .35 + .5 * Math.abs(Math.sin(t * 1.6 + i)); c.beginPath(); c.moveTo(x, y - r * 1.6); c.lineTo(x + r, y); c.lineTo(x, y + r * 1.6); c.lineTo(x - r, y); c.closePath(); c.fill();
  }
  c.restore();
  c.fillStyle = rgba(P.rock.map(v => v * .75 | 0)); c.beginPath(); c.moveTo(0, 412); c.lineTo(340, 412); c.quadraticCurveTo(430, 418, 450, H); c.lineTo(0, H); c.closePath(); c.fill(); // cliff
  c.fillStyle = rgba(P.top); c.fillRect(0, 404, 345, 10); c.beginPath(); c.ellipse(345, 409, 8, 5, 0, 0, 6.283); c.fill();
  if (!menuFighters) { // two stickmen guard the cliff
    menuFighters = [180, 320].map(x => new Fighter({ name: '', spawn: x, color: '#000', glow: '#000', ctrl: null }));
    menuFighters.forEach((f, i) => { f.y = 406; f.groundY = 406; f.facing = i ? -1 : 1; });
  }
  menuFighters.forEach((f, i) => { Object.assign(f, R().colors[i]); f.animT = t + i; drawFighter(f); });
}
function drawKoFx() { // light beam over a defeated fighter, plus expanding shock rings
  const c = ctx;
  Game.fighters.forEach(f => {
    if (!f.ko) return;
    if (Game.realm === 'hell') { // a fireball crashes down on the defeated fighter
      if (f.koT < .35) { const k = f.koT / .35; drawFireball(f.x, lerp(-40, f.y - 50, k * k), 18 + 10 * k, 0, -1); }
      return;
    }
    if (f.koT < .15 || f.koT > 2.7) return;
    const a = clamp(f.koT * 2, 0, 1) * clamp(1 - (f.koT - 1.6), 0, 1), g = c.createLinearGradient(f.x - 45, 0, f.x + 45, 0);
    g.addColorStop(0, 'rgba(255,230,140,0)'); g.addColorStop(.5, `rgba(255,236,150,${.75 * a})`); g.addColorStop(1, 'rgba(255,230,140,0)');
    c.fillStyle = g; c.fillRect(f.x - 45, 0, 90, GROUND + 6);
  });
  for (const r of Game.rings) {
    const k = r.t / 1.1; c.globalAlpha = 1 - k;
    c.strokeStyle = r.fire ? '#ff4a1a' : '#ffb800'; c.lineWidth = 8 * (1 - k) + 1; c.beginPath(); c.arc(r.x, r.y, r.t * 520, 0, 6.283); c.stroke();
    c.strokeStyle = r.fire ? '#ffd24a' : '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(r.x, r.y, r.t * 380, 0, 6.283); c.stroke();
  }
  c.globalAlpha = 1;
}

function pose(f) { // returns joint angles. Angle 0 = forward, PI/2 = down, -PI/2 = up (local, facing right).
  const t = f.animT, P = Math.PI / 2;
  const p = { lean: 0, bob: Math.sin(t * 3) * 1.5, fa: [.8, -.9], ba: [1.1, -.6], fl: [1.35, 1.6], bl: [1.8, 1.55] };
  if (f.ko || f.stun > 0) { p.lean = f.ko ? -.5 : -.3; p.bob = 0; p.fa = [2.3, 2.7]; p.ba = [2.0, 2.4]; p.fl = [1.2, 1.9]; p.bl = [2.0, 2.2]; }
  else if (!f.onGround) { p.bob = 0; p.fl = [1.0, 2.0]; p.bl = [1.8, 2.3]; }
  else if (Math.abs(f.vx) > 20 && !f.attack) {
    const s = Math.sin(t * 14) * .8;
    p.bob = Math.abs(Math.cos(t * 14)) * -3; p.fl = [P + s, P + s + (s < 0 ? .7 : .1)]; p.bl = [P - s, P - s + (s > 0 ? .7 : .1)];
    p.fa = [.9 + s * .5, -.4 + s * .3]; p.ba = [.9 - s * .5, -.4 - s * .3];
  }
  if (f.dash) { p.lean = f.dash.dir * f.facing > 0 ? .45 : -.45; p.bob = 0; p.fl = [.6, 1.2]; p.bl = [2.2, 2.0]; p.fa = [1.2, .3]; p.ba = [2.0, 1.0]; }
  if (f.shield) { p.fa = [-.4, -1.3]; p.ba = [-.2, -1.5]; p.lean = -.08; } // arms raised behind the shield
  if (f.attack) {
    const d = ATTACKS[f.attack.type], a = f.attack.t, ph = f.phase();
    const e = ph === 'startup' ? a / d.startup : ph === 'active' ? 1 : 1 - (a - d.startup - d.active) / d.recovery;
    if (d.pose === 'punch') { p.fa = [lerp(.8, 0, e), lerp(-.9, 0, e)]; p.lean = .15 * e; }
    else { p.fl = [lerp(1.35, -.3, e), lerp(1.6, -.4, e)]; p.lean = -.3 * e; // slanted high kick
       p.fa = [1.4, .5]; p.ba = [2.0, .2]; }
  }
  return p;
}
function limb(c, x, y, [a, b]) { // two segments of length 22
  const mx = x + Math.cos(a) * 22, my = y + Math.sin(a) * 22;
  c.moveTo(x, y); c.lineTo(mx, my); c.lineTo(mx + Math.cos(b) * 22, my + Math.sin(b) * 22);
}
function drawFighter(f) {
  const c = ctx, p = pose(f);
  c.save();
  const sh = clamp(1 - (GROUND - f.y) / 220, .3, 1);
  c.fillStyle = R().shadow; c.beginPath(); c.ellipse(f.x, (f.groundY || GROUND) + 4, 30 * sh, 7 * sh, 0, 0, 6.283); c.fill();
  c.translate(f.x, f.y);
  if (f.ko) { c.translate(0, -6); c.rotate(-f.facing * Math.PI / 2 * .96); }
  c.scale(f.facing, 1);
  c.translate(0, -52 + p.bob); c.rotate(p.lean); // origin is now the hip
  c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 5;
  const hell = Game.realm === 'hell', burn = hell && f.ko ? clamp((f.koT - .4) / 1.2, 0, 1) : 0; // burn: 0..1 as the body chars
  const col = burn > 0 ? (burn < .5 ? '#ff8a2a' : '#2b0f08') : f.flash > 0 ? R().flash : f.color;
  const fade = f.ko ? clamp(1 - (f.koT - (hell ? 1.5 : .9)) / (hell ? 1.1 : 1.5), 0, 1) : f.dash ? .45 : 1; // ghostly while dodging
  c.shadowColor = burn > 0 ? '#ff5a00' : f.flash > 0 ? R().flashGlow : f.glow; c.shadowBlur = burn > 0 ? 26 : f.flash > 0 ? 22 : 12;
  c.strokeStyle = col; c.globalAlpha = .6 * fade; c.beginPath(); limb(c, 0, 0, p.bl); limb(c, 0, -46, p.ba); c.stroke(); // back limbs
  c.globalAlpha = fade; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -46); c.stroke(); // torso
  c.beginPath(); c.arc(0, -60, 11, 0, 6.283); c.stroke(); // head
  c.fillStyle = col; c.lineWidth = 2;
  if (Game.realm === 'heaven') { // Celestial Dominion: a golden halo floats above the head
    c.save(); c.strokeStyle = '#f2a900'; c.shadowColor = '#ffe066'; c.shadowBlur = 12; c.lineWidth = 3;
    c.beginPath(); c.ellipse(1, -80 + Math.sin(f.animT * 3) * 1.5, 10, 3.2, 0, 0, 6.283); c.stroke(); c.restore();
  } else [-1, 1].forEach(s => { c.beginPath(); c.moveTo(s * 7, -68); c.quadraticCurveTo(s * 15, -70, s * 12, -86); c.quadraticCurveTo(s * 6, -77, s * 2.5, -70); c.closePath(); c.fill(); c.stroke(); }); // Ashen Throne: horns
  c.beginPath(); c.arc(5, -61, 1.8, 0, 6.283); c.fill(); // eye on the facing side
  const sw = Math.sin(f.animT * 9) * 3, tr = Math.min(1, Math.abs(f.vx) / 250); // scarf streams behind when moving
  c.lineWidth = 3; c.beginPath(); c.moveTo(0, -44); c.bezierCurveTo(-8, -42 + sw, -16 - 12 * tr, -44 - sw, -24 - 16 * tr, -40 + sw * 1.5); c.stroke(); c.lineWidth = 5;
  c.beginPath(); limb(c, 0, 0, p.fl); limb(c, 0, -46, p.fa); c.stroke(); // front limbs
  c.restore();
  if (f.shield || f.shieldFlash > 0) { // golden shield bubble
    const k = f.shield ? 1 - f.shield.t / SHIELD.dur * .5 : 1, pulse = .8 + Math.sin(f.animT * 14) * .1 + f.shieldFlash * 2;
    const g = c.createRadialGradient(f.x, f.y - 62, 20, f.x, f.y - 62, 70);
    g.addColorStop(0, 'rgba(255,240,170,0)'); g.addColorStop(1, `rgba(255,214,90,${.45 * pulse})`);
    c.save(); c.fillStyle = g; c.strokeStyle = `rgba(255,190,40,${.9 * k})`; c.lineWidth = 3; c.shadowColor = '#ffd24a'; c.shadowBlur = 18;
    c.beginPath(); c.arc(f.x, f.y - 62, 70, 0, 6.283); c.fill(); c.stroke(); c.restore();
  }
  if (f.attack && f.phase() === 'active' && !ATTACKS[f.attack.type].proj) { // swing flash
    const h = hitbox(f); c.save(); c.globalAlpha = .35; c.fillStyle = f.glow; c.beginPath();
    c.ellipse(h.x + h.w / 2, h.y + h.h / 2, h.w / 2, h.h / 2, 0, 0, 6.283); c.fill(); c.restore();
  }
}
function render() {
  const c = ctx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
  c.save();
  if (Game.shake > .3) c.translate((Math.random() - .5) * Game.shake * 2, (Math.random() - .5) * Game.shake * 2);
  if (Game.state === 'menu') drawMenuBg(Game.t); else drawSky(Game.t);
  if (Game.state !== 'menu') {
    Game.fighters.forEach(drawFighter);
    drawKoFx();
    for (const s of Game.projectiles) {
      const d = Math.sign(s.vx);
      if (Game.realm === 'hell') { drawFireball(s.x, s.y, 8, -d, 0); continue; } // fireball with a flame tail
      c.save(); c.shadowColor = s.owner.glow; c.shadowBlur = 14; c.lineCap = 'round'; // light bullet: glowing orb with a short streak
      c.strokeStyle = s.owner.glow; c.lineWidth = 3; c.beginPath(); c.moveTo(s.x - d * 22, s.y); c.lineTo(s.x, s.y); c.stroke();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(s.x, s.y, 5, 0, 6.283); c.fill(); c.lineWidth = 2; c.stroke(); c.restore();
    }
    for (const q of Game.particles) { c.globalAlpha = clamp(q.life / q.max, 0, 1); c.fillStyle = q.color; c.fillRect(q.x, q.y, q.size, q.size); }
    c.globalAlpha = 1;
    if (Game.debug) Game.fighters.forEach(f => {
      c.lineWidth = 1; c.strokeStyle = '#4f4'; const hb = hurtbox(f); c.strokeRect(hb.x, hb.y, hb.w, hb.h);
      if (f.attack && !ATTACKS[f.attack.type].proj) { c.strokeStyle = f.phase() === 'active' ? '#f44' : '#fa4'; const a = hitbox(f); c.strokeRect(a.x, a.y, a.w, a.h); }
    });
  }
  c.restore();
  if (Game.flash > 0) { c.fillStyle = `rgba(${Game.realm === 'hell' ? '255,110,30' : '255,246,210'},${Game.flash * .7})`; c.fillRect(0, 0, W, H); }
}

// ===== 7. GAME FLOW (state machine: menu, playing, paused, matchEnd) =====
const Game = { state: 'menu', mode: 'ai', rounds: 3, round: 1, score: [0, 0], time: ROUND_TIME, phase: 'intro', phaseT: 0,
  hitstop: 0, shake: 0, fighters: [], particles: [], projectiles: [], rings: [], realm: 'heaven', t: 0, slow: 0, flash: 0, debug: false };
let announceTimer = 0;

function setState(s) {
  Game.state = s;
  $('menu').classList.toggle('hidden', s !== 'menu');
  $('pause').classList.toggle('hidden', s !== 'paused');
  $('result').classList.toggle('hidden', s !== 'matchEnd');
  $('hud').classList.toggle('hidden', s === 'menu');
  if (s !== 'menu') document.activeElement.blur();
}
function announce(text, cls = '') {
  const el = $('announce'); el.textContent = text; el.className = ''; void el.offsetWidth; el.className = 'show ' + cls;
}
function startMatch(mode) {
  setRealm($('realmSelect').value); $('realm').textContent = R().name + ' · ' + R().element;
  Game.mode = mode; Game.rounds = +$('rounds').value; Game.score = [0, 0]; Game.round = 1;
  Game.fighters = [
    new Fighter({ name: 'Player 1', spawn: 300, ...R().colors[0], ctrl: humanController(0) }),
    new Fighter({ name: mode === 'ai' ? 'Rival' : 'Player 2', spawn: 660, ...R().colors[1],
      ctrl: mode === 'ai' ? makeAI($('difficulty').value) : humanController(1) })
  ];
  Input.clear(); buildSkillBars(); setState('playing'); startRound();
}
function startRound() {
  Game.fighters.forEach(f => f.reset()); Game.particles = []; Game.projectiles = []; Game.rings = []; Game.flash = 0; Game.slow = 0; Game.time = ROUND_TIME; Game.phase = 'intro'; Game.phaseT = 0; Game.hitstop = 0;
  acc = 0; announce('Round ' + Game.round); updateHud();
}
function togglePause() {
  if (Game.state === 'playing') setState('paused');
  else if (Game.state === 'paused') { Input.clear(); acc = 0; setState('playing'); }
}
function endRound() {
  const [a, b] = Game.fighters; let w = -1;
  if (a.ko !== b.ko) w = a.ko ? 1 : 0; else if (!a.ko && a.health !== b.health) w = a.health > b.health ? 0 : 1;
  if (w >= 0) Game.score[w]++;
  Game.phase = 'roundEnd'; Game.phaseT = 0;
  announce(w < 0 ? 'Draw' : (a.ko || b.ko ? 'K.O.' : 'Time!'), (a.ko || b.ko) ? 'ko ' + Game.realm : ''); updateHud();
}
function nextRoundOrEnd() {
  const need = Math.floor(Game.rounds / 2) + 1, [s1, s2] = Game.score;
  if (s1 >= need || s2 >= need || Game.round >= Game.rounds) {
    const [n1, n2] = Game.fighters.map(f => f.name);
    $('resultTitle').textContent = s1 === s2 ? 'Draw' : (s1 > s2 ? (Game.mode === 'ai' ? 'Victory' : n1 + ' wins') : (Game.mode === 'ai' ? 'Defeat' : n2 + ' wins'));
    $('resultSub').textContent = `${n1} ${s1} : ${s2} ${n2}`;
    $('result').className = 'overlay ' + (s1 === s2 ? 'draw' : (Game.mode === 'ai' && s2 > s1 ? 'lose' : 'win'));
    setState('matchEnd');
  } else { Game.round++; startRound(); }
}
// Skill circles (bottom corners): icon, key label, and a dark sweep that shrinks while the skill recharges.
const SKILLS = [
  { id: 'bolt', name: 'Light Bullets', icon: '<svg viewBox="0 0 32 32"><g fill="#fff" stroke="#ffd24a" stroke-width="1.5"><circle cx="24" cy="10" r="3"/><circle cx="24" cy="16" r="3"/><circle cx="24" cy="22" r="3"/></g><path d="M6 10h13M6 16h13M6 22h13" stroke="#ffd24a" stroke-width="2" stroke-linecap="round"/></svg>' },
  { id: 'dash', name: 'Dash', icon: '<svg viewBox="0 0 32 32"><path d="M7 8l9 8-9 8M16 8l9 8-9 8" fill="none" stroke="#bfe3ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  { id: 'shield', name: 'Dodge Shield', icon: '<svg viewBox="0 0 32 32"><path d="M16 4l10 4v8c0 6-4 10-10 12C10 26 6 22 6 16V8z" fill="rgba(255,214,90,.25)" stroke="#ffd24a" stroke-width="2.2" stroke-linejoin="round"/></svg>' }
];
const SKILL_KEYS = [{ bolt: 'U', dash: 'Shift', shield: 'L' }, { bolt: 'Num 4', dash: 'Num 0', shield: 'Num 3' }];
function buildSkillBars() { // vs AI: your skills sit bottom-right. Two players: P1 bottom-left, P2 bottom-right.
  [1, 2].forEach(p => { $('skills' + p).innerHTML = SKILLS.map(s => `<div class="skill" id="sk${p}-${s.id}" title="${s.id === 'bolt' ? R().boltName : s.name}">${s.id === 'bolt' ? R().boltIcon : s.icon}<b>${SKILL_KEYS[p - 1][s.id]}</b></div>`).join(''); });
  $('skills1').className = 'skills ' + (Game.mode === 'ai' ? 'right' : 'left');
  $('skills2').className = 'skills right' + (Game.mode === 'ai' ? ' hidden' : '');
}
function skillState(f, id) { return id === 'bolt' ? [f.boltCd, BOLT.cooldown] : id === 'dash' ? [f.dashCd, DASH.cooldown] : [f.shieldCd, SHIELD.cooldown]; }
function updateHud() {
  const [a, b] = Game.fighters;
  Game.fighters.forEach((f, i) => SKILLS.forEach(s => {
    const [t, max] = skillState(f, s.id), el = $('sk' + (i + 1) + '-' + s.id);
    el.style.setProperty('--r', (t / max * 100) + '%'); el.classList.toggle('ready', t <= 0); el.classList.toggle('active', s.id === 'shield' && !!f.shield);
  }));
  $('hp1').style.width = a.health + '%'; $('hp2').style.width = b.health + '%'; $('lag1').style.width = a.health + '%'; $('lag2').style.width = b.health + '%';
  $('name1').textContent = a.name; $('name2').textContent = b.name;
  $('timer').textContent = Math.ceil(Game.time); $('roundLabel').textContent = 'Round ' + Game.round;
  [1, 2].forEach(n => { const need = Math.floor(Game.rounds / 2) + 1; $('pips' + n).innerHTML = Array.from({ length: need }, (_, i) => `<span class="${i < Game.score[n - 1] ? 'won' : ''}"></span>`).join(''); });
}
function update(dt) {
  if (Game.hitstop > 0) { Game.hitstop -= dt; Input.endStep(); return; } // brief freeze on impact
  const [a, b] = Game.fighters; Game.phaseT += dt;
  if (Game.phase === 'intro' && Game.phaseT > 1.5) { Game.phase = 'fight'; Game.phaseT = 0; announce('FIGHT!'); }
  const fighting = Game.phase === 'fight';
  const ia = fighting ? a.ctrl(a, b, dt) : NO_INPUT, ib = fighting ? b.ctrl(b, a, dt) : NO_INPUT;
  a.update(dt, b, ia); b.update(dt, a, ib);
  separate(a, b); resolveHit(a, b); resolveHit(b, a);
  updateProjectiles(dt, a, b);
  [a, b].forEach(f => { if (f.dash && Math.random() < .7) spark(f.x, f.y - 60, '#bfe3ff', 1); }); // dash afterimage
  if (fighting) {
    Game.time = Math.max(0, Game.time - dt);
    if (a.ko || b.ko || Game.time <= 0) endRound();
  } else if (Game.phase === 'roundEnd' && Game.phaseT > 3.2) nextRoundOrEnd();
  for (const q of Game.particles) { q.life -= dt; q.vy += (q.g === undefined ? 700 : q.g) * dt; q.x += q.vx * dt; q.y += q.vy * dt; }
  Game.particles = Game.particles.filter(q => q.life > 0);
  Game.shake *= Math.pow(.001, dt); // decays quickly
  Game.flash = Math.max(0, Game.flash - dt * 1.2);
  for (const r of Game.rings) r.t += dt;
  Game.rings = Game.rings.filter(r => r.t < 1.1);
  [a, b].forEach(f => { // a defeated fighter dissolves into rising motes of light
    if (Game.realm === 'heaven' && f.ko && f.koT > .3 && f.koT < 2.2 && Math.random() < .6)
      Game.particles.push({ x: f.x + (Math.random() - .5) * 50, y: f.y - Math.random() * 70, vx: (Math.random() - .5) * 30, vy: -60 - Math.random() * 90, g: -30, life: 1.1, max: 1.1, size: 3 + Math.random() * 3, color: Math.random() < .6 ? '#ffc933' : '#4aa8ff' });
  });
  [a, b].forEach(f => { // Ashen Throne: a fireball strikes, then the body burns away in flames
    if (Game.realm !== 'hell' || !f.ko) return;
    if (!f.burst && f.koT >= .35) { f.burst = true; Game.rings.push({ x: f.x, y: f.y - 50, t: 0, fire: true }); spark(f.x, f.y - 50, '#ff7a1a', 40); spark(f.x, f.y - 50, '#ffe08a', 20); Game.shake = 9; Game.flash = .6; }
    if (f.burst && f.koT < 2.4) for (let k = 0; k < 3; k++)
      Game.particles.push({ x: f.x + (Math.random() - .5) * 40, y: f.y - Math.random() * 110, vx: (Math.random() - .5) * 40, vy: -80 - Math.random() * 140, g: -60, life: .5 + Math.random() * .5, max: .9, size: 3 + Math.random() * 5, color: ['#ff3b1f', '#ff8a00', '#ffd000'][k] });
  });
  updateHud(); Input.endStep();
}

// UI buttons (one listener for all buttons, using data-act)
document.addEventListener('click', e => {
  const pick = e.target.closest('[data-pick]'); if (pick) { choose(pick); return; }
  const btn = e.target.closest('[data-act]'), act = btn && btn.dataset.act; if (!act) return;
  if (act === 'ai' || act === 'pvp') startMatch(act);
  else if (act === 'rematch') startMatch(Game.mode);
  else if (act === 'restart') startMatch(Game.mode);
  else if (act === 'resume') togglePause();
  else if (act === 'menu') setState('menu');
  else if (act === 'controls') { $('menu').classList.add('hidden'); $('controls').classList.remove('hidden'); }
  else if (act === 'closeControls') { $('controls').classList.add('hidden'); $('menu').classList.remove('hidden'); }
});
function choose(el) { // title-screen options: data-pick="inputId:value"
  const [id, value] = el.dataset.pick.split(':'), group = el.parentElement;
  group.querySelectorAll('[data-pick]').forEach((b, i) => { const on = b === el; b.classList.toggle('sel', on); b.setAttribute('aria-checked', on); if (on) group.style.setProperty('--i', i); }); // --i slides the highlight pill
  $(id).value = value; if (id === 'realmSelect') setRealm(value);
}
function setRealm(r) { Game.realm = r; $('stage').className = r; } // r: 'heaven' | 'hell'
$('realmSelect').addEventListener('change', e => setRealm(e.target.value)); // menu preview follows the choice
function fitStage() { $('stage').style.fontSize = ($('stage').clientWidth / W * 16) + 'px'; }
addEventListener('resize', fitStage); fitStage();

// ===== 8. MAIN LOOP (fixed 60 Hz physics, rendering every display frame) =====
let last = performance.now(), acc = 0;
function frame(ts) {
  const dt = Math.min(.1, (ts - last) / 1000); last = ts; Game.t += dt;
  if (Game.state === 'playing') { acc += dt * (Game.slow > 0 ? .3 : 1); Game.slow = Math.max(0, Game.slow - dt); // slow motion on K.O.
    while (acc >= STEP) { update(STEP); acc -= STEP; } }
  render(); requestAnimationFrame(frame);
}
setState('menu'); requestAnimationFrame(frame);