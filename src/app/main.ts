import '../ui/styles.css';
import type { Ticker } from 'pixi.js';
import { TerrainRenderer, type CursorState } from '../render/terrain.ts';
import { Camera } from '../render/camera.ts';
import { MapInput } from '../ui/input.ts';
import { edgePanVector } from '../ui/edgePan.ts';
import { SaveService } from './saves.ts';
import { setCalendar, setDebug, setStatus, toast } from '../ui/hud.ts';
import { boolOption, loadOptions, numberOption, saveOptions, setOption, stringOption, type KeyValueStorage, type OptionValue, type Options } from '../ui/panels/options.ts';
import { cooldownFraction, selectTab, type TabState } from '../ui/panels/powerBar.ts';
import { currentStep, parseTutorial, skipTutorial, TUTORIAL_TEXT, tutorialEvent, type TutorialState } from '../ui/panels/tutorial.ts';
import { cooldownSecondsLeft, linePoints, powerStatus, strokeOp } from '../ui/powerSupport.ts';
import { WindowHost } from '../ui/windowHost.ts';
import { windowFor, type WindowDeps } from '../ui/windowContent.ts';
import { SimView } from '../ui/sim-view.ts';
import { POWER_BY_ID, POWERS, TABS, powersInTab, type PowerDef, type TabId } from '../content/powers.ts';
import { Ev, type BrushOp, type BrushShape, type Event as SimEvent, type Speed } from '../shared/protocol.ts';
import { MONTH_TICKS, YEAR_TICKS, DEFAULT_SIZE_STEP } from '../shared/constants.ts';
import { RULE_BY_ID, RuleSet } from '../sim/rules.ts';
import { AudioModel } from '../audio/model.ts';
import { SimClient } from './sim-client.ts';
import { installGlobalErrorHandlers, journal, showFatal, startSentinel } from './recovery.ts';

/** Brush radii in tiles for slider positions 0..10 (04 section 1.1 sizes, trimmed for M1). */
const BRUSH_RADII = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const;
const DEFAULT_SIZE_INDEX = 5;
const SPEED_CHOICES: readonly Speed[] = [0.5, 1, 2, 5, 10];
/** Keyboard or arrow pan speed in CSS px per millisecond. */
const KEY_PAN_PX_PER_MS = 0.6;
/** Storage key for the first-run tutorial state (per device). */
const TUTORIAL_KEY = 'tutorial';

type Tile = { x: number; y: number };

/** Terrain tool buttons are shortcuts to the matching power. */
const TOOL_POWERS: Readonly<Record<string, string>> = { raise: 'shape_raise', lower: 'shape_lower' };

interface UiState {
  /** The armed power, or null for inspect. */
  armed: PowerDef | null;
  shape: BrushShape;
  sizeIndex: number;
  speed: Speed;
  paused: boolean;
}

