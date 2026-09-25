# Instagib Arena

A Quake 3 Arena style **instagib** deathmatch that runs in the browser. Railguns only, one hit, one frag.

- **Q3 movement.** The player physics follow Quake 3's `bg_pmove.c`: ground friction, weak air control, step-up and slide moves along brushes, ramps, crouching and strafe jumping. Hold jump to bunny hop.
- **Railgun.** Instant hit, 1.5 s recharge, and the slug passes through everyone in its path. Trails have a core beam and a spiral in the shooter's colour, and leave scorch marks. Victims gib.
- **Awards and announcer.** *Excellent* for two frags within 3 seconds, *Impressive* for two rail hits in a row. The announcer calls out the countdown, lead changes, frags left and time warnings (uses the browser's speech synthesis where available).
- **The Molten Spire.** An original arena: a lava pool around a central spire reached by jump pads, a ground ring with pillars and cover, and a raised balcony along the walls. Spire pads launch you back out to the balconies.
- **Bots.** 1 to 8 bots at five skill levels. They navigate a waypoint graph generated from the level geometry, ride jump pads, strafe and hop in fights, and aim like players do: reaction time, tracking lag and aim error that shrinks while they track you, so moving targets are harder to hit.
- **No assets.** All textures, the sky, models and sounds are generated in code. The only dependency is three.js, vendored in `vendor/three.js`.

## Play

The game is a static site. Serve the repository root with any web server and open it:

```sh
npm start              # http://localhost:8080 (no install needed)
# or
python3 -m http.server 8080
```

To get one self-contained HTML file that runs straight from disk (double-click it, no server):

```sh
npm install
npm run build          # writes dist/instagib.html
```

You need a keyboard and mouse. Click the game to capture the mouse; press Esc to pause.

## Controls

| Input | Action |
| --- | --- |
| Mouse | Aim |
| Left click | Fire |
| Right click / E | Zoom |
| W A S D / arrows | Move |
| Space | Jump (hold to bunny hop) |
| C | Crouch |
| Tab | Scoreboard |
| F | Toggle FPS counter |
| Esc | Pause menu |

Sensitivity, field of view (Quake style horizontal FOV at 4:3), volume, crosshair, rail colour, bloom and graphics quality are in the menu and are remembered between visits.

## Rules

- Frag limit and time limit are set in the menu. If the time runs out with a tie for first place, the match goes to sudden death.
- Falling into the lava costs you a frag.
- You respawn by clicking or jumping once the respawn delay is over, or automatically after a few seconds.

## Development

```sh
npm install
npm test               # physics, rules, navigation and a bot-vs-bot match, headless in Node
npm run build          # single-file build in dist/
npm run vendor         # rebuild vendor/three.js from the three package
```

The simulation in `src/sim/` has no browser dependencies and runs at a fixed 125 Hz tick, so it is tested headless:

| Path | Contents |
| --- | --- |
| `src/sim/collision.js` | Convex brushes, box traces (Q3's `CM_TraceThroughBrush`) |
| `src/sim/pmove.js` | Player movement |
| `src/sim/map.js` | The arena, jump pads, spawns, hazards |
| `src/sim/nav.js` | Waypoint graph generation and A* |
| `src/sim/bot.js` | Bot AI |
| `src/sim/game.js` | Rules: rails, frags, awards, spawning, limits |
| `src/render/` | three.js scene: procedural textures, world meshes, sky, models, effects |
| `src/audio.js` | Synthesised sound effects and the announcer |
| `src/hud.js`, `src/input.js`, `src/main.js` | HUD, pointer-lock input, menus and the game loop |

## Credits

Inspired by id Software's Quake III Arena. This is an independent fan project with no id Software assets: the arena, models, textures and sounds are original. The movement and collision code (`src/sim/pmove.js`, `src/sim/collision.js`) closely follows the algorithms in the [GPL-2.0 Quake III Arena source](https://github.com/id-Software/Quake-III-Arena) (`bg_pmove.c`, `cm_trace.c`), so a public release should be licensed GPL-2.0-or-later.

Rendering by [three.js](https://threejs.org) (MIT).
