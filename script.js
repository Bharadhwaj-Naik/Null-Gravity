

'use strict';


// ── Constants ────────────────────────────────────────────────────
const CANVAS_W = 800;
const CANVAS_H = 600;
const BASE_SPEED = 3.2;      // <--- LOWERED INITIAL BASE SPEED (was 5)
const GRAVITY = 0.4;
const THRUST = -7.5;
const STORAGE_KEY = 'neonGravityShift_v2';

// Speed multipliers for score thresholds (as your request)
const SPEED_MULT_NORMAL = 1.0;    // score < 60
const SPEED_MULT_MEDIUM = 1.65;   // score 60 - 199
const SPEED_MULT_FAST = 2.3;    // score >= 200

const THEME = { primary: '#0ff', danger: '#f0f', bg: '#0a0a14' };


// ── Tiny helpers ─────────────────────────────────────────────────
const rng = (a, b) => Math.random() * (b - a) + a;


// ── Starfield ────────────────────────────────────────────────────
class Starfield {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.stars = [];
        this._resize();
        window.addEventListener('resize', () => this._resize());
    }


    _resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        this.stars = Array.from({ length: 140 }, () => ({
            x: rng(0, this.canvas.width),
            y: rng(0, this.canvas.height),
            r: rng(0.3, 1.5),
            speed: rng(0.08, 0.38),
            op: rng(0.2, 0.75),
            phase: rng(0, Math.PI * 2),
        }));
    }


    draw(frame) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        for (const s of this.stars) {
            const twinkle = 0.5 + 0.5 * Math.sin(frame * 0.014 + s.phase);
            ctx.globalAlpha = s.op * twinkle;
            ctx.fillStyle = '#c8e0ff';
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fill();
            s.x -= s.speed * 0.18;
            if (s.x < 0) s.x = this.canvas.width;
        }
        ctx.globalAlpha = 1;
    }
}


// ── Audio Synthesiser (Web Audio API — no files) ─────────────────
class AudioSystem {
    constructor() { this.ctx = null; this.enabled = true; }


    _init() {
        if (!this.ctx)
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }


    _tone(freq, type, dur, vol = 0.08) {
        if (!this.enabled || !this.ctx) return;
        try {
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(freq / 2, this.ctx.currentTime + dur);
            g.gain.setValueAtTime(vol, this.ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
            osc.connect(g);
            g.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + dur);
        } catch (_) { }
    }


    resume() { this._init(); this.ctx?.resume(); }
    playThrust() { this._tone(400, 'sine', 0.09, 0.03); }
    playScore() { this._tone(880, 'square', 0.10, 0.05); }
    playCrash() { this._tone(150, 'sawtooth', 0.50, 0.20); }
    toggle() { this.enabled = !this.enabled; return this.enabled; }
}

const sfx = new AudioSystem();


// ── Particle ─────────────────────────────────────────────────────
class Particle {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        this.size = rng(2, 6);
        const a = rng(0, Math.PI * 2);
        const spd = rng(2, 6);
        this.vx = Math.cos(a) * spd;
        this.vy = Math.sin(a) * spd;
        this.life = 1;
        this.decay = rng(0.02, 0.055);
    }


    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= 0.93;
        this.vy *= 0.93;
        this.life -= this.decay;
    }


    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);
        ctx.fillStyle = this.color;
        ctx.shadowColor = this.color;
        ctx.shadowBlur = 6;
        ctx.fillRect(this.x, this.y, this.size, this.size);
        ctx.restore();
    }
}


// ── Player  ──────────────────────────────────────────────────────
class Player {
    constructor() {
        this.size = 24;
        this.reset();
    }


    reset() {
        this.x = CANVAS_W * 0.2;
        this.y = CANVAS_H / 2;
        this.velocity = 0;
        this.trail = [];
    }


    /** Apply instant upward velocity burst */
    thrust() {
        this.velocity = THRUST;
        sfx.playThrust();
    }