interface Stroke {
  power: PowerDef;
  last: Tile;
  target: Tile;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

function supported(): boolean {
  if (typeof Worker === 'undefined') return false;
  return !!document.createElement('canvas').getContext('webgl2');
}

function parseIntParam(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** Storage access can throw (private windows, blocked site data); every read and write goes through here. */
function safeStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadTutorial(): TutorialState {
  try {
    const raw = safeStorage()?.getItem(TUTORIAL_KEY);
    return parseTutorial(raw ? JSON.parse(raw) : null);
  } catch {
    return parseTutorial(null);
  }
}

function saveTutorial(state: TutorialState): void {
  try {
    safeStorage()?.setItem(TUTORIAL_KEY, JSON.stringify(state));
  } catch {
    // Not saved: the tutorial starts again on the next visit.
  }
}

/** Reads the system preference for reduced motion or flashing; the default for both settings. */
function osPrefers(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  installGlobalErrorHandlers();
  startSentinel();
  if (!supported()) {
    showFatal(
      'Browser not supported',
      'Sandbox Realms needs Chrome 90+, Safari 15.4+ or Firefox 114+ with WebGL2 and module workers.',
    );
    return;
  }

  const params = new URLSearchParams(location.search);
  const debugOverlay = params.has('debug');

  const host = $('map');
  const renderer = await TerrainRenderer.create(host);
  const client = new SimClient();
  const rules = new RuleSet();
  const audio = new AudioModel();

  // Settings: the OS preference fills reduce motion and flashing until the player chooses.
  const osDefaults: Options = {
    ...loadOptions(null),
    'ui.reduceMotion': osPrefers('(prefers-reduced-motion: reduce)'),
    'ui.reduceFlash': osPrefers('(prefers-reduced-motion: reduce)'),
  };
  let options: Options = loadOptions(safeStorage(), osDefaults);
  const startSpeed = Number.parseFloat(stringOption(options, 'game.defaultSpeed'));

  const state: UiState = {
    armed: null,
    shape: 'circle',
    sizeIndex: DEFAULT_SIZE_INDEX,
    speed: SPEED_CHOICES.includes(startSpeed as Speed) ? (startSpeed as Speed) : 1,
    paused: false,
  };

  let tutorial: TutorialState = loadTutorial();
  let camera: Camera | null = null;
  let realmSide = 0;
  let realmSeed = 0;
  let calendarText = 'Y1 M1';
  let stroke: Stroke | null = null;
  let cursorScreen: { x: number; y: number } | null = null;
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let pressed = false;
  const keysDown = new Set<string>();
  const cooldownUntil = new Map<string, number>();

  let simTick = 0;
  let simHash = 0;
  let simAvgTickMs = 0;
  let simSpeed = 1;
  let lastTps = { tick: 0, at: performance.now(), value: 0 };
  let fpsFrames = 0;
  let fpsSince = performance.now();
  let fps = 0;

  const brushRadius = (): number => BRUSH_RADII[state.sizeIndex] ?? 5;

  const tileAt = (sx: number, sy: number): Tile => {
    const cam = camera;
    if (!cam) return { x: 0, y: 0 };
    const t = cam.screenToTile(sx, sy);
    return {
      x: Math.max(-1, Math.min(realmSide, Math.floor(t.x))),
      y: Math.max(-1, Math.min(realmSide, Math.floor(t.y))),
    };
  };

  const setRealmSide = (side: number, seed: number): void => {
    realmSide = side;
    realmSeed = seed;
    renderer.setSide(side);
    camera = new Camera(side, renderer.app.screen.width, renderer.app.screen.height);
    stroke = null;
    $('realm-name').textContent = `Realm ${seed.toString(36).toUpperCase().slice(-6)}`;
  };

  const applySpeed = (): void => {
    client.setSpeed(state.paused ? 0 : state.speed);
    $('pause').setAttribute('aria-pressed', String(state.paused));
    $('pause').setAttribute('aria-label', state.paused ? 'Resume' : 'Pause');
    $('pause').textContent = state.paused ? '▶' : '❚❚';
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.speed-btn')) {
      btn.setAttribute('aria-pressed', String(!state.paused && Number(btn.dataset['speed']) === state.speed));
    }
  };

  const togglePause = (): void => {
    state.paused = !state.paused;
    applySpeed();
  };

  const cycleSpeed = (): void => {
    const next = SPEED_CHOICES[(SPEED_CHOICES.indexOf(state.speed) + 1) % SPEED_CHOICES.length] ?? 1;
    state.speed = next;
    state.paused = false;
    applySpeed();
    feedTutorial('speed-changed');
  };

  /** Coach strip: the current tutorial step, hidden once the tutorial is done or skipped. */
  const renderCoach = (): void => {
    const step = currentStep(tutorial);
    const coach = $('coach');
    coach.hidden = step === null;
    if (step) $('coach-text').textContent = TUTORIAL_TEXT[step.id] ?? '';
  };

  const feedTutorial = (event: string): void => {
    const next = tutorialEvent(tutorial, event);
    if (next === tutorial) return;
    tutorial = next;
    saveTutorial(tutorial);
    renderCoach();
  };

  // Power bar: one tab per power group; only the selected group's buttons exist in the DOM.
  let powerTab: TabState = { active: TABS[0], tabs: TABS };
  const tabLabel = (tab: TabId): string => tab.charAt(0).toUpperCase() + tab.slice(1);

  /** Carries out a power button press: UI actions run at once, sim powers arm or disarm. */
  const activatePower = (power: PowerDef): void => {
    const status = powerStatus(power);
    if (!status.enabled) {
      setStatus(status.note);
      return;
    }
    switch (power.handler) {
      case 'set_pause':
        togglePause();
        return;
      case 'cycle_speed':
        cycleSpeed();
        return;
      case 'open_window':
        openWindow(`win_${String(power.params['window'] ?? '')}`);
        return;
      case 'toggle_hud':
        document.documentElement.classList.toggle('hide-ui');
        return;
      case 'toggle_rule':
        setRule(String(power.params['rule'] ?? ''), !rules.isOn(String(power.params['rule'] ?? '')));
        return;
      default:
        setArmed(state.armed?.id === power.id ? null : power);
    }
  };

  /** Keeps aria-pressed on the power buttons in step with the armed power and the rules. */
  const updatePowerButtons = (): void => {
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.power')) {
      const power = POWER_BY_ID.get(btn.dataset['powerId'] ?? '');
      if (!power) continue;
      const pressed = power.handler === 'toggle_rule' ? rules.isOn(String(power.params['rule'])) : state.armed?.id === power.id;
      btn.setAttribute('aria-pressed', String(pressed));
    }
  };

