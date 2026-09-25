// DOM heads-up display: crosshair, reload bar, scores, timer, kill feed,
// centre prints, awards, scoreboard and death / countdown messages.

import { RAIL_RELOAD } from './sim/game.js';
import { rayAABB } from './sim/collision.js';

const $ = (id) => document.getElementById(id);

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const nameTag = (p) => `<span style="color:${p.color}">${esc(p.name)}</span>`;

const CROSSHAIRS = [
  // dot
  (c, s) => `<svg viewBox="-16 -16 32 32" width="${32 * s}" height="${32 * s}"><circle r="2" fill="${c}" stroke="#000" stroke-width="0.8"/></svg>`,
  // cross
  (c, s) => `<svg viewBox="-16 -16 32 32" width="${32 * s}" height="${32 * s}"><g stroke="#000" stroke-width="3.6" stroke-linecap="square"><path d="M-10 0h6M4 0h6M0 -10v6M0 4v6"/></g><g stroke="${c}" stroke-width="1.8"><path d="M-10 0h6M4 0h6M0 -10v6M0 4v6"/></g><circle r="1.2" fill="${c}"/></svg>`,
  // ring + dot (railgun classic)
  (c, s) => `<svg viewBox="-16 -16 32 32" width="${32 * s}" height="${32 * s}"><circle r="7" fill="none" stroke="#000" stroke-width="3"/><circle r="7" fill="none" stroke="${c}" stroke-width="1.4"/><circle r="1.4" fill="${c}" stroke="#000" stroke-width="0.6"/></svg>`,
  // chevrons
  (c, s) => `<svg viewBox="-16 -16 32 32" width="${32 * s}" height="${32 * s}"><g fill="none" stroke="#000" stroke-width="3.4"><path d="M-9 -5 l-4 5 4 5M9 -5 l4 5 -4 5"/></g><g fill="none" stroke="${c}" stroke-width="1.6"><path d="M-9 -5 l-4 5 4 5M9 -5 l4 5 -4 5"/></g><circle r="1.3" fill="${c}"/></svg>`,
];
export const CROSSHAIR_COUNT = CROSSHAIRS.length;

export class Hud {
  constructor(settings) {
    this.settings = settings;
    this.el = $('hud');
    this.feed = $('killfeed');
    this.centerTimer = 0;
    this.awardTimer = 0;
    this.xnameTimer = 0;
    this.hitFlash = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.lastRank = '';
    this.applyCrosshair();
  }

  applyCrosshair() {
    const s = this.settings;
    $('crosshair').innerHTML = CROSSHAIRS[s.crosshair % CROSSHAIRS.length](s.crosshairColor, s.crosshairSize);
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
  }

  reset() {
    this.feed.innerHTML = '';
    $('center').classList.remove('show');
    $('award').classList.remove('show');
    $('countdown').textContent = '';
    this.centerTimer = 0;
  }

  feedLine(html, cls = '') {
    const div = document.createElement('div');
    div.className = 'line ' + cls;
    div.innerHTML = html;
    this.feed.appendChild(div);
    while (this.feed.children.length > 6) this.feed.removeChild(this.feed.firstChild);
    setTimeout(() => div.classList.add('fade'), 6000);
    setTimeout(() => div.remove(), 7000);
  }

  center(main, sub = '', time = 2.2) {
    $('center-main').innerHTML = main;
    $('center-sub').innerHTML = sub;
    const c = $('center');
    c.classList.add('show');
    this.centerTimer = time;
  }

  award(kind, count) {
    const a = $('award');
    a.innerHTML = `<div class="award-icon ${kind}"></div><div class="award-text">${kind.toUpperCase()}</div>${count > 1 ? `<div class="award-count">x${count}</div>` : ''}`;
    a.classList.remove('show');
    void a.offsetWidth;
    a.classList.add('show');
    this.awardTimer = 2;
  }

  announce(text, small) {
    if (small) {
      this.feedLine(`<span class="announce">${esc(text)}</span>`);
    } else {
      this.center(`<span class="big">${esc(text)}</span>`, '', 1.4);
    }
  }

  handleEvent(ev, game) {
    const local = game.local;
    switch (ev.type) {
      case 'frag': {
        const v = ev.victim, a = ev.attacker;
        let html;
        if (ev.cause === 'rail' && a) html = `${nameTag(v)} <span class="dim">was railed by</span> ${nameTag(a)}`;
        else html = `${nameTag(v)} <span class="dim">${esc(ev.text.slice(v.name.length + 1))}</span>`;
        this.feedLine(html);
        if (local && a === local) {
          const { rank, tied } = game.rankOf(local);
          this.center(`You fragged ${nameTag(v)}`, `${tied ? 'Tied for ' : ''}${ordinal(rank)} place with ${local.score}`);
          this.hitFlash = 1;
        }
        if (local && v === local) {
          $('death-msg').innerHTML = a ? `Fragged by ${nameTag(a)}` : esc(ev.text.replace(v.name, 'You'));
        }
        break;
      }
      case 'chat':
        this.feedLine(`${nameTag(ev.player)}<span class="dim">:</span> <span class="chat">${esc(ev.text)}</span>`);
        break;
      case 'award':
        if (ev.player === local) this.award(ev.kind, ev.kind === 'excellent' ? local.excellent : local.impressive);
        break;
      case 'announce':
        this.announce(ev.text, ev.small);
        break;
      case 'countdown':
        $('countdown').textContent = ev.n;
        break;
      case 'phase':
        if (ev.phase === 'playing') $('countdown').textContent = '';
        if (ev.phase === 'countdown') $('countdown').textContent = '';
        break;
    }
  }