    update() {
        // Constant gravity pulls down every frame
        this.velocity += GRAVITY;
        this.y += this.velocity;


        // Floor / ceiling — stop and zero velocity
        if (this.y < 0) { this.y = 0; this.velocity = 0; }
        if (this.y + this.size > CANVAS_H) { this.y = CANVAS_H - this.size; this.velocity = 0; }


        // Motion trail
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 10) this.trail.shift();
    }


    draw(ctx) {
        // Fading trail squares
        ctx.fillStyle = THEME.primary;
        this.trail.forEach((pt, i) => {
            ctx.globalAlpha = i / 20;
            ctx.fillRect(pt.x, pt.y, this.size, this.size);
        });


        // Player square with neon glow
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 15;
        ctx.shadowColor = THEME.primary;
        ctx.fillStyle = THEME.primary;
        ctx.fillRect(this.x, this.y, this.size, this.size);
        ctx.shadowBlur = 0;
    }


    get aabb() { return { x: this.x, y: this.y, w: this.size, h: this.size }; }
}


// ── Obstacle  ────────────────────────────────────────────────────
// Speed now depends on a multiplier derived from global score thresholds
class Obstacle {
    constructor(baseSpeedMult) {  // baseSpeedMult = current global speed multiplier (based on score)
        this.width = 40;
        this.gap = CANVAS_H * 0.35;
        const minH = 50;
        this.topH = rng(minH, CANVAS_H - this.gap - minH);
        this.bottomY = this.topH + this.gap;
        this.bottomH = CANVAS_H - this.bottomY;
        this.x = CANVAS_W;
        // Use the dynamic speed multiplier passed from game engine
        this.speed = BASE_SPEED * baseSpeedMult;
        this.passed = false;
    }


    update() { this.x -= this.speed; }


    get offScreen() { return this.x + this.width < 0; }


    /** YOUR collision logic: horizontal overlap + top or bottom block hit */
    checkCollision(player) {
        const { x: px, y: py, w: ps } = player.aabb;
        const pr = px + ps, pb = py + ps;
        if (pr <= this.x || px >= this.x + this.width) return false;
        return py < this.topH || pb > this.bottomY;
    }


    draw(ctx) {
        ctx.save();
        ctx.fillStyle = THEME.danger;
        ctx.shadowColor = THEME.danger;
        ctx.shadowBlur = 12;
        // Top block
        ctx.fillRect(this.x, 0, this.width, this.topH);
        // Bottom block
        ctx.fillRect(this.x, this.bottomY, this.width, this.bottomH);
        // Bright edge lines for depth
        ctx.globalAlpha = 0.25;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.shadowBlur = 0;
        ctx.strokeRect(this.x, 0, this.width, this.topH);
        ctx.strokeRect(this.x, this.bottomY, this.width, this.bottomH);
        ctx.restore();
    }
}


// ── Game Engine ──────────────────────────────────────────────────
class GameEngine {
    constructor() {
        // Canvas
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.bgCanvas = document.getElementById('bg-canvas');
        this.stars = new Starfield(this.bgCanvas);


        // Entities
        this.player = new Player();
        this.obstacles = [];
        this.particles = [];


        // State
        this.state = 'START';
        this.score = 0;
        this.frames = 0;
        this.difficulty = 1;       // kept for display, but speedMult overrides actual speed
        this.combo = 0;
        this.comboTimer = 0;
        this.rafId = null;
        this._bgFrame = 0;

        // --- NEW: speed multiplier based on score thresholds ---
        this.speedMult = SPEED_MULT_NORMAL;   // start slow


        // Persistence
        const saved = this._loadSave();
        this.highScore = saved.best || 0;
        this.totalGames = saved.totalGames || 0;


        // UI refs
        this._scoreEl = document.getElementById('hud-score-val');
        this._bestEl = document.getElementById('hud-best-val');
        this._diffEl = document.getElementById('difficulty-text');
        this._comboEl = document.getElementById('combo-display');
        this._overlay = document.getElementById('overlay');
        this._card = document.getElementById('overlay-card');
        this._flashEl = document.getElementById('flash');


        this._bestEl.textContent = this.highScore;


        this._bindEvents();
        this._showStart();


        // Static first frame + background always running
        this._drawFrame();
        this._bgLoop();
    }


