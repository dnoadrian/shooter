// Persistent player preferences (localStorage, best effort).

const KEY = 'instagib-arena-settings-v1';

export const DEFAULTS = {
  name: 'Player',
  color: '#33ff77',
  sensitivity: 4,
  invert: false,
  fov: 100,
  volume: 0.7,
  announcer: true,
  bloom: true,
  quality: 'high',
  showFps: false,
  showSpeed: false,
  bob: 1,
  drawGun: true,
  hand: 'right',
  crosshair: 2,
  crosshairColor: '#ffffff',
  crosshairSize: 1,
  bots: 5,
  skill: 3,
  fragLimit: 20,
  timeLimit: 10,
};

export function loadSettings() {
  const s = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const k of Object.keys(DEFAULTS)) if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) s[k] = saved[k];
    }
  } catch {
    // storage unavailable: keep defaults
  }
  return s;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}