  // Name of the player under the crosshair (Quake's cg_drawCrosshairNames).
  crosshairName(game) {
    const local = game.local;
    if (!local || !local.alive) return null;
    const eye = game.eye(local);
    const cy = Math.cos(local.ps.yaw), sy = Math.sin(local.ps.yaw);
    const cp = Math.cos(local.ps.pitch), sp = Math.sin(local.ps.pitch);
    const dir = [-sy * cp, sp, -cy * cp];
    let best = null, bestT = 4096;
    for (const p of game.players) {
      if (p === local || !p.alive) continue;
      const o = p.ps.origin;
      const t = rayAABB(eye, dir, [o[0] - 15, o[1] - 24, o[2] - 15], [o[0] + 15, o[1] + p.ps.maxs[1], o[2] + 15], bestT);
      if (t >= 0) {
        best = p;
        bestT = t;
      }
    }
    if (best && !game.visible(eye, [eye[0] + dir[0] * bestT, eye[1] + dir[1] * bestT, eye[2] + dir[2] * bestT])) return null;
    return best;
  }

  update(game, dt, opts) {
    const local = game.local;
    const s = this.settings;
    if (!local) return;

    // countdown / centre print timers
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) $('center').classList.remove('show');
    }
    if (this.awardTimer > 0) {
      this.awardTimer -= dt;
      if (this.awardTimer <= 0) $('award').classList.remove('show');
    }

    // crosshair + reload
    const ch = $('crosshair');
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    ch.style.transform = `translate(-50%, -50%) scale(${1 + this.hitFlash * 0.5})`;
    ch.style.display = local.alive && game.phase !== 'intermission' ? '' : 'none';
    const charge = 1 - local.reload / RAIL_RELOAD;
    const rl = $('reload');
    rl.style.display = local.alive ? '' : 'none';
    rl.firstElementChild.style.width = `${charge * 100}%`;
    rl.classList.toggle('ready', charge >= 1);

    // crosshair names
    const target = this.crosshairName(game);
    const xn = $('xname');
    if (target) {
      xn.innerHTML = nameTag(target);
      this.xnameTimer = 1;
    } else {
      this.xnameTimer -= dt;
    }
    xn.style.opacity = Math.max(0, Math.min(1, this.xnameTimer * 2));

    // scores: yours and the best other one
    const others = game.players.filter((p) => p !== local);
    const best = others.reduce((a, b) => (!a || b.score > a.score ? b : a), null);
    const sb = $('scorebox');
    sb.querySelector('.me').textContent = local.score;
    sb.querySelector('.other').textContent = best ? best.score : '-';
    sb.querySelector('.me').classList.toggle('leading', !best || local.score >= best.score);
    sb.querySelector('.limit').textContent = game.opts.fragLimit ? `${game.opts.fragLimit}` : '';

    // timer
    let t;
    if (game.phase === 'countdown') t = game.opts.timeLimit;
    else if (game.opts.timeLimit) t = Math.max(0, game.opts.timeLimit - game.matchTime);
    else t = game.matchTime;
    const m = Math.floor(t / 60), sec = Math.floor(t % 60);
    $('timer').textContent = game.suddenDeath ? 'SUDDEN DEATH' : `${m}:${sec.toString().padStart(2, '0')}`;

    $('awards-count').innerHTML =
      (local.excellent ? `<span class="mini excellent"></span>${local.excellent}` : '') +
      (local.impressive ? `<span class="mini impressive"></span>${local.impressive}` : '');

    // death message
    const death = $('death');
    const dead = !local.alive && game.phase === 'playing';
    death.classList.toggle('show', dead);
    $('respawn').style.visibility = dead && game.time >= local.respawnAt ? 'visible' : 'hidden';

    // speed / fps
    const speed = $('speed');
    speed.style.display = s.showSpeed ? '' : 'none';
    if (s.showSpeed) speed.textContent = `${Math.round(Math.hypot(local.ps.velocity[0], local.ps.velocity[2]))} ups`;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime > 0.5) {
      $('fps').textContent = `${Math.round(this.fpsFrames / this.fpsTime)} fps`;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    $('fps').style.display = s.showFps ? '' : 'none';
    $('zoomfx').classList.toggle('on', !!opts.zoom && local.alive);

    // scoreboard while holding Tab, while dead, and at intermission
    const showBoard = opts.scores || dead || game.phase === 'intermission';
    const board = $('scoreboard');
    board.classList.toggle('hidden', !showBoard);
    if (showBoard) this.renderScoreboard(game, board);
  }

  renderScoreboard(game, board) {
    const rows = game
      .ranking()
      .map((p, i) => {
        const acc = p.shots ? Math.round((100 * p.hits) / p.shots) : 0;
        return `<tr class="${p === game.local ? 'me' : ''}${p.alive ? '' : ' dead'}"><td>${i + 1}</td><td class="name"><span class="swatch" style="background:${p.color}"></span>${esc(p.name)}${p.isBot ? '' : ' <span class="you">YOU</span>'}</td><td class="num">${p.score}</td><td class="num">${p.deaths}</td><td class="num">${acc}%</td><td class="num">${p.excellent}</td><td class="num">${p.impressive}</td></tr>`;
      })
      .join('');
    const head = game.phase === 'intermission' ? '' : `<div class="sb-title">${esc(game.map.name)} <span class="dim">· Instagib · ${game.opts.fragLimit ? `fraglimit ${game.opts.fragLimit}` : 'no fraglimit'}</span></div>`;
    const html = `${head}<table><thead><tr><th></th><th class="name">Name</th><th>Score</th><th>Deaths</th><th>Acc</th><th title="Excellent">Exc</th><th title="Impressive">Imp</th></tr></thead><tbody>${rows}</tbody></table>`;
    if (html !== this.lastBoard) {
      board.innerHTML = html;
      this.lastBoard = html;
    }
  }
}