    // ── Persistence ───────────────────────────────────────────────
    _loadSave() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
    }
    _persist() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ best: this.highScore, totalGames: this.totalGames })); } catch { }
    }


    // ── Background animation (independent of game state) ─────────
    _bgLoop() {
        this.stars.draw(this._bgFrame++);
        requestAnimationFrame(() => this._bgLoop());
    }


    // ── Game Lifecycle ────────────────────────────────────────────


    /** Reset everything and begin a new run */
    start() {
        sfx.resume();
        this.player.reset();
        this.obstacles.length = 0;
        this.particles.length = 0;
        this.score = 0;
        this.frames = 0;
        this.difficulty = 1;
        this.combo = 0;
        this.comboTimer = 0;
        this.speedMult = SPEED_MULT_NORMAL;   // reset to slow
        this.state = 'PLAYING';
        this.totalGames++;
        this._persist();
        this._hideOverlay();
        this._scoreEl.textContent = '0';
        this._diffEl.textContent = `DIFFICULTY: ${this.speedMult.toFixed(1)}×`; // show actual speed mult
        this._comboEl.classList.remove('visible');
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this._loop();
    }


    pause() {
        if (this.state !== 'PLAYING') return;
        this.state = 'PAUSED';
        this._showPause();
    }


    resume() {
        if (this.state !== 'PAUSED') return;
        this.state = 'PLAYING';
        this._hideOverlay();
        this._loop();
    }


    /** Called when player hits an obstacle */
    gameOver() {
        this.state = 'GAMEOVER';
        sfx.playCrash();


        // Burst particles at player position
        const cx = this.player.x + this.player.size / 2;
        const cy = this.player.y + this.player.size / 2;
        for (let i = 0; i < 30; i++) this.particles.push(new Particle(cx, cy, THEME.primary));
        this._screenFlash('#f0f', 0.38);


        // Save high score
        const isNew = this.score > this.highScore;
        if (isNew) {
            this.highScore = this.score;
            this._bestEl.textContent = this.highScore;
            this._persist();
        }


        // Slight delay before showing game-over overlay
        setTimeout(() => this._showGameOver(isNew), 500);
    }


    // ── Main Loop ─────────────────────────────────────────────────

    _loop() {
        if (this.state !== 'PLAYING') return;
        this._update();
        this._drawFrame();
        this.rafId = requestAnimationFrame(() => this._loop());
    }


    _update() {
        this.frames++;


        // Combo timer countdown
        this.comboTimer = Math.max(0, this.comboTimer - 16);
        if (this.comboTimer === 0 && this.combo > 0) {
            this.combo = 0;
            this._comboEl.classList.remove('visible');
        }


        // --- SCORE-BASED SPEED MULTIPLIER (your request) ---
        let newMult = this.speedMult;
        if (this.score >= 200) {
            newMult = SPEED_MULT_FAST;
        } else if (this.score >= 60) {
            newMult = SPEED_MULT_MEDIUM;
        } else {
            newMult = SPEED_MULT_NORMAL;
        }

        // If multiplier changed, update and flash
        if (Math.abs(newMult - this.speedMult) > 0.01) {
            this.speedMult = newMult;
            this._diffEl.textContent = `DIFFICULTY: ${this.speedMult.toFixed(1)}×`;
            this._screenFlash('#0ff', 0.12);
        }

        // (old difficulty ramp removed – now purely score-based speed)


        this.player.update();


        // YOUR spawn rate: max(60, 100 - difficulty*10) — but we keep original formula using this.difficulty (still increments every 500 frames as before, but speed is now overridden)
        // However, we also keep difficulty increment for nostalgia, but it doesn't affect speed anymore.
        if (this.frames % 500 === 0) {
            this.difficulty = parseFloat((this.difficulty + 0.1).toFixed(1));
            // don't change speedMult here, but we might still flash?
            // optionally keep the flash: but we already flash on speedMult change, so maybe not needed.
        }

        // Spawn obstacles: pass current speedMult so each obstacle uses the dynamic speed
        const spawnRate = Math.max(60, 100 - this.difficulty * 10); // original formula, but speed is independent
        if (this.frames % Math.floor(spawnRate) === 0)
            this.obstacles.push(new Obstacle(this.speedMult));   // <--- PASS speedMult to obstacle


        // Update obstacles
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const obs = this.obstacles[i];
            obs.update();


            // YOUR collision check
            if (obs.checkCollision(this.player)) { this.gameOver(); return; }


            // YOUR scoring: increment when obstacle fully passes player
            if (!obs.passed && obs.x + obs.width < this.player.x) {
                obs.passed = true;
                this.score++;
                this.combo++;
                this.comboTimer = 2200;
                this._updateHUD();
                this._spawnScorePop(this.player.x, this.player.y - 14, '+1');
                if (this.score % 10 === 0) sfx.playScore();
                if (this.combo >= 3) this._showCombo();
                else this._comboEl.classList.remove('visible');
            }


            if (obs.offScreen) this.obstacles.splice(i, 1);
        }


        // Update particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].update();
            if (this.particles[i].life <= 0) this.particles.splice(i, 1);
        }
    }


    // ── Renderer ─────────────────────────────────────────────────

    _drawFrame() {
        const ctx = this.ctx;


        // Background fill
        ctx.fillStyle = THEME.bg;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);


        // Subtle scanline overlay for retro CRT feel
        ctx.fillStyle = 'rgba(255,255,255,0.018)';
        for (let y = 0; y < CANVAS_H; y += 4) ctx.fillRect(0, y, CANVAS_W, 1);


        // Subtle lane guide lines
        ctx.save();
        ctx.strokeStyle = 'rgba(0,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 14]);
        for (let i = 1; i < 4; i++) {
            ctx.beginPath();
            ctx.moveTo(0, CANVAS_H / 4 * i);
            ctx.lineTo(CANVAS_W, CANVAS_H / 4 * i);
            ctx.stroke();
        }
        ctx.restore();


        // Entities
        if (this.state !== 'GAMEOVER') this.player.draw(ctx);
        this.obstacles.forEach(o => o.draw(ctx));
        this.particles.forEach(p => p.draw(ctx));
    }


    // ── HUD helpers ───────────────────────────────────────────────
    _updateHUD() {
        this._scoreEl.textContent = this.score;
        // Pulse animation on score update
        this._scoreEl.classList.remove('pulse');
        void this._scoreEl.offsetWidth;
        this._scoreEl.classList.add('pulse');
    }


    _showCombo() {
        this._comboEl.textContent = `×${this.combo} COMBO`;
        this._comboEl.classList.add('visible');
    }


    // ── Visual Effects ────────────────────────────────────────────
    _screenFlash(color, opacity = 0.28) {
        this._flashEl.style.background = color;
        this._flashEl.style.opacity = opacity;
        clearTimeout(this._flashTimer);
        this._flashTimer = setTimeout(() => { this._flashEl.style.opacity = 0; }, 130);
    }


    _spawnScorePop(x, y, text) {
        const el = document.createElement('div');
        el.className = 'score-pop';
        el.textContent = text;
        const scale = this.canvas.getBoundingClientRect().width / CANVAS_W;
        const cRect = this.canvas.getBoundingClientRect();
        const wRect = document.getElementById('game-wrapper').getBoundingClientRect();
        el.style.left = (cRect.left - wRect.left + x * scale) + 'px';
        el.style.top = (cRect.top - wRect.top + y * scale) + 'px';
        document.getElementById('game-wrapper').appendChild(el);
        el.addEventListener('animationend', () => el.remove());
    }


    _showToast(msg) {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
    }


    // ── Overlay management ────────────────────────────────────────
    _hideOverlay() { this._overlay.classList.add('hidden'); }


    _renderOverlay(html) {
        this._card.innerHTML = html;
        this._overlay.classList.remove('hidden');
        return this._card;
    }


    _showStart() {
        this.state = 'START';
        const c = this._renderOverlay(`
      <div class="overlay-title cyan">NULL<br>GRAVITY</div>
      <div class="overlay-sub">
        Thrust upward to dodge the magenta columns.<br>
        Every column cleared scores a point — chain them for combos!
      </div>
      <div class="controls-grid">
        <div><span class="ctrl-key">SPACE</span> thrust up</div>
        <div><span class="ctrl-key">TAP</span> thrust up</div>
        <div><span class="ctrl-key">P</span> pause</div>
        <div><span class="ctrl-key">ESC</span> pause</div>
      </div>
      <button class="btn btn-primary" id="ov-start">► INITIALIZE</button>
    `);
        c.querySelector('#ov-start').addEventListener('click', () => this.start());
    }


    _showPause() {
        const c = this._renderOverlay(`
      <div class="overlay-title cyan">PAUSED</div>
      <div class="overlay-sub">Score: ${this.score} &nbsp;|&nbsp; Speed: ${this.speedMult.toFixed(1)}×</div>
      <div class="btn-row">
        <button class="btn btn-primary"   id="ov-resume">► RESUME</button>
        <button class="btn btn-secondary" id="ov-restart-p">↺ RESTART</button>
      </div>
    `);
        c.querySelector('#ov-resume').addEventListener('click', () => this.resume());
        c.querySelector('#ov-restart-p').addEventListener('click', () => this.start());
    }


    _showGameOver(isNew) {
        const c = this._renderOverlay(`
      <div class="overlay-title magenta">GAME OVER</div>
      <div id="score-breakdown">
        <div class="sb-row">
          <span class="sb-label">SCORE</span>
          <span class="sb-val ${isNew ? 'gold' : ''}">${this.score}${isNew ? ' ★ NEW BEST' : ''}</span>
        </div>
        <div class="sb-row">
          <span class="sb-label">ALL-TIME BEST</span>
          <span class="sb-val">${this.highScore}</span>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn btn-primary"   id="ov-restart">↺ RETRY</button>
        <button class="btn btn-secondary" id="ov-share">⬡ COPY SCORE</button>
      </div>
    `);
        c.querySelector('#ov-restart').addEventListener('click', () => this.start());
        c.querySelector('#ov-share').addEventListener('click', () => this._shareScore(c));
    }


    _showHelp() {
        const wasPlaying = this.state === 'PLAYING';
        if (wasPlaying) this.state = 'PAUSED';
        const c = this._renderOverlay(`
      <div class="overlay-title cyan" style="font-size:20px">HOW TO PLAY</div>
      <div class="overlay-sub" style="text-align:left;line-height:2.1">
        🟦 You are the <span style="color:#0ff">cyan square</span> ship.<br>
        🟣 Dodge the <span style="color:#f0f">magenta columns</span>.<br>
        ⚡ Press <span style="color:#0ff">SPACE / TAP</span> to thrust upward.<br>
        🎯 Pass columns to score points.<br>
        🔥 3+ consecutive = COMBO display!<br>
        📈 Speed increases at <span style="color:#0ff">60</span> and <span style="color:#0ff">200</span> points.
      </div>
      <button class="btn btn-primary" id="ov-close-help">
        ${wasPlaying ? '► RESUME' : '► GOT IT'}
      </button>
    `);
        c.querySelector('#ov-close-help').addEventListener('click', () => {
            if (wasPlaying) { this.state = 'PLAYING'; this._hideOverlay(); this._loop(); }
            else { this._showStart(); }
        });
    }


    _shareScore(card) {
        const text = `🚀 Null Gravity | Score: ${this.score} | Best: ${this.highScore} — Can you beat me?`;
        const btn = card.querySelector('#ov-share');
        if (navigator.share) {
            navigator.share({ title: 'Null Gravity', text }).catch(() => { });
        } else {
            navigator.clipboard.writeText(text)
                .then(() => { btn.textContent = '✓ COPIED!'; setTimeout(() => btn.textContent = '⬡ COPY SCORE', 2000); })
                .catch(() => this._showToast('COPY FAILED'));
        }
    }


    // ── Input binding ─────────────────────────────────────────────
    _bindEvents() {
        let lastAction = 0;


        /** Central action handler: thrust if playing, start if on start screen */
        const onAction = (e) => {
            if (e?.cancelable) e.preventDefault();
            const now = Date.now();
            if (now - lastAction < 50) return; // debounce touch + click double-fire
            lastAction = now;
            sfx.resume();


            if (this.state === 'PLAYING') {
                this.player.thrust();
                // Small particle burst on thrust (visual feedback)
                for (let i = 0; i < 5; i++)
                    this.particles.push(new Particle(this.player.x, this.player.y + this.player.size, THEME.primary));
            } else if (this.state === 'START') {
                this.start();
            }
        };


        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space') { e.preventDefault(); onAction(e); }
            if (e.code === 'KeyP' || e.code === 'Escape') {
                this.state === 'PLAYING' ? this.pause() : (this.state === 'PAUSED' && this.resume());
            }
            if (e.code === 'KeyR' && this.state === 'GAMEOVER') this.start();
        });


        // Canvas pointer events
        this.canvas.addEventListener('mousedown', onAction);
        this.canvas.addEventListener('touchstart', onAction, { passive: false });


        // HUD buttons
        document.getElementById('btn-sound').addEventListener('click', () => {
            const on = sfx.toggle();
            document.getElementById('btn-sound').classList.toggle('active', on);
            this._showToast(on ? 'SOUND ON' : 'SOUND OFF');
        });
        document.getElementById('btn-pause').addEventListener('click', () => {
            this.state === 'PLAYING' ? this.pause() : (this.state === 'PAUSED' && this.resume());
        });
        document.getElementById('btn-help').addEventListener('click', () => this._showHelp());
    }
}


// ── Bootstrap ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => { window._game = new GameEngine(); });
