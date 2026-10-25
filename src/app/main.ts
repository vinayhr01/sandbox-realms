import '../ui/styles.css';
import type { Ticker } from 'pixi.js';
import { TerrainRenderer, type CursorState } from '../render/terrain.ts';
import { MarkLayer } from '../render/marks.ts';
import { InsightLayer } from '../render/insight-layers.ts';
import { Camera } from '../render/camera.ts';
import { MapInput } from '../ui/input.ts';
import { edgePanVector } from '../ui/edgePan.ts';
import { colourFilterMarkup, layoutMaxWidth, mapCanvasFilter, type ColourBlindPalette, type LayoutChoice } from '../ui/display.ts';
import { Minimap, type MinimapView } from '../ui/minimap.ts';
import { SaveService } from './saves.ts';
import { CANNOT_CAPTURE, CANNOT_RESTORE, SaveController, type ActionOutcome, type AutosaveState, type ChronicleSource } from './save-controller.ts';
import { setCalendar, setDebug, setStatus, toast } from '../ui/hud.ts';
import { boolOption, loadOptions, numberOption, saveOptions, setOption, stringOption, type KeyValueStorage, type OptionValue, type Options } from '../ui/panels/options.ts';
import { cooldownFraction, selectTab, type TabState } from '../ui/panels/powerBar.ts';
import { currentStep, parseTutorial, skipTutorial, TUTORIAL_TEXT, tutorialEvent, type TutorialState } from '../ui/panels/tutorial.ts';
import { cooldownSecondsLeft, hamletAtTile, linePoints, masterOfViewFlag, nearestMapPoint, nextOptionValue, powerStatus, strokeOp, toggleViewFlag, viewFlagsDefault } from '../ui/powerSupport.ts';
import { HistoryTicker, TickerView } from '../ui/historyTicker.ts';
import { WorldTip, beingTipLines, tileTipLines } from '../ui/worldTip.ts';
import { WindowHost } from '../ui/windowHost.ts';
import { windowFor, type ChronicleActions, type ChronicleOutcome, type WindowDeps, type WindowParams } from '../ui/windowContent.ts';
import { SimView } from '../ui/sim-view.ts';
import { POWER_BY_ID, POWERS, TABS, powersInTab, type PowerDef, type TabId } from '../content/powers.ts';
import { Ev, type BrushOp, type BrushShape, type Event as SimEvent, type Speed } from '../shared/protocol.ts';
import { MONTH_TICKS, YEAR_TICKS, DEFAULT_SIZE_STEP } from '../shared/constants.ts';
import { RULE_BY_ID, RuleSet } from '../sim/rules.ts';
import { AudioEngine } from '../audio/engine.ts';
import { audioOptionsFrom, CUE, musicViewState, type Cue } from './audio-wiring.ts';
import { LAYER_CAP_DESKTOP, LAYER_CAP_PHONE } from '../audio/music.ts';
import { panFor } from '../audio/mix.ts';
import { MusicFeed } from '../audio/feed.ts';
import { CueOverlay, StingerWatch, captionFor, cueOptionsFrom, hapticPattern, vibrate } from '../ui/cues.ts';
import { SimClient } from './sim-client.ts';
import {
  bootGuard,
  decideRecovery,
  fatalOpen,
  hideFatal,
  installGlobalErrorHandlers,
  journal,
  loadAttempts,
  safeModeOn,
  setFatalDetail,
  setSafeMode,
  showFatal,
  startSentinel,
  storeAttempt,
  storeBoots,
  type FatalAction,
  type FaultKind,
  DEGRADE_MAX_FRAME_MS,
  DEGRADE_OFF,
  DEGRADE_RENDER_SCALE,
  DEGRADE_RENDER_SCALE_LEVEL,
  DEGRADE_START,
  stepDegrade,
  workerStalled,
  type DegradeTrack,
} from './recovery.ts';
import { contentHash } from '../content/content-hash.ts';
import { exportCrashRecord, noteCrashRun, recordCrash, setCrashConsent } from './crash-record.ts';

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

/**
 * Worldgen progress bar (03 section 10): a determinate bar with the stage name, shown while a generation job runs.
 * Built here rather than in index.html, so the page markup is unchanged. Hidden until the first progress event.
 */
function worldgenBar(): { show(stage: string, progress: number): void; hide(): void } {
  const box = document.createElement('div');
  box.id = 'worldgen-progress';
  box.hidden = true;
  box.style.cssText =
    'position:fixed;left:16px;right:16px;bottom:16px;z-index:60;max-width:420px;margin:0 auto;padding:10px 12px;border-radius:8px;background:rgba(16,16,24,0.92);color:#f2f2f2;font:14px/1.3 system-ui,sans-serif;';
  const label = document.createElement('div');
  const track = document.createElement('div');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', 'World generation');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.style.cssText = 'height:6px;margin-top:6px;border-radius:3px;background:#3a3a48;overflow:hidden;';
  const fill = document.createElement('div');
  fill.style.cssText = 'height:100%;width:0%;background:#7fb069;';
  track.append(fill);
  box.append(label, track);
  document.body.append(box);
  return {
    show(stage, progress) {
      const pct = Math.max(0, Math.min(100, Math.floor(progress * 100)));
      label.textContent = `${stage} ${pct}%`;
      track.setAttribute('aria-valuenow', String(pct));
      fill.style.width = `${pct}%`;
      box.hidden = false;
    },
    hide() {
      box.hidden = true;
    },
  };
}

/** Starts a new Realm from the crash dialog. Set once the sim client exists. */
let restartRealm: (() => void) | null = null;

