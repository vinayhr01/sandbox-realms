import '../ui/styles.css';
import type { Ticker } from 'pixi.js';
import { TerrainRenderer, type CursorState } from '../render/terrain.ts';
import { Camera } from '../render/camera.ts';
import { MapInput } from '../ui/input.ts';
import { setCalendar, setDebug, setStatus, toast } from '../ui/hud.ts';
import { loadOptions, saveOptions, setOption, type KeyValueStorage, type Options } from '../ui/panels/options.ts';
import { selectTab, type TabState } from '../ui/panels/powerBar.ts';
import { POWER_BY_ID, TABS, powersInTab, type PowerDef, type TabId } from '../content/powers.ts';
import { Ev, type BrushOp, type BrushShape, type Event as SimEvent, type Speed } from '../shared/protocol.ts';
import { MONTH_TICKS, YEAR_TICKS, DEFAULT_SIZE_STEP } from '../shared/constants.ts';
import { SimClient } from './sim-client.ts';
import { installGlobalErrorHandlers, journal, showFatal, startSentinel } from './recovery.ts';

/** Brush radii in tiles for slider positions 0..10 (04 section 1.1 sizes, trimmed for M1). */
const BRUSH_RADII = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const;
const DEFAULT_SIZE_INDEX = 5;
const SPEED_CHOICES: readonly Speed[] = [0.5, 1, 2, 5, 10];
/** Keyboard or arrow pan speed in CSS px per millisecond. */
const KEY_PAN_PX_PER_MS = 0.6;

type Tile = { x: number; y: number };

