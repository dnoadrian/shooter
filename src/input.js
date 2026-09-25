// Keyboard + mouse with pointer lock. Produces Quake style usercmds.

const BINDS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  crouch: ['KeyC'],
  zoom: ['KeyE'],
  scores: ['Tab'],
};

export class Input {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.keys = new Set();
    this.buttons = new Set();
    this.fireLatch = false;
    this.locked = false;
    this.enabled = false;
    this.onLook = null;
    this.onLockChange = null;
    this.onKey = null;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
      if (this.onKey && !e.repeat) this.onKey(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) {
        this.lock();
        return;
      }
      this.buttons.add(e.button);
      if (e.button === 0) this.fireLatch = true;
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.onLook) return;
      this.onLook(e.movementX || 0, e.movementY || 0);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.keys.clear();
        this.buttons.clear();
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      // a failed raw-input request is retried without it; only report a
      // failure if we still aren't locked a moment later
      setTimeout(() => {
        if (!this.locked && this.onLockChange) this.onLockChange(false, true);
      }, 400);
    });
  }

  lock() {
    try {
      // raw mouse input where supported
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) {
        p.catch(() => {
          const q = this.canvas.requestPointerLock();
          if (q && q.catch) q.catch(() => {});
        });
      }
    } catch {
      this.canvas.requestPointerLock();
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(action) {
    return BINDS[action].some((k) => this.keys.has(k));
  }

  get zoom() {
    return this.buttons.has(2) || this.down('zoom');
  }

  get scores() {
    return this.down('scores');
  }

  cmd() {
    const fire = this.buttons.has(0) || this.fireLatch;
    this.fireLatch = false;
    return {
      forward: (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0),
      right: (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0),
      up: this.down('jump') ? 1 : this.down('crouch') ? -1 : 0,
      fire,
    };
  }
}