/** The newest-autosave restore for the recovery dialogs (19 section 7). Set once the save controller exists. */
interface AutosaveRecovery {
  hasSave: () => Promise<boolean>;
  restore: () => Promise<ActionOutcome>;
}
let autosaveRecovery: AutosaveRecovery | null = null;

/** The restore button. `hasSave` null means the save list is still being read, so the button waits. */
function restoreAction(hasSave: boolean | null, primary: boolean, onRestored: () => void = () => undefined): FatalAction {
  return {
    label: 'Restore last autosave',
    primary: primary && hasSave === true,
    disabled: hasSave !== true,
    run: async () => {
      const outcome: ActionOutcome = autosaveRecovery ? await autosaveRecovery.restore() : { ok: false, message: 'Saves are not ready yet.' };
      if (outcome.ok) {
        onRestored();
        hideFatal();
      } else {
        setFatalDetail(outcome.message);
      }
    },
  };
}

function safeModeAction(primary: boolean): FatalAction {
  return {
    label: 'Start in Safe Mode',
    primary,
    run: () => {
      setSafeMode(true);
      location.reload();
    },
  };
}

/** Writes the crash record and downloads it when the player asks. Nothing is sent (19 section 9). */
async function exportCrashAndDownload(): Promise<void> {
  const out = await exportCrashRecord();
  if (out.ok && out.name !== undefined && out.bytes !== undefined) downloadFile(out.name, out.bytes);
  setFatalDetail(out.message);
}

/** Crash reporter for the recovery dialog. The ladder (19 section 7) decides which recovery buttons it offers. */
function reportCrash(kind: FaultKind, title: string, detail: string, stack?: string, ctx: 'main' | 'worker' = 'main'): void {
  // The dialog shows at once; the restore button waits until the save list has been read.
  showFatal(title, detail, [restoreAction(null, false), safeModeAction(false)]);
  void (async () => {
    const hasSave = autosaveRecovery ? await autosaveRecovery.hasSave() : false;
    const now = Date.now();
    const decision = decideRecovery({ kind, nowMs: now, attempts: loadAttempts(), hasValidAutosave: hasSave });
    storeAttempt({ atMs: now, kind, level: decision.level ?? 'fatal_dialog' });
    void recordCrash({ kind, ctx, message: detail, stack, recovery: decision.level ?? 'none' });
    const actions: FatalAction[] = [restoreAction(hasSave, decision.level === 'restart_from_autosave')];
    if (kind === 'sim_fatal' && decision.level === 'reset_realm' && restartRealm) {
      const restart = restartRealm;
      actions.push({
        label: 'Start a new Realm',
        primary: true,
        run: () => {
          hideFatal();
          restart();
        },
      });
    }
    actions.push({ label: 'Export crash record', run: exportCrashAndDownload });
    actions.push(safeModeAction(decision.enterSafeMode));
    showFatal(title, detail, actions);
  })();
}

/** The boot-loop dialog (19 section 4). `hasSave` null while the save list is read. */
function showBootLoopDialog(hasSave: boolean | null): void {
  showFatal(
    'Stopped several times in a row',
    'This page stopped unexpectedly three times in a few minutes. Restore the last autosave, start in Safe Mode to run with audio off and less motion, or keep going as normal.',
    [
      restoreAction(hasSave, true, () => storeBoots([])),
      {
        label: 'Start in Safe Mode',
        run: () => {
          setSafeMode(true);
          storeBoots([]);
          location.reload();
        },
      },
      {
        label: 'Keep going normally',
        run: () => {
          storeBoots([]);
          hideFatal();
        },
      },
    ],
  );
}