/** Brush powers the sim can apply today; every other power arms but does nothing on the map yet. */
const BRUSH_OPS: Readonly<Record<string, BrushOp>> = { terraform_raise: 'raise', terraform_lower: 'lower' };
const opOf = (power: PowerDef | null): BrushOp | null => (power ? (BRUSH_OPS[power.handler] ?? null) : null);

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
  op: BrushOp;
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
  if (debugOverlay) $('debug').hidden = false;

  const host = $('map');
  const renderer = await TerrainRenderer.create(host);
  const client = new SimClient();

  const state: UiState = {
    armed: null,
    shape: 'circle',
    sizeIndex: DEFAULT_SIZE_INDEX,
    speed: 1,
    paused: false,
  };

  let camera: Camera | null = null;
  let realmSide = 0;
  let stroke: Stroke | null = null;
  let cursorScreen: { x: number; y: number } | null = null;
  const keysDown = new Set<string>();

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

  const brushOp = (): BrushOp | null => opOf(state.armed);

  // Power bar: one tab per power group; only the selected group's buttons exist in the DOM.
  let powerTab: TabState = { active: TABS[0], tabs: TABS };
  const tabLabel = (tab: TabId): string => tab.charAt(0).toUpperCase() + tab.slice(1);
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
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'power';
        btn.dataset['powerId'] = power.id;
        btn.setAttribute('aria-pressed', String(state.armed?.id === power.id));
        btn.textContent = power.name;
        btn.addEventListener('click', () => setArmed(state.armed?.id === power.id ? null : power));
        return btn;
      }),
    );
  };

  /** Arms a power (null = inspect). Terrain tool buttons and the power bar both show the same state. */
  const unsupportedNote = (power: PowerDef): string => `${power.name} is armed. Only Raise and Lower work on the map so far.`;
  const setArmed = (power: PowerDef | null): void => {
    // A stroke in progress belongs to the old power: end it before the new one takes over.
    if (stroke) {
      flushStroke();
      stroke = null;
    }
    state.armed = power;
    const op = opOf(power);
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.tool')) {
      const tool = btn.dataset['tool'];
      btn.setAttribute('aria-pressed', String(power === null ? tool === 'inspect' : tool === op));
    }
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.power')) {
      btn.setAttribute('aria-pressed', String(btn.dataset['powerId'] === power?.id));
    }
    if (!power) setStatus('Tap a tile to inspect it.');
    else if (op) setStatus(`${op === 'raise' ? 'Raise' : 'Lower'}: drag to shape the land.`);
    else setStatus(unsupportedNote(power));
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

  const flushStroke = (): void => {
    if (!stroke) return;
    const { last, target } = stroke;
    if (target.x === last.x && target.y === last.y) return;
    client.stroke(stroke.op, state.shape, brushRadius(), last.x, last.y, target.x, target.y, false);
    stroke.last = target;
  };

  // Listeners hold the handlers, so the input object needs no reference of its own.
  new MapInput(renderer.app.canvas, {
    brushArmed: () => brushOp() !== null && camera !== null,
    onPan: (dx, dy) => camera?.panBy(dx, dy),
    onZoom: (factor, sx, sy) => camera?.zoomAt(factor, sx, sy),
    onHover: (sx, sy) => {
      cursorScreen = { x: sx, y: sy };
    },
    onStrokeStart: (sx, sy) => {
      const op = brushOp();
      if (!op) return;
      const t = tileAt(sx, sy);
      stroke = { op, last: t, target: t };
      cursorScreen = { x: sx, y: sy };
      client.stroke(op, state.shape, brushRadius(), t.x, t.y, t.x, t.y, true);
    },
    onStrokeMove: (sx, sy) => {
      cursorScreen = { x: sx, y: sy };
      if (stroke) stroke.target = tileAt(sx, sy);
    },
    onStrokeEnd: () => {
      flushStroke();
      stroke = null;
    },
    onTap: (sx, sy) => {
      const t = tileAt(sx, sy);
      cursorScreen = { x: sx, y: sy };
      if (state.armed) {
        const op = brushOp();
        if (op) client.stroke(op, state.shape, brushRadius(), t.x, t.y, t.x, t.y, true);
        else setStatus(unsupportedNote(state.armed));
        return;
      }
      void client.query(t.x, t.y).then((r) => {
        if (!r.inBounds) {
          setStatus('Off the map.');
          return;
        }
        setStatus(`Tile ${r.tileX}, ${r.tileY} · elevation ${r.elevation} · ${r.ground}`);
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
        setCalendar(`Y${Math.floor(simTick / YEAR_TICKS) + 1} M${(Math.floor(simTick / MONTH_TICKS) % 12) + 1}`);
        return;
      case Ev.Fault:
        journal(event.code, event.detail);
        if (event.severity === 'fatal') showFatal('The simulation stopped', event.detail);
        else toast(event.detail);
        return;
      case Ev.QueryResult:
      case Ev.Heartbeat:
        return;
    }
  });

  // Controls.
  $('pause').addEventListener('click', () => {
    state.paused = !state.paused;
    applySpeed();
  });
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.speed-btn')) {
    btn.addEventListener('click', () => {
      state.speed = Number(btn.dataset['speed']) as Speed;
      state.paused = false;
      applySpeed();
    });
  }
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.tool')) {
    btn.addEventListener('click', () => setArmed(toolPower(btn.dataset['tool'] ?? 'inspect')));
  }

  // Options: stored through the options model; storage access can throw, so it is wrapped.
  const safeStorage = (): KeyValueStorage | null => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };
  let options: Options = loadOptions(safeStorage());
  const scaleInput = $<HTMLInputElement>('ui-scale');
  const motionInput = $<HTMLInputElement>('reduce-motion');
  const applyOptions = (): void => {
    document.documentElement.style.setProperty('--ui-scale', String(options.scale / 100));
    document.documentElement.toggleAttribute('data-reduce-motion', options.reduceMotion);
    scaleInput.value = String(options.scale);
    $('ui-scale-out').textContent = `${options.scale}%`;
    motionInput.checked = options.reduceMotion;
  };
  const changeOption = <K extends keyof Options>(key: K, value: Options[K]): void => {
    options = setOption(options, key, value);
    saveOptions(safeStorage(), options);
    applyOptions();
  };
  applyOptions();
  scaleInput.addEventListener('input', () => changeOption('scale', Number(scaleInput.value)));
  motionInput.addEventListener('change', () => changeOption('reduceMotion', motionInput.checked));
  const optionsDialog = $<HTMLDialogElement>('options');
  $('settings-open').addEventListener('click', () => {
    applyOptions();
    optionsDialog.showModal();
  });
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
      state.paused = !state.paused;
      applySpeed();
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
  });

  // Keep the camera viewport in step with the map element.
  new ResizeObserver(() => {
    camera?.resize(renderer.app.screen.width, renderer.app.screen.height);
  }).observe(host);

  // One loop: Pixi's ticker drives rendering, stroke flushing and HUD.
  const onFrame = (ticker: Ticker): void => {
    const cam = camera;
    if (cam && keysDown.size > 0) {
      const dt = ticker.deltaMS * KEY_PAN_PX_PER_MS;
      const dx = (keysDown.has('ArrowRight') || keysDown.has('KeyD') ? 1 : 0) - (keysDown.has('ArrowLeft') || keysDown.has('KeyA') ? 1 : 0);
      const dy = (keysDown.has('ArrowDown') || keysDown.has('KeyS') ? 1 : 0) - (keysDown.has('ArrowUp') || keysDown.has('KeyW') ? 1 : 0);
      if (dx !== 0 || dy !== 0) cam.panBy(-dx * dt, -dy * dt);
    }
    flushStroke();

    const cursor: CursorState = {
      tile: brushOp() !== null && cursorScreen && camera ? tileAt(cursorScreen.x, cursorScreen.y) : null,
      radius: brushRadius(),
      shape: state.shape,
    };
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
  renderPowers();
  setArmed(null);
  setShape('circle');

  // Hooks for the Playwright smoke tests; read-only except newRealm/speed through the UI.
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