  const renderPowers = (): void => {
    const tabHost = $('power-tabs');
    tabHost.replaceChildren(
      ...TABS.map((tab) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'power-tab';
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', String(tab === powerTab.active));
        btn.textContent = tabLabel(tab);
        btn.setAttribute('aria-label', `Powers: ${tabLabel(tab)}`);
        btn.addEventListener('click', () => {
          powerTab = selectTab(powerTab, tab);
          renderPowers();
        });
        return btn;
      }),
    );
    $('power-list').replaceChildren(
      ...powersInTab(powerTab.active as TabId).map((power) => {
        const status = powerStatus(power);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'power';
        btn.dataset['powerId'] = power.id;
        btn.setAttribute('aria-disabled', String(!status.enabled));
        btn.title = status.enabled ? '' : status.note;
        btn.textContent = power.name;
        btn.addEventListener('click', () => activatePower(power));
        return btn;
      }),
    );
    updatePowerButtons();
  };

  /** Arms a power (null = inspect). Terrain tool buttons and the power bar both show the same state. */
  const setArmed = (power: PowerDef | null): void => {
    // A stroke in progress belongs to the old power: end it before the new one takes over.
    if (stroke) {
      flushStroke();
      stroke = null;
    }
    state.armed = power;
    const op = strokeOp(power);
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.tool')) {
      const tool = btn.dataset['tool'];
      btn.setAttribute('aria-pressed', String(power === null ? tool === 'inspect' : tool === op));
    }
    updatePowerButtons();
    if (!power) setStatus('Tap a tile to inspect it.');
    else if (op) setStatus(`${op === 'raise' ? 'Raise' : 'Lower'}: drag to shape the land.`);
    else if (power.kind === 'brush') setStatus(`${power.name}: drag or tap the map.`);
    else setStatus(`${power.name} is armed: tap the map to use it.`);
    if (power) feedTutorial('tool-armed');
  };

  const toolPower = (tool: string): PowerDef | null => {
    const id = TOOL_POWERS[tool];
    return id ? (POWER_BY_ID.get(id) ?? null) : null;
  };

  const setShape = (shape: BrushShape): void => {
    state.shape = shape;
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.shape')) {
      btn.setAttribute('aria-checked', String(btn.dataset['shape'] === shape));
    }
  };

  /** Sets a Realm Rule on the mirror and in the sim. Returns false when the rule cannot change. */
  const setRule = (id: string, on: boolean): boolean => {
    if (!RULE_BY_ID.has(id) && !id.startsWith('age_enabled_')) return false;
    const before = rules.isOn(id);
    const ok = rules.set(id, on);
    if (!ok) {
      setStatus(`${id.replace(/_/g, ' ')} cannot be turned off once on.`);
      return false;
    }
    if (before !== on) client.setRule(id, on);
    updatePowerButtons();
    return true;
  };

  /** Applies a power at one tile through the sim, or reports why it is cooling down. */
  const usePowerAt = (power: PowerDef, x: number, y: number): void => {
    const now = performance.now();
    const readyAt = cooldownUntil.get(power.id) ?? 0;
    if (now < readyAt) {
      setStatus(`${power.name} is ready in ${cooldownSecondsLeft(now, readyAt)} s.`);
      return;
    }
    if (power.cooldownMs > 0) cooldownUntil.set(power.id, now + power.cooldownMs);
    const op = strokeOp(power);
    if (op) client.stroke(op, state.shape, brushRadius(), x, y, x, y, true);
    else client.power(power.id, x, y);
    if (boolOption(options, 'input.haptics')) navigator.vibrate?.(8);
  };

  const flushStroke = (): void => {
    if (!stroke) return;
    const { last, target } = stroke;
    if (target.x === last.x && target.y === last.y) return;
    const op = strokeOp(stroke.power);
    if (op) {
      client.stroke(op, state.shape, brushRadius(), last.x, last.y, target.x, target.y, false);
    } else {
      // Other brush powers are applied tile by tile along the drag; the first tile was done at the press.
      for (const [x, y] of linePoints(last.x, last.y, target.x, target.y).slice(1)) client.power(stroke.power.id, x, y);
    }
    stroke.last = target;
  };

  const brushOp = (): BrushOp | null => strokeOp(state.armed);

  // Windows: one dialog, filled by windowContent. Settings, rules, ages, and the rest open from here.
  const openWindow = (id: string): void => {
    const build = windowFor(id, windowDeps);
    if (!build) {
      setStatus('That window is not available yet.');
      return;
    }
    windowHost.open(id, build.title, build.build, build.live);
    // A live window asks for a snapshot now, so it has numbers while the sim is paused.
    if (build.live) client.requestSnapshot();
  };

  // The latest sim snapshot (Ev.Snapshot). Windows read it through windowDeps.snapshot.
  const simView = new SimView();

  // The save store opens on first use (the Chronicle window); it never rejects, so a failed open
  // shows an empty list instead of an error.
  let saveStore: Promise<SaveService> | null = null;
  const windowDeps: WindowDeps = {
    options: () => options,
    saves: () => {
      saveStore ??= SaveService.open(window.indexedDB, {
        isPhone: window.matchMedia('(pointer: coarse)').matches,
        storage: navigator.storage,
      });
      return saveStore.then((store) => store.list());
    },
    setOption: (id, value) => changeOption(id, value),
    snapshot: () => simView.current,
    rules,
    setRule,
    realm: () => ({ seed: realmSeed, side: realmSide, calendar: calendarText }),
    newRealm: (seed, sizeStep) => {
      void client.newRealm(seed, sizeStep);
    },
    activate: (power) => activatePower(power),
    tutorial: () => ({
      state: tutorial,
      restart: () => {
        tutorial = parseTutorial(null);
        saveTutorial(tutorial);
        renderCoach();
        openWindow('win_tutorial');
      },
      skip: () => {
        tutorial = skipTutorial(tutorial);
        saveTutorial(tutorial);
        renderCoach();
        openWindow('win_tutorial');
      },
    }),
    close: () => windowHost.close(),
  };

  const windowHost = new WindowHost($<HTMLDialogElement>('window'), $('window-title'), $('window-body'));
  $('window-close').addEventListener('click', () => windowHost.close());
  simView.subscribe(() => windowHost.feed());

  // Map input. A brush power (raise, lower, ground paint) drags; everything else pans.
  new MapInput(renderer.app.canvas, {
    brushArmed: () => state.armed?.kind === 'brush' && camera !== null,
    onPan: (dx, dy) => {
      const k = numberOption(options, 'input.panSpeed') / 100;
      camera?.panBy(dx * k, dy * k);
    },
    onZoom: (factor, sx, sy) => {
      const base = boolOption(options, 'input.invertZoom') ? 1 / factor : factor;
      camera?.zoomAt(base ** (numberOption(options, 'input.zoomSpeed') / 100), sx, sy);
    },
    onHover: (sx, sy) => {
      cursorScreen = { x: sx, y: sy };
    },
    onStrokeStart: (sx, sy) => {
      const power = state.armed;
      if (!power || power.kind !== 'brush') return;
      const t = tileAt(sx, sy);
      stroke = { power, last: t, target: t };
      cursorScreen = { x: sx, y: sy };
      usePowerAt(power, t.x, t.y);
    },
    onStrokeMove: (sx, sy) => {
      cursorScreen = { x: sx, y: sy };
      if (stroke) stroke.target = tileAt(sx, sy);
    },
    onStrokeEnd: () => {
      flushStroke();
      if (stroke) feedTutorial('stroke-finished');
      stroke = null;
    },
    onTap: (sx, sy) => {
      const t = tileAt(sx, sy);
      cursorScreen = { x: sx, y: sy };
      if (state.armed) {
        usePowerAt(state.armed, t.x, t.y);
        return;
      }
      void client.query(t.x, t.y).then((r) => {
        if (!r.inBounds) {
          setStatus('Off the map.');
          return;
        }
        setStatus(`Tile ${r.tileX}, ${r.tileY} · elevation ${r.elevation} · ${r.ground}`);
        feedTutorial('tile-inspected');
      });
    },
  });

  client.onEvent((event: SimEvent) => {
    switch (event.kind) {
      case Ev.Ready:
        if (event.side > 0) setRealmSide(event.side, event.seed);
        return;
      case Ev.Frame:
        if (event.rows) {
          renderer.applyRows(event.rows);
          client.returnBuffer(event.rows.data.buffer as ArrayBuffer);
        }
        simTick = event.stats.tick;
        simHash = event.stats.stateHash;
        simAvgTickMs = event.stats.avgTickMs;
        simSpeed = event.stats.speed;
        calendarText = `Y${Math.floor(simTick / YEAR_TICKS) + 1} M${(Math.floor(simTick / MONTH_TICKS) % 12) + 1}`;
        setCalendar(calendarText);
        return;
      case Ev.Fault:
        journal(event.code, event.detail);
        if (event.severity === 'fatal') showFatal('The simulation stopped', event.detail);
        else toast(event.detail);
        return;
      case Ev.Snapshot:
        simView.apply(event.snap);
        return;
      case Ev.QueryResult:
      case Ev.Heartbeat:
        return;
    }
  });

  // Controls.
  $('pause').addEventListener('click', togglePause);
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.speed-btn')) {
    btn.addEventListener('click', () => {
      state.speed = Number(btn.dataset['speed']) as Speed;
      state.paused = false;
      applySpeed();
      feedTutorial('speed-changed');
    });
  }
  // Edge pan needs a hover position that is current: it clears when the pointer leaves the map or
  // when a press starts (a drag moves the camera by itself).
  renderer.app.canvas.addEventListener('pointerleave', () => {
    cursorScreen = null;
  });
  renderer.app.canvas.addEventListener('pointerdown', () => {
    pressed = true;
  });
  for (const type of ['pointerup', 'pointercancel'] as const) {
    renderer.app.canvas.addEventListener(type, () => {
      pressed = false;
    });
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.tool')) {
    btn.addEventListener('click', () => setArmed(toolPower(btn.dataset['tool'] ?? 'inspect')));
  }

  // Settings: every change is validated, saved, and applied at once.
  const changeOption = (id: string, value: OptionValue): void => {
    options = setOption(options, id, value);
    saveOptions(safeStorage(), options);
    if (id === 'ui.fullscreen') toggleFullscreen(options[id] === true);
    applyOptions();
  };
  const toggleFullscreen = (on: boolean): void => {
    try {
      if (on) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      else if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    } catch {
      // Full screen is refused in some embedded contexts; the setting stays saved.
    }
  };
  const applyOptions = (): void => {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(numberOption(options, 'ui.scale') / 100));
    root.style.setProperty('--ui-scale-windows', String(numberOption(options, 'ui.scaleWindows') / 100));
    root.style.setProperty('--ui-scale-tooltips', String(numberOption(options, 'ui.scaleTooltips') / 100));
    root.dataset['theme'] = stringOption(options, 'ui.theme');
    root.toggleAttribute('data-reduce-motion', boolOption(options, 'ui.reduceMotion'));
    root.toggleAttribute('data-reduce-flash', boolOption(options, 'ui.reduceFlash'));
    renderer.app.ticker.maxFPS = numberOption(options, 'ui.fpsCap');
    $('debug').hidden = !(boolOption(options, 'ui.showFps') || debugOverlay);
    audio.setVolume('master', numberOption(options, 'audio.master') / 100);
    audio.setVolume('music', numberOption(options, 'audio.music') / 100);
    audio.setVolume('sfx', numberOption(options, 'audio.sfx') / 100);
    audio.setVolume('ui', numberOption(options, 'audio.ui') / 100);
    audio.setHidden(document.hidden && boolOption(options, 'audio.muteOnBlur'));
  };
  applyOptions();
  $('settings-open').addEventListener('click', () => openWindow('win_settings'));
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-window]')) {
    btn.addEventListener('click', () => openWindow(btn.dataset['window'] ?? ''));
  }
  $('coach-skip').addEventListener('click', () => {
    tutorial = skipTutorial(tutorial);
    saveTutorial(tutorial);
    renderCoach();
  });
  renderCoach();

  for (const btn of document.querySelectorAll<HTMLButtonElement>('.shape')) {
    btn.addEventListener('click', () => setShape(btn.dataset['shape'] as BrushShape));
  }
  const sizeInput = $<HTMLInputElement>('brush-size');
  sizeInput.value = String(state.sizeIndex);
  const updateSizeOutput = (): void => {
    state.sizeIndex = Number(sizeInput.value);
    $('brush-size-out').textContent = String(brushRadius());
  };
  sizeInput.addEventListener('input', updateSizeOutput);
  updateSizeOutput();

  for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    tab.addEventListener('click', () => {
      const name = tab.dataset['tab'] ?? 'terrain';
      for (const other of document.querySelectorAll<HTMLButtonElement>('.tab')) {
        other.setAttribute('aria-selected', String(other === tab));
      }
      for (const panel of ['terrain', 'realm', 'powers']) {
        $(`panel-${panel}`).hidden = name !== panel;
      }
    });
  }
  $('new-realm').addEventListener('click', () => {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const sizeStep = Number($<HTMLSelectElement>('realm-size').value);
    void client.newRealm(seed, sizeStep);
  });

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    keysDown.add(e.code);
    if (e.code === 'KeyP') {
      togglePause();
    } else if (e.code === 'KeyH') {
      document.documentElement.classList.toggle('hide-ui');
    } else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      const step = e.code === 'BracketLeft' ? -1 : 1;
      sizeInput.value = String(Math.max(0, Math.min(BRUSH_RADII.length - 1, state.sizeIndex + step)));
      updateSizeOutput();
    } else if (e.code === 'Escape') {
      setArmed(null);
    }
  });
  window.addEventListener('keyup', (e: KeyboardEvent) => keysDown.delete(e.code));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) client.setSpeed(0);
    else applySpeed();
    audio.setHidden(document.hidden && boolOption(options, 'audio.muteOnBlur'));
  });

  // Keep the camera viewport in step with the map element.
  new ResizeObserver(() => {
    camera?.resize(renderer.app.screen.width, renderer.app.screen.height);
  }).observe(host);

  // One loop: Pixi's ticker drives rendering, stroke flushing and HUD.
  const onFrame = (ticker: Ticker): void => {
    const cam = camera;
    if (cam && keysDown.size > 0) {
      const dt = ticker.deltaMS * KEY_PAN_PX_PER_MS * (numberOption(options, 'input.panSpeed') / 100);
      const dx = (keysDown.has('ArrowRight') || keysDown.has('KeyD') ? 1 : 0) - (keysDown.has('ArrowLeft') || keysDown.has('KeyA') ? 1 : 0);
      const dy = (keysDown.has('ArrowDown') || keysDown.has('KeyS') ? 1 : 0) - (keysDown.has('ArrowUp') || keysDown.has('KeyW') ? 1 : 0);
      if (dx !== 0 || dy !== 0) cam.panBy(-dx * dt, -dy * dt);
    }
    flushStroke();

    const cursor: CursorState = {
      tile: strokeOp(state.armed) !== null && cursorScreen && camera ? tileAt(cursorScreen.x, cursorScreen.y) : null,
      radius: brushRadius(),
      shape: state.shape,
    };
    // Edge pan: only with a fine pointer, since touch leaves a stale hover position behind.
    if (cam && cursorScreen && !pressed && boolOption(options, 'input.edgePan') && canHover && state.armed?.kind !== 'brush') {
      const edge = edgePanVector(cursorScreen.x, cursorScreen.y, host.clientWidth, host.clientHeight);
      if (edge.dx !== 0 || edge.dy !== 0) {
        const step = ticker.deltaMS * KEY_PAN_PX_PER_MS * (numberOption(options, 'input.panSpeed') / 100) * 2;
        cam.panBy(-edge.dx * step, -edge.dy * step);
      }
    }
    if (cam) {
      renderer.setView({ offX: cam.offX, offY: cam.offY, zoom: cam.zoom, dpr: renderer.app.renderer.resolution }, cursor);
    }

    fpsFrames++;
    const now = performance.now();
    if (now - fpsSince >= 500) {
      fps = (fpsFrames * 1000) / (now - fpsSince);
      fpsFrames = 0;
      fpsSince = now;
      const tps = ((simTick - lastTps.tick) * 1000) / Math.max(1, now - lastTps.at);
      lastTps = { tick: simTick, at: now, value: tps };
      setDebug({
        fps,
        tick: simTick,
        avgTickMs: simAvgTickMs,
        tps: lastTps.value,
        speed: simSpeed,
        hash: simHash,
        side: realmSide,
        zoom: cam?.zoom ?? 0,
      });
    }
  };
  renderer.app.ticker.add(onFrame);

  // Initial realm: ?seed= and ?size= override the defaults (size is sizeStep, 4 = 256 tiles).
  const seed = parseIntParam(params, 'seed') ?? Math.floor(Math.random() * 0x7fffffff);
  const sizeStep = parseIntParam(params, 'size') ?? DEFAULT_SIZE_STEP;
  await client.init();
  await client.newRealm(seed, sizeStep);
  client.setSpeed(state.paused ? 0 : state.speed);
  applySpeed();
  renderPowers();
  setArmed(null);
  setShape('circle');

  // Hooks for the Playwright tests; read-only except newRealm/speed through the UI.
  (window as unknown as { __sr: unknown }).__sr = {
    tick: () => simTick,
    hash: () => simHash,
    side: () => realmSide,
    tileToScreen: (x: number, y: number) => {
      const cam = camera;
      if (!cam) return null;
      const rect = host.getBoundingClientRect();
      return { x: rect.left + cam.offX + (x + 0.5) * cam.zoom, y: rect.top + cam.offY + (y + 0.5) * cam.zoom };
    },
    query: (x: number, y: number) => client.query(x, y),
    stroke: (x0: number, y0: number, x1: number, y1: number) => client.stroke('raise', 'circle', 5, x0, y0, x1, y1, true),
    speed: (s: Speed) => {
      state.speed = s;
      state.paused = false;
      applySpeed();
    },
    commands: () => [...client.sentKinds],
    openWindow: () => windowHost.current,
    snapshot: () => simView.current,
    rule: (id: string) => rules.isOn(id),
    cooldownFraction: (id: string) => {
      const power = POWER_BY_ID.get(id);
      return power ? cooldownFraction(performance.now(), cooldownUntil.get(id) ?? 0, power.cooldownMs) : 0;
    },
    powerCount: () => POWERS.length,
  };

  setStatus('Tap a tile to inspect it.');
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  }
}

boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  journal('BOOT_FAILED', message);
  showFatal('Could not start', message);
});