/** Saves bytes as a file the browser downloads (the export action). */
function downloadFile(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

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
  installGlobalErrorHandlers(reportCrash);
  const guard = bootGuard(Date.now(), startSentinel());
  if (!supported()) {
    showFatal(
      'Browser not supported',
      'Sandbox Realms needs Chrome 90+, Safari 15.4+ or Firefox 114+ with WebGL2 and module workers.',
    );
    return;
  }

  // Safe Mode (19 section 7) lasts for this tab: audio off, reduced motion and flashing, 30 fps.
  const safeMode = safeModeOn();
  noteCrashRun({ safeMode });
  const params = new URLSearchParams(location.search);
  const debugOverlay = params.has('debug');

  const host = $('map');
  const renderer = await TerrainRenderer.create(host);
  // Map marks and beings: added after the terrain so they draw on top of it.
  const marks = new MarkLayer(renderer.app);
  // Insight layers and overlays: added after the marks, so the tints and icons draw over them.
  const insight = new InsightLayer(renderer.app);
  const client = new SimClient();
  const progressBar = worldgenBar();
  // Audio feed: the Age, biome shares and mood from each snapshot (16 B8). Read by the music state below.
  const musicFeed = new MusicFeed();
  // A respawned worker has lost its realm: resume from the newest autosave when there is one.
  client.onRespawn(() => {
    if (autosaveRecovery) void autosaveRecovery.restore();
  });
  restartRealm = () => {
    void client.newRealm(Math.floor(Math.random() * 0x7fffffff), DEFAULT_SIZE_STEP);
  };
  const rules = new RuleSet();
  const audio = new AudioEngine();

  // Settings: the OS preference fills reduce motion and flashing until the player chooses.
  const osDefaults: Options = {
    ...loadOptions(null),
    'ui.reduceMotion': osPrefers('(prefers-reduced-motion: reduce)'),
    'ui.reduceFlash': osPrefers('(prefers-reduced-motion: reduce)'),
  };
  let options: Options = loadOptions(safeStorage(), osDefaults);
  setCrashConsent(boolOption(options, 'privacy.errorReports'));
  const startSpeed = Number.parseFloat(stringOption(options, 'game.defaultSpeed'));

  // Audio starts on the first gesture (16 B6), never before. Safe Mode keeps it off.
  let audioUnlocked = false;
  const unlockAudio = (): void => {
    if (audioUnlocked || safeMode) return;
    audioUnlocked = true;
    audio.unlock();
    // Music starts with the first gesture after unlock (16 B6); the layer cap depends on the device (B8).
    audio.setLayerCap(window.matchMedia('(pointer: coarse)').matches ? LAYER_CAP_PHONE : LAYER_CAP_DESKTOP);
    audio.startMusic();
    for (const type of ['pointerdown', 'keydown', 'touchend'] as const) window.removeEventListener(type, unlockAudio, true);
  };
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(type, unlockAudio, true);
  // Visual cues, captions and haptics (16 B9): one caption line, mounted once.
  const cueLayer = new CueOverlay(document);
  /** Feedback for a cue whether or not the sound plays: the haptic pattern, then the caption when on. */
  const cueFeedback = (cue: string): void => {
    const o = cueOptionsFrom(options);
    vibrate(hapticPattern(cue, o.haptics));
    cueLayer.caption(captionFor(cue, o.visualCues));
  };
  const playCue = (cue: string): void => {
    if (audioUnlocked) audio.play(cue, performance.now());
    cueFeedback(cue);
  };
  /** A cue for a tile on the map, panned by where the tile sits on screen (16 B4). */
  const playCueAt = (cue: string, tileX: number): void => {
    const cam = camera;
    if (audioUnlocked) {
      const width = renderer.app.screen.width;
      const pan = cam ? panFor(tileX, (width / 2 - cam.offX) / cam.zoom, width / 2 / cam.zoom, audio.currentOptions.spatialIntensity) : 0;
      audio.play(cue, performance.now(), pan, 1);
    }
    cueFeedback(cue);
  };
  /** Stingers implied by the snapshot feed (Age change, war and peace). The first snapshot only sets the baseline. */
  const stingers = new StingerWatch();
  let musicClockMs = 0;
  /** A notification: a toast with its cue. */
  const notify = (text: string, cue: Cue = CUE.notify): void => {
    toast(text);
    playCue(cue);
  };

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
  /** Step drag (Settings): the first tap of a two-tap stroke, or null. */
  let stepAnchor: Tile | null = null;
  /** Insight Follow: armed (the next tap picks a being) and the being followed, by its snapshot id. */
  let followPending = false;
  let followId: number | null = null;
  /** Insight Hamlet Select: armed (the next tap picks a tile) and the hamlet picked (hamletsOf index, or -1). */
  let hamletPending = false;
  let selectedHamlet = -1;
  /** Insight view flags (UI only, not saved): arrow kinds, tip kinds and the O07 ticker (src/ui/powerSupport.ts). */
  const viewFlags = viewFlagsDefault();
  /** O07 history feed, in memory and rebuilt from snapshots; its strip on the map; the cursor tooltip. */
  const historyFeed = new HistoryTicker();
  const tickerView = new TickerView(document.body);
  const worldTip = new WorldTip(document.body);
  let cursorScreen: { x: number; y: number } | null = null;
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let pressed = false;
  const keysDown = new Set<string>();
  const cooldownUntil = new Map<string, number>();

  let simTick = 0;
  /** The sim tick at the last successful autosave; the autosave is due only when the tick has moved on. */
  let savedTick = -1;
  let simHash = 0;
  let simAvgTickMs = 0;
  let simSpeed = 1;
  let lastTps = { tick: 0, at: performance.now(), value: 0 };
  let fpsFrames = 0;
  let fpsSince = performance.now();
  let fps = 0;

  // Runtime health (17 sections 3.4, 10). The watchdog reads heartbeats. The ladder lowers render settings
  // in memory only: the saved options and the sim are never written.
  let watchdogShown = false;
  let degrade: DegradeTrack = DEGRADE_START;
  let degradeLevel = 0;
  const degradedOff = new Set<string>();
  let degradeWindowMs = 0;
  let degradeWindowFrameMs = 0;
  let degradeWindowFrames = 0;
  const frameBudgetMs = (): number => {
    const cap = safeMode ? 30 : numberOption(options, 'ui.fpsCap');
    return 1000 / (cap > 0 ? cap : 60);
  };
  const effectiveRenderScale = (): number => {
    const saved = numberOption(options, 'perf.renderScale');
    return degradeLevel >= DEGRADE_RENDER_SCALE_LEVEL ? Math.min(saved, DEGRADE_RENDER_SCALE) : saved;
  };
  const applyDegradeLevel = (level: number, meanMs: number): void => {
    degradeLevel = level;
    degradedOff.clear();
    for (let k = 0; k < level && k < DEGRADE_OFF.length; k++) degradedOff.add(DEGRADE_OFF[k] ?? '');
    renderer.setRenderScale(effectiveRenderScale());
    journal('DEGRADE', `level ${level} at mean frame ${meanMs.toFixed(1)} ms; off: ${[...degradedOff].join(', ') || 'none'}; render scale ${effectiveRenderScale()}%`);
  };
  /** One sample per frame; a verdict once per one-second window (17 section 3.4 hysteresis lives in stepDegrade). */
  const degradeFrame = (deltaMs: number): void => {
    if (deltaMs > DEGRADE_MAX_FRAME_MS) return;
    degradeWindowMs += deltaMs;
    degradeWindowFrameMs += deltaMs;
    degradeWindowFrames++;
    if (degradeWindowMs < 1000) return;
    const mean = degradeWindowFrames > 0 ? degradeWindowFrameMs / degradeWindowFrames : 0;
    const next = stepDegrade(degrade, mean, frameBudgetMs());
    if (next.level !== degrade.level) applyDegradeLevel(next.level, mean);
    degrade = next;
    degradeWindowMs = 0;
    degradeWindowFrameMs = 0;
    degradeWindowFrames = 0;
  };
  const showNotResponding = (): void => {
    const wait: FatalAction = {
      label: 'Wait',
      run: () => {
        watchdogShown = false;
        client.resetHeartbeat();
        hideFatal();
      },
    };
    // Copy follows 17 section 10 and 19 section 2: "Simulation not responding", with Reload and Wait.
    const restart: FatalAction = {
      label: 'Reload',
      primary: true,
      run: () => {
        watchdogShown = false;
        hideFatal();
        client.restartWorker('The simulation stopped responding.');
      },
    };
    showFatal(
      'Simulation not responding',
      'The simulation has not reported for six seconds. Reload to resume from the newest autosave, or wait a little longer.',
      [restart, wait],
    );
  };
  /** Shows the not-responding dialog after a stall, and clears it when heartbeats return. */
  const watchdogCheck = (now: number): void => {
    if (!client.watchdogArmed || document.hidden) return;
    const stalled = workerStalled(client.lastHeartbeat, now);
    if (stalled && !watchdogShown) {
      watchdogShown = true;
      journal('WORKER_STALL', 'no heartbeat for 6 s');
      void recordCrash({ kind: 'worker_dead', ctx: 'worker', message: 'no heartbeat for 6 s', recovery: 'none' });
      showNotResponding();
    } else if (!stalled && watchdogShown) {
      watchdogShown = false;
      hideFatal();
    }
  };

  // Display layers and the minimap (Settings). The vignette and minimap sit over the map canvas;
  // the colour-blind filter markup is mounted once, and the map canvas gets its filter in applyOptions.
  document.body.insertAdjacentHTML('beforeend', colourFilterMarkup());
  const vignette = document.createElement('div');
  vignette.className = 'map-vignette';
  vignette.setAttribute('aria-hidden', 'true');
  host.appendChild(vignette);
  const minimapCanvas = document.createElement('canvas');
  minimapCanvas.className = 'minimap';
  minimapCanvas.setAttribute('aria-label', 'Minimap. Tap or drag to move the camera.');
  minimapCanvas.setAttribute('role', 'img');
  host.appendChild(minimapCanvas);
  const minimap = new Minimap(minimapCanvas, (tx, ty) => {
    const cam = camera;
    if (!cam) return;
    cam.offX = renderer.app.screen.width / 2 - (tx + 0.5) * cam.zoom;
    cam.offY = renderer.app.screen.height / 2 - (ty + 0.5) * cam.zoom;
    cam.panBy(0, 0);
  });
  const minimapView = (): MinimapView | null => {
    const cam = camera;
    if (!cam) return null;
    const tl = cam.screenToTile(0, 0);
    const br = cam.screenToTile(renderer.app.screen.width, renderer.app.screen.height);
    return { x0: tl.x, y0: tl.y, x1: br.x, y1: br.y };
  };
  let minimapClockMs = 0;

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
    minimap.reset(side);
    camera = new Camera(side, renderer.app.screen.width, renderer.app.screen.height);
    stroke = null;
    stepAnchor = null;
    followPending = false;
    followId = null;
    hamletPending = false;
    selectedHamlet = -1;
    historyFeed.clear();
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
    // Pausing is a natural save point (15 section 5).
    if (state.paused) saveController.onPause(autosaveState());
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
        openWindow(String(power.params['window'] ?? ''));
        return;
      case 'toggle_hud':
        document.documentElement.classList.toggle('hide-ui');
        return;
      case 'toggle_rule':
        setRule(String(power.params['rule'] ?? ''), !rules.isOn(String(power.params['rule'] ?? '')));
        return;
      case 'arm_inspect':
        setArmed(null);
        return;
      case 'follow':
        // Follow waits for a tap on a being (onTap). Esc or a manual pan releases it.
        setArmed(null);
        followPending = true;
        setStatus('Tap a being to follow it. Esc releases.');
        return;
      case 'select_hamlet':
        // Hamlet Select waits for a tap on a tile (onTap), which picks the hamlet owning that tile.
        setArmed(null);
        hamletPending = true;
        setStatus('Tap a tile to select the hamlet that owns it.');
        return;
      case 'layer_toggle': {
        // One layer at a time. Tapping a layer that is off shows it as borders; tapping it again steps
        // being, then parent, then off.
        const layer = String(power.params['layer'] ?? 'off');
        const current = stringOption(options, 'map.layer');
        const mode = stringOption(options, 'map.layerMode');
        let nextLayer = layer;
        let nextMode = 'borders';
        if (current === layer) {
          if (mode === 'borders') nextMode = 'being';
          else if (mode === 'being') nextMode = 'parent';
          else nextLayer = 'off';
        }
        changeOption('map.layer', nextLayer);
        changeOption('map.layerMode', nextMode);
        setStatus(nextLayer === 'off' ? `${power.name}: off.` : `${power.name}: ${nextMode} view.`);
        return;
      }
      case 'toggle_option': {
        const option = String(power.params['option'] ?? '');
        const on = !boolOption(options, option);
        changeOption(option, on);
        setStatus(`${power.name}: ${on ? 'on' : 'off'}.`);
        return;
      }
      case 'cycle_option': {
        const option = String(power.params['option'] ?? '');
        const values = String(power.params['values'] ?? '').split(',');
        const next = nextOptionValue(stringOption(options, option), values);
        changeOption(option, next);
        setStatus(`${power.name}: ${next}.`);
        return;
      }
      case 'toggle_view': {
        // Insight view flags (arrow kinds, tip kinds, the O07 ticker). Their Settings master may be off: say so.
        const key = String(power.params['key'] ?? '');
        const on = toggleViewFlag(viewFlags, key);
        const master = masterOfViewFlag(key);
        const note =
          master !== null && on && !boolOption(options, master)
            ? ` Turn on ${master === 'ui.cursorArrows' ? 'Cursor arrows' : 'World tooltips'} in Settings to see it.`
            : '';
        setStatus(`${power.name}: ${on ? 'on' : 'off'}.${note}`);
        updatePowerButtons();
        return;
      }
      default:
        setArmed(state.armed?.id === power.id ? null : power);
    }
  };

  /** Keeps aria-pressed on the power buttons in step with the armed power and the rules. */
  const updatePowerButtons = (): void => {
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.power')) {
      const power = POWER_BY_ID.get(btn.dataset['powerId'] ?? '');
      if (!power) continue;
      const pressed =
        power.handler === 'toggle_rule'
          ? rules.isOn(String(power.params['rule']))
          : power.handler === 'toggle_option'
            ? boolOption(options, String(power.params['option']))
            : power.handler === 'toggle_view'
              ? viewFlags.has(String(power.params['key']))
            : power.handler === 'layer_toggle'
              ? stringOption(options, 'map.layer') === String(power.params['layer'])
              : state.armed?.id === power.id;
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
    stepAnchor = null;
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
    if (power) {
      feedTutorial('tool-armed');
      playCue(CUE.arm);
    }
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
    // Natural disasters is a mirror of its Realm Rule (13 section 15): the Settings row follows the rule.
    if (id === 'natural_calamities' && boolOption(options, 'game.disasters') !== on) {
      options = setOption(options, 'game.disasters', on);
      saveOptions(safeStorage(), options);
    }
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
    playCueAt(op ? CUE.paint : CUE.power, x);
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
  const openWindow = (id: string, params: WindowParams = {}): void => {
    const build = windowFor(id, windowDeps, params);
    if (!build) {
      setStatus('That window is not available yet.');
      return;
    }
    windowHost.open(id, build.title, build.build, build.live);
    playCue(CUE.windowOpen);
    // A live window asks for a snapshot now, so it has numbers while the sim is paused.
    if (build.live) client.requestSnapshot();
  };

  // The latest sim snapshot (Ev.Snapshot). Windows read it through windowDeps.snapshot.
  const simView = new SimView();

  // The save store opens on first use (the Chronicle window); it never rejects, so a failed open
  // shows an empty list instead of an error.
  const liveRealm: ChronicleSource = {
    canCapture: true,
    canRestore: true,
    capture: async () => {
      const bytes = await client.capture();
      if (!bytes) return null;
      const info = { realmName: $('realm-name').textContent ?? 'Realm', tick: simTick, year: Math.floor(simTick / YEAR_TICKS) + 1 };
      return { bytes, info };
    },
    restore: (bytes) => client.restore(bytes),
  };
  const saveController = new SaveController(
    () =>
      SaveService.open(window.indexedDB, {
        isPhone: window.matchMedia('(pointer: coarse)').matches,
        storage: navigator.storage,
      }),
    liveRealm,
    {
      onAutosaved: () => {
        savedTick = simTick;
      },
    },
  );
  autosaveRecovery = {
    hasSave: () => saveController.restoreTarget(safeModeOn()).then((target) => target !== null),
    restore: () => saveController.restoreAutosave(safeModeOn()),
  };
  // Boot-loop guard (19 section 4): repeated unclean boots offer the restore, Safe Mode, or carrying on.
  // The save list is read first, so the restore button is enabled only when a valid autosave exists.
  if (guard.loop) {
    showBootLoopDialog(null);
    void autosaveRecovery.hasSave().then((has) => {
      if (fatalOpen()) showBootLoopDialog(has);
    });
  }
  const exportToFile = async (slotId: string): Promise<ChronicleOutcome> => {
    const file = await saveController.exportSave(slotId);
    if (!file) return { ok: false, message: 'That save no longer exists.' };
    downloadFile(file.name, file.bytes);
    return { ok: true, message: `Exported ${file.name}.` };
  };
  const chronicle: ChronicleActions = {
    get saveBlocked() {
      return saveController.canSave ? null : CANNOT_CAPTURE;
    },
    get loadBlocked() {
      return saveController.canLoad ? null : CANNOT_RESTORE;
    },
    storage: () => saveController.storage(),
    run: (action, slotId) => saveController.perform(action, slotId),
    exportSave: exportToFile,
    importFile: (file) => file.arrayBuffer().then((buf) => saveController.importFile(file.name, new Uint8Array(buf))),
  };
  const windowDeps: WindowDeps = {
    options: () => options,
    saves: () => saveController.list(),
    chronicle,
    setOption: (id, value) => changeOption(id, value),
    snapshot: () => simView.current,
    sendCommand: (command) => {
      client.send(command);
    },
    open: (id, params) => openWindow(id, params),
    brush: () => ({ shape: state.shape, sizeIndex: state.sizeIndex, radii: BRUSH_RADII }),
    setBrush: (patch) => {
      if (patch.shape !== undefined) setShape(patch.shape);
      if (patch.sizeIndex !== undefined) {
        sizeInput.value = String(patch.sizeIndex);
        updateSizeOutput();
      }
    },
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
  // What the autosave timer and the pause and hide saves need to know about the UI right now.
  const autosaveState = (): AutosaveState => ({
    dirty: simTick !== savedTick,
    modalOpen: windowHost.current !== null,
    gestureActive: stroke !== null,
    degradeLevel: 0,
  });
  $('window-close').addEventListener('click', () => windowHost.close());
  simView.subscribe(() => {
    // The O07 feed reads each snapshot once as it arrives (in memory only, src/ui/historyTicker.ts).
    if (simView.current) historyFeed.push(simView.current);
    windowHost.feed();
  });

  /** The being under a screen point in the latest snapshot: within 10 px, or 24 px on touch. Null when none. */
  const pickBeing = (sx: number, sy: number): { id: number } | null => {
    const cam = camera;
    const points = simView.current?.mapPoints;
    if (!cam || !points) return null;
    const radius = window.matchMedia('(pointer: coarse)').matches ? 24 : 10;
    return nearestMapPoint(points, cam, sx, sy, radius);
  };

  /** Reads one tile from the sim and reports it in the status line. Held presses say so. */
  const inspectTile = (t: { x: number; y: number }, held: boolean): void => {
    void client.query(t.x, t.y).then((r) => {
      if (!r.inBounds) {
        setStatus('Off the map.');
        return;
      }
      const prefix = held ? 'Held: ' : '';
      setStatus(`${prefix}Tile ${r.tileX}, ${r.tileY} · elevation ${r.elevation} · ${r.ground}`);
      feedTutorial('tile-inspected');
    });
  };

  // Map input. A brush power (raise, lower, ground paint) drags; everything else pans.
  new MapInput(renderer.app.canvas, {
    brushArmed: () => state.armed?.kind === 'brush' && camera !== null,
    toolArmed: () => state.armed !== null,
    onPan: (dx, dy) => {
      const k = numberOption(options, 'input.panSpeed') / 100;
      // A manual pan releases Follow (the camera would otherwise fight the drag).
      followId = null;
      camera?.panBy(dx * k, dy * k);
    },
    onZoom: (factor, sx, sy) => {
      const base = boolOption(options, 'input.invertZoom') ? 1 / factor : factor;
      camera?.zoomAt(base ** (numberOption(options, 'input.zoomSpeed') / 100), sx, sy);
    },
    stickyHold: () => boolOption(options, 'input.stickyHold'),
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
    onHold: (sx, sy) => {
      // Hold-to-raise: a still press under an armed brush repeats its application (13 section 9).
      const power = state.armed;
      if (!power) return;
      const t = tileAt(sx, sy);
      cursorScreen = { x: sx, y: sy };
      usePowerAt(power, t.x, t.y);
    },
    onLongPress: (sx, sy) => {
      cursorScreen = { x: sx, y: sy };
      inspectTile(tileAt(sx, sy), true);
    },
    onDoubleTap: (sx, sy) => {
      // Double-tap zooms in one step on the tap point (the browser's own double-tap zoom stays off).
      camera?.zoomAt(2, sx, sy);
    },
    onStrokeUndo: () => {
      // The sim keeps no per-stroke journal, so a second finger ends the stroke and keeps what it painted.
      flushStroke();
      if (stroke) feedTutorial('stroke-finished');
      stroke = null;
      setStatus('Undo is not available yet: the stroke stays as painted.');
    },
    onTap: (sx, sy) => {
      const t = tileAt(sx, sy);
      cursorScreen = { x: sx, y: sy };
      const armedOp = state.armed ? strokeOp(state.armed) : null;
      if (state.armed && armedOp && boolOption(options, 'input.stepDrag')) {
        // Step drag: tap the first point, then the second; the stroke runs between them (13 section 15).
        if (!stepAnchor) {
          stepAnchor = t;
          setStatus('Tap the second point to finish the stroke.');
        } else {
          client.stroke(armedOp, state.shape, brushRadius(), stepAnchor.x, stepAnchor.y, t.x, t.y, true);
          playCueAt(CUE.paint, t.x);
          stepAnchor = null;
          setStatus('Stroke placed. Tap a first point for the next one.');
        }
        return;
      }
      if (state.armed) {
        usePowerAt(state.armed, t.x, t.y);
        return;
      }
      if (hamletPending) {
        hamletPending = false;
        const idx = hamletAtTile(simView.current?.mapTiles, t.x, t.y);
        selectedHamlet = idx;
        const row = idx >= 0 ? simView.current?.hamlets[idx] : undefined;
        if (idx < 0) setStatus('No hamlet owns that tile.');
        else if (row) setStatus(`${row.name}: ${row.folk} folk, ${row.buildings} buildings, ${row.parcels} parcels.`);
        else setStatus(`Hamlet ${idx + 1} is selected. Its row is not in the latest snapshot.`);
        return;
      }
      if (followPending) {
        const hit = pickBeing(sx, sy);
        if (hit) {
          followId = hit.id;
          followPending = false;
          setStatus('Following that being. Esc or a pan releases it.');
        } else {
          setStatus('No being there. Tap a being to follow it, or press Esc.');
        }
        return;
      }
      // Inspect (default tap with nothing armed): a being near the tap opens its window when the
      // snapshot holds its row (the notable sample); otherwise the tile is read as before.
      const hit = pickBeing(sx, sy);
      if (hit && simView.current?.detail?.notable?.beings.some((b) => b.id === hit.id)) {
        openWindow('win_being', { id: hit.id });
        return;
      }
      inspectTile(t, false);
    },
  });

  // A job resumed after a reload finished (Ready, reply 0). No request asked for it and the page's own NewRealm
  // (sent at start) is the realm the page shows, so this only clears the bar and is logged; it starts no realm.
  client.onResumed(() => {
    progressBar.hide();
    journal('WORLDGEN_RESUMED', 'a generation job resumed after reload finished; the page keeps its own realm');
  });

  client.onEvent((event: SimEvent) => {
    switch (event.kind) {
      case Ev.Ready:
        // Resumed jobs go to onResumed, so this is a reply to a request, or the NewRealm a respawn sends for the last realm.
        progressBar.hide();
        if (event.side > 0) setRealmSide(event.side, event.seed);
        return;
      case Ev.WorldgenProgress:
        progressBar.show(event.resumed ? `Resuming: ${event.name}` : event.name, event.progress);
        return;
      case Ev.Frame:
        if (event.rows) {
          renderer.applyRows(event.rows);
          minimap.applyRows(event.rows, realmSide);
          client.returnBuffer(event.rows.data.buffer as ArrayBuffer);
        }
        simTick = event.stats.tick;
        simHash = event.stats.stateHash;
        simAvgTickMs = event.stats.avgTickMs;
        simSpeed = event.stats.speed;
        noteCrashRun({ tick: simTick, speed: simSpeed });
        calendarText = `Y${Math.floor(simTick / YEAR_TICKS) + 1} M${(Math.floor(simTick / MONTH_TICKS) % 12) + 1}`;
        setCalendar(calendarText);
        return;
      case Ev.Fault:
        progressBar.hide();
        journal(event.code, event.detail);
        if (event.severity === 'fatal')
          reportCrash(event.code === 'WORKER_ERROR' ? 'worker_dead' : 'sim_fatal', 'The simulation stopped', event.detail, undefined, 'worker');
        else notify(event.detail, CUE.error);
        return;
      case Ev.Snapshot:
        noteCrashRun({ age: event.snap.age ?? null });
        simView.apply(event.snap);
        musicFeed.ingest(event.snap);
        for (const id of stingers.ingest(event.snap.age ?? null, event.snap.dominions.filter((d) => d.atWar).length)) playCue(id);
        return;
      case Ev.QueryResult:
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
    // The disasters row is a mirror of its Realm Rule: the rule changes first, and a refused change keeps the old value.
    if (id === 'game.disasters' && !setRule('natural_calamities', value === true)) return;
    options = setOption(options, id, value);
    saveOptions(safeStorage(), options);
    if (id === 'privacy.errorReports') setCrashConsent(boolOption(options, 'privacy.errorReports'));
    if (id === 'ui.fullscreen') toggleFullscreen(options[id] === true);
    // Hide status bar on phones: full screen is requested when the row is turned on (13 section 15).
    if (id === 'ui.hideStatusBar' && value === true && window.matchMedia('(pointer: coarse)').matches) toggleFullscreen(true);
    applyOptions();
    // Insight toggles and cycles show their state on the power buttons.
    updatePowerButtons();
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
    root.toggleAttribute('data-reduce-motion', safeMode || boolOption(options, 'ui.reduceMotion'));
    root.toggleAttribute('data-reduce-flash', safeMode || boolOption(options, 'ui.reduceFlash'));
    renderer.app.ticker.maxFPS = safeMode ? 30 : numberOption(options, 'ui.fpsCap');
    renderer.setRenderScale(effectiveRenderScale());
    $('debug').hidden = !(boolOption(options, 'ui.showFps') || debugOverlay);
    // Layout width, map layers, vignette and minimap.
    const layout = stringOption(options, 'ui.layout') as LayoutChoice;
    root.dataset['layout'] = layout;
    const maxWidth = layoutMaxWidth(layout);
    root.style.setProperty('--layout-max', maxWidth === null ? 'none' : `${maxWidth}px`);
    renderer.app.canvas.style.filter = mapCanvasFilter(stringOption(options, 'ui.colorBlindPalette') as ColourBlindPalette, numberOption(options, 'map.layerBrightness'));
    renderer.app.canvas.style.opacity = String(numberOption(options, 'map.layerOpacity') / 100);
    vignette.hidden = !boolOption(options, 'map.vignette');
    minimapCanvas.hidden = !boolOption(options, 'ui.minimap');
    const minimapPx = `${numberOption(options, 'ui.minimapSize')}px`;
    minimapCanvas.style.width = minimapPx;
    minimapCanvas.style.height = minimapPx;
    // Autosave on/off, interval and ring size (15 section 5).
    saveController.configureAutosave(boolOption(options, 'game.autosave'), numberOption(options, 'game.autosaveMinutes'), numberOption(options, 'game.autosaveKeep'));
    const cueOpts = cueOptionsFrom(options);
    cueLayer.setEnabled(cueOpts.visualCues);
    audio.applyOptions({ ...audioOptionsFrom(options), mono: cueOpts.mono, reduceLoudSounds: cueOpts.reduceLoudSounds, visualCues: cueOpts.visualCues, haptics: cueOpts.haptics });
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
      followPending = false;
      followId = null;
      hamletPending = false;
      setArmed(null);
    }
  });
  window.addEventListener('keyup', (e: KeyboardEvent) => keysDown.delete(e.code));
  // Pause when the window loses focus, when the Settings row asks for it. Focus does not resume the sim.
  window.addEventListener('blur', () => {
    if (boolOption(options, 'game.pauseOnBlur') && !state.paused) togglePause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      client.setSpeed(0);
      void saveController.suspend();
    } else {
      applySpeed();
      // Heartbeats may have paused while hidden; judge the worker from now on.
      client.resetHeartbeat();
    }
    audio.setHidden(document.hidden);
  });
  window.addEventListener('pagehide', () => {
    void saveController.suspend();
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
      if (dx !== 0 || dy !== 0) {
        cam.panBy(-dx * dt, -dy * dt);
        followId = null;
      }
    }
    // Follow: centre the camera on the followed being's latest snapshot position. The sample holds the
    // oldest 96 beings, so a being outside it is lost (the status says so). A snapshot without points keeps it.
    if (cam && followId !== null) {
      const points = simView.current?.mapPoints;
      const p = points?.find((q) => q.id === followId);
      if (p) {
        cam.offX = renderer.app.screen.width / 2 - (p.x + 0.5) * cam.zoom;
        cam.offY = renderer.app.screen.height / 2 - (p.y + 0.5) * cam.zoom;
        cam.panBy(0, 0);
      } else if (points) {
        followId = null;
        setStatus('Lost sight of the being you were following.');
      }
    }
    saveController.frame(ticker.deltaMS, state.paused || document.hidden, autosaveState());
    degradeFrame(ticker.deltaMS);
    watchdogCheck(performance.now());
    flushStroke();

    // The music state is published about once a second (16 B8: never more often than that).
    musicClockMs += ticker.deltaMS;
    if (audioUnlocked && cam && musicClockMs >= 1000) {
      musicClockMs = 0;
      const zoom01 = (cam.zoom - cam.minZoom) / (cam.maxZoom - cam.minZoom);
      audio.setMusicState(musicViewState({ paused: state.paused || document.hidden, zoom01 }, musicFeed.partial()));
    }

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
      marks.update(
        simView.current,
        {
          items: boolOption(options, 'marks.items'),
          favourites: boolOption(options, 'marks.favourites'),
          armies: boolOption(options, 'marks.armies'),
          campaigns: boolOption(options, 'marks.campaigns'),
          battles: boolOption(options, 'marks.battles'),
          intrigues: boolOption(options, 'marks.intrigues'),
          boats: boolOption(options, 'marks.boats'),
          names: stringOption(options, 'map.names') as 'full' | 'banner' | 'off',
          favouritesOnlyNames: boolOption(options, 'map.favouritesOnlyNames'),
          nameScale: numberOption(options, 'ui.scaleNames'),
        },
        { offX: cam.offX, offY: cam.offY, zoom: cam.zoom, viewW: renderer.app.screen.width, viewH: renderer.app.screen.height },
      );
      // Insight hover (desktop only): the Being under the pointer, where the cursor arrows start.
      const hoverPoint =
        simView.current && cursorScreen && canHover && !pressed
          ? nearestMapPoint(simView.current.mapPoints ?? [], cam, cursorScreen.x, cursorScreen.y, 10)
          : null;
      insight.update(
        simView.current,
        {
          layer: stringOption(options, 'map.layer'),
          mode: stringOption(options, 'map.layerMode'),
          happiness: boolOption(options, 'ui.happinessIcons'),
          tasks: boolOption(options, 'ui.taskIcons'),
          armyLines: boolOption(options, 'marks.armyLines'),
          selectedHamlet,
          talkBubbles: boolOption(options, 'ui.talkBubbles'),
          // The arrow kinds only when the Settings master is on, and never on touch.
          arrows: boolOption(options, 'ui.cursorArrows') && canHover ? new Set([...viewFlags].filter((k) => k.startsWith('arrow.'))) : new Set<string>(),
          hoverId: hoverPoint?.id ?? -1,
        },
        { offX: cam.offX, offY: cam.offY, zoom: cam.zoom },
      );
      // Cursor tooltip: the Being under the pointer (tip.beings), else the tile (tip.tiles). Settings master ui.worldTooltips.
      const snapNow = simView.current;
      let tip: string[] | null = null;
      if (snapNow && cursorScreen && canHover && !pressed && boolOption(options, 'ui.worldTooltips')) {
        if (hoverPoint) {
          if (viewFlags.has('tip.beings')) tip = beingTipLines(hoverPoint, snapNow.mapKinds?.find((k) => k.id === hoverPoint.id));
        } else if (viewFlags.has('tip.tiles')) {
          const at = tileAt(cursorScreen.x, cursorScreen.y);
          tip = tileTipLines(snapNow, at.x, at.y);
        }
      }
      if (tip && cursorScreen) {
        const rect = host.getBoundingClientRect();
        worldTip.show(tip, rect.left + cursorScreen.x, rect.top + cursorScreen.y);
      } else {
        worldTip.hide();
      }
      // O07 history ticker: the newest three changes, while the flag is on.
      tickerView.show(viewFlags.has('ticker') ? historyFeed.recent(3) : null);
      renderer.setView({ offX: cam.offX, offY: cam.offY, zoom: cam.zoom, dpr: renderer.app.renderer.resolution }, cursor);
    }
    // The minimap repaints about four times a second; it is skipped while hidden.
    minimapClockMs += ticker.deltaMS;
    if (minimapClockMs >= 250) {
      minimapClockMs = 0;
      if (!minimapCanvas.hidden) minimap.draw(minimapView());
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
  const ready = await client.init();
  // Refuse to run when the worker's registries differ from this page's (17 section 2.2, 10). An empty hash
  // means no worker answered, which the crash path already reports.
  const ownHash = contentHash();
  if (ready.kind === Ev.Ready && ready.contentHash !== '' && ready.contentHash !== ownHash) {
    journal('CONTENT_MISMATCH', `simulation ${ready.contentHash}, page ${ownHash}`);
    showFatal('Build mismatch', 'This page and its simulation come from different builds, so no Realm was started. Reload the page to get the current build.');
    return;
  }
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
    degrade: () => ({ level: degradeLevel, off: [...degradedOff], renderScale: effectiveRenderScale() }),
  };

  setStatus(safeMode ? 'Safe Mode: audio is off and motion is reduced in this tab.' : 'Tap a tile to inspect it.');
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  }
}

boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  journal('BOOT_FAILED', message);
  showFatal('Could not start', message);
});
