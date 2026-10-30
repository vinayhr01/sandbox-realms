import '../ui/styles.css';
import type { CursorState } from '../render/terrain.ts';
import { createRenderer2D, renderCostMs } from '../render/renderer2d.ts';
import { VIEW_FALLBACK_TOAST, chooseView, readSavedView, startView, webgl2Available, writeSavedView, type ViewKind } from './view-choice.ts';
import type { WorldRenderer } from '../render/world-renderer.ts';
import { recipeFor } from '../render/effectRecipes.ts';
import { FeedInterp, type DrawBeing } from '../render/feed-interp.ts';
import { BeingState } from '../shared/being-feed.ts';
import { MapInput } from '../ui/input.ts';
import { Crosshair, MapInput3D, type MapInput3DHandlers } from '../ui/input3d.ts';
import { Joystick } from '../ui/joystick.ts';
import { edgePanVector } from '../ui/edgePan.ts';
import { colourFilterMarkup, layoutMaxWidth, mapCanvasFilter, type ColourBlindPalette, type LayoutChoice } from '../ui/display.ts';
import { Minimap, type MinimapView } from '../ui/minimap.ts';
import { SaveService } from './saves.ts';
import { CANNOT_CAPTURE, CANNOT_RESTORE, STILL_RESUMING, SaveController, type ActionOutcome, type AutosaveState, type ChronicleSource } from './save-controller.ts';
import { setDebug } from '../ui/hud.ts';
import { createStore, pushToast, type InfoTarget, type LocatedInfo, type ShellActions } from '../ui/shell/store.ts';
import { dispatchKey, focusSheetSearch, isTyping, panBlocked, shellKeysBlocked, type KeyContext } from '../ui/shell/keymap.ts';
import { recentRow } from '../ui/shell/powerCatalog.ts';
import { chipsFor, discoveryToast, evaluate, DISCOVERY_KEY, newDiscovery, parseDiscovery, type DiscoveryState } from '../ui/shell/discovery.ts';
import { loadPowerPrefs, savePowerPrefs } from '../ui/shell/powerPrefs.ts';
import { effect } from '@preact/signals';
import { mountShell, mountToasts } from '../ui/shell/mount.tsx';
import { closeAtlas, currentAtlasKind, feedAtlas, mountAtlas, showAtlas } from '../ui/shell/Atlas.tsx';
import { feedFacts, hamletFacts } from '../ui/shell/InfoCard.tsx';
import { favouriteBeing } from '../ui/session-memory.ts';
import { boolOption, loadOptions, numberOption, saveOptions, setOption, stringOption, type KeyValueStorage, type OptionValue, type Options } from '../ui/panels/options.ts';
import { cooldownFraction } from '../ui/panels/powerBar.ts';
import { mountPossessPad, possessActionOfCode, type PossessAction } from '../ui/panels/possessControls.ts';
import { currentStep, parseTutorial, skipTutorial, tutorialEvent, type TutorialState } from '../ui/panels/tutorial.ts';
import { cooldownSecondsLeft, dominionAtTile, hamletAtTile, linePoints, masterOfViewFlag, nextOptionValue, powerStatus, strokeOp, toggleViewFlag, viewFlagsDefault } from '../ui/powerSupport.ts';
import { HistoryTicker, TickerView } from '../ui/historyTicker.ts';
import { WorldTip, beingTipLines, tileTipLines } from '../ui/worldTip.ts';
import { WindowHost } from '../ui/windowHost.ts';
import { windowFor, type ChronicleActions, type ChronicleOutcome, type WindowDeps, type WindowParams } from '../ui/windowContent.ts';
import { SimView } from '../ui/sim-view.ts';
import { SPECIES } from '../content/beasts.ts';
import { POWER_BY_ID, POWERS, type PowerDef } from '../content/powers.ts';
import { humanize, plainName } from '../content/plain-names.ts';
import { Ev, PING_LOST_MS, POSSESS_REFUSED, type BrushOp, type BrushShape, type Event as SimEvent, type Snapshot, type Speed } from '../shared/protocol.ts';
import { MONTH_TICKS, YEAR_TICKS, DEFAULT_SIZE_STEP } from '../shared/constants.ts';
import { RULE_BY_ID, RuleSet } from '../sim/rules.ts';
import { MAX_BEINGS } from '../sim/beings/store.ts';
import { AudioEngine } from '../audio/engine.ts';
import { audioOptionsFrom, CUE, musicViewState, type Cue } from './audio-wiring.ts';
import { LAYER_CAP_DESKTOP, LAYER_CAP_PHONE } from '../audio/music.ts';
import { panFor } from '../audio/mix.ts';
import { MusicFeed } from '../audio/feed.ts';
import { CueOverlay, StingerWatch, captionFor, cueOptionsFrom, hapticPattern, vibrate } from '../ui/cues.ts';
import { SimClient } from './sim-client.ts';
import {
  bootGuard,
  crumb,
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
  DEGRADE_START,
  ladderExhausted,
  ladderFor,
  ladderMaxLevel,
  mainHangGap,
  renderScaleCapFor,
  stepDegrade,
  workerStalled,
  type DegradeTrack,
} from './recovery.ts';
import { contentHash } from '../content/content-hash.ts';
import { consentFromOption, exportCrashRecord, firstFatalNote, noteCrashRun, recordCrash, setCrashConsent } from './crash-record.ts';
import { exportDiagnostics, type DiagnosticsSource } from './diagnostics.ts';
import { logLine } from './log-ring.ts';
import { noteFrameMs, noteSimMs, startLongTaskWatch } from './perf-sample.ts';

/** Brush radii in tiles for slider positions 0..10 (04 section 1.1 sizes, trimmed for M1). */
const BRUSH_RADII = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16] as const;
const DEFAULT_SIZE_INDEX = 5;
const SPEED_CHOICES: readonly Speed[] = [0.5, 1, 2, 5, 10];
/** Keyboard or arrow pan speed in CSS px per millisecond. */
const KEY_PAN_PX_PER_MS = 0.6;
/** 3D: one Q or E press turns the view by 15 degrees. */
const KEY_ROTATE_RAD = Math.PI / 12;
/** Storage key for the first-run tutorial state (per device). */
const TUTORIAL_KEY = 'tutorial';

type Tile = { x: number; y: number };

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

/** The emergency save for fatal paths (19 section 7 step 3b). Resolves to a step name. Set once the save controller exists. */
let emergencySave: (() => Promise<string>) | null = null;

/** The page state the diagnostics bundle reads at export time (17 section 9). Set in boot once the quality ladder exists. */
let diagnosticsSource: () => DiagnosticsSource = () => ({
  degradeLevel: 0,
  degradedOff: [],
  renderScale: 100,
  safeMode: false,
  realmSeed: 0,
  realmSide: 0,
  // Before boot there is no worker to ask: the read never settles, so the export reports commandLog false.
  readCommands: () => new Promise<never>(() => undefined),
});

/** Settings that change the picture's cost. A change to one is a QUALITY breadcrumb (19 section 3). */
const QUALITY_OPTIONS: ReadonlySet<string> = new Set(['ui.fpsCap', 'perf.renderScale', 'map.shadows', 'map.bloom', 'map.particles', 'map.treeWind']);

/** When the last main_hang record was written. A frozen page can trip both the frame-gap check and the worker's ping check. */
let mainHangRecordedMs = Number.NEGATIVE_INFINITY;
const MAIN_HANG_DEDUP_MS = 10_000;

/**
 * The Continue button of a stopped sim, shown off (17 section 9 labels it "Continue (feature disabled)"). A fatal stop has
 * no running sim to resume, so the button cannot be pressed (19 section 7).
 */
const CONTINUE_OFF: FatalAction = { label: 'Continue (feature disabled)', disabled: true, run: () => undefined };

/** The reload button (17 section 9: "Reload last autosave"). `hasSave` null means the save list is still being read, so the button waits. */
function restoreAction(hasSave: boolean | null, primary: boolean, onRestored: () => void = () => undefined): FatalAction {
  return {
    label: 'Reload last autosave',
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

/** Writes the newest crash record and downloads it when the player asks. Nothing is sent (19 sections 8, 9). */
async function exportCrashToFile(): Promise<ChronicleOutcome> {
  const out = await exportCrashRecord();
  if (out.ok && out.name !== undefined && out.bytes !== undefined) downloadFile(out.name, out.bytes);
  return { ok: out.ok, message: out.message };
}

/** Writes the diagnostics bundle (17 section 9) and downloads it when the player asks. Nothing is sent (19 section 9). */
async function exportDiagnosticsToFile(): Promise<ChronicleOutcome> {
  const out = await exportDiagnostics(diagnosticsSource());
  if (out.ok && out.name !== undefined && out.bytes !== undefined) downloadFile(out.name, out.bytes);
  return { ok: out.ok, message: out.message };
}

async function exportDiagnosticsAndDownload(): Promise<void> {
  setFatalDetail((await exportDiagnosticsToFile()).message);
}

/**
 * Crash reporter for the recovery dialog. The ladder (19 section 7) decides which recovery buttons it offers. The dialog
 * shows at once; then the emergency save runs inside its budget, the record is written with the steps taken, and the
 * dialog gets its full buttons. The sim has already stopped stepping on sim_fatal (the worker stops its pump), and a
 * dead worker has nothing left to step.
 */
function reportCrash(kind: FaultKind, title: string, detail: string, stack?: string, ctx: 'main' | 'worker' = 'main', sys?: string): void {
  // The dialog shows at once; the restore button waits until the save list has been read.
  showFatal(title, detail, [restoreAction(null, false), safeModeAction(false)]);
  void (async () => {
    const saved = emergencySave ? await emergencySave() : 'emergency_save_unavailable';
    const hasSave = autosaveRecovery ? await autosaveRecovery.hasSave() : false;
    const now = Date.now();
    const decision = decideRecovery({ kind, nowMs: now, attempts: loadAttempts(), hasValidAutosave: hasSave });
    storeAttempt({ atMs: now, kind, level: decision.level ?? 'fatal_dialog' });
    const steps = decision.level ? [saved, decision.level] : [saved];
    void recordCrash({ kind, ctx, message: detail, stack, sys, recovery: steps });
    // The first fatal dialog explains the consent choice once (19 section 9).
    const note = firstFatalNote();
    const text = note === null ? detail : `${detail} ${note}`;
    // The spec's order is Reload last autosave, Continue, Export diagnostics (17 section 9); the others follow it.
    // js_main leaves the sim running, so it has no Continue button here.
    const actions: FatalAction[] = [restoreAction(hasSave, decision.level === 'restart_from_autosave')];
    if (kind !== 'js_main') actions.push(CONTINUE_OFF);
    actions.push({ label: 'Export diagnostics', run: exportDiagnosticsAndDownload });
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
    actions.push(safeModeAction(decision.enterSafeMode));
    showFatal(title, text, actions);
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

/**
 * Lifetime discovery state (src/ui/shell/discovery.ts): the met entries and the powers seen are saved. The seen-species
 * and strain memory is per realm and in memory (setRealmSide clears it). A missing or unreadable state starts from nothing.
 */
function loadDiscovery(): DiscoveryState {
  try {
    const raw = safeStorage()?.getItem(DISCOVERY_KEY);
    return parseDiscovery(raw ? JSON.parse(raw) : null);
  } catch {
    return newDiscovery();
  }
}

function saveDiscovery(state: DiscoveryState): void {
  try {
    // The met entries and the powers seen persist; `seen` and `strains` are per realm and in memory.
    safeStorage()?.setItem(DISCOVERY_KEY, JSON.stringify({ found: state.found, seenPowers: state.seenPowers }));
  } catch {
    // Not saved: discoveries are met again on the next visit (old saves meet them at once).
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
  startLongTaskWatch();
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
  // The UI shell's state (spec A). The shell itself mounts over the map once the controls are wired, below.
  const store = createStore();
  // Favourites and the recent row survive a reload (safe storage, key sr.powers.v1). Saved on every change.
  const savedPrefs = loadPowerPrefs(safeStorage());
  store.favourites.value = savedPrefs.favourites;
  store.recent.value = savedPrefs.recent;
  effect(() => {
    savePowerPrefs(safeStorage(), { favourites: store.favourites.value, recent: store.recent.value });
  });
  const setStatus = (text: string): void => {
    store.status.value = text;
  };

  const host = $('map');
  // The map host's screen rect, read on resize rather than every frame (the info card, the tooltip and tile maths use it).
  let hostRect = host.getBoundingClientRect();
  // The view (spec "Renderer choice"): ?view=, then the saved sr.view, then the default. 3D loads its chunk here, before
  // the first map frame, so the map never draws 2D and then swaps. A failed 3D start falls back to 2D (toast below).
  const requestedView: ViewKind = chooseView({
    query: params.get('view'),
    saved: readSavedView(safeStorage()),
    webgl2: webgl2Available(),
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    safeMode,
  });
  const started = await startView(requestedView, host, {
    load3D: async (h) => (await import('../render3d/index.ts')).createRenderer3D(h),
    load2D: createRenderer2D,
  });
  // The world view, behind the WorldRenderer seam: terrain, creatures, marks, effects and insight layers.
  const renderer: WorldRenderer = started.renderer;
  // The being feed (Ev.Beings), smoothed for drawing. The first beingCount entries of drawBeings are this frame's beings.
  const interp = new FeedInterp({ coalesce: true });
  const drawBeings: DrawBeing[] = [];
  let beingCount = 0;
  /** Main-thread ms of the creature pipeline per frame (feed push + sample + draw, dust included), for the perf gate. */
  const COST_RING = 600;
  const costRing = new Float64Array(COST_RING);
  let costWritten = 0;
  /** Feed-push time since the last frame; it is charged to the next frame's sample. */
  let pushCostMs = 0;
  /** True once a feed has arrived for the current realm, so a followed being missing from the feed is lost. */
  let beingsFed = false;
  /** Realm setups so far, counted at each realm setup; the e2e tests read it to see that a New World reached the layer. */
  const creatureReset = { resets: 0 };
  const client = new SimClient();
  // The worker judges this page by its pings (19 section 2, main_hang); hidden pages are not judged.
  client.startPings(() => document.hidden);
  const progressBar = worldgenBar();
  // Audio feed: the Age, biome shares and mood from each snapshot (16 B8). Read by the music state below.
  const musicFeed = new MusicFeed();
  // A respawned worker has lost its realm: resume from the newest autosave when there is one.
  client.onRespawn(() => {
    if (autosaveRecovery) void autosaveRecovery.restore();
  });
  /** True from boot until the resume of the newest save has landed; map input is ignored meanwhile. */
  let resumingWorld = false;
  window.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (resumingWorld && e.target === renderer.canvas) {
        e.stopImmediatePropagation();
        setStatus('Resuming…');
      }
    },
    true,
  );
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
    // The Settings View row shows the view this page asked for until the player picks one.
    'map.view': requestedView,
  };
  let options: Options = loadOptions(safeStorage(), osDefaults);
  setCrashConsent(consentFromOption(stringOption(options, 'privacy.errorReports')));
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
    if (audioUnlocked) {
      // Before the first realm the view has no tiles: the half-width is 0 and panFor gives no pan.
      const seen = renderer.camera.visibleTiles();
      const pan = panFor(tileX, renderer.camera.centreTile().x, (seen.x1 - seen.x0) / 2, audio.currentOptions.spatialIntensity);
      audio.play(cue, performance.now(), pan, 1);
    }
    cueFeedback(cue);
  };
  /** Stingers implied by the snapshot feed (Age change, war and peace). The first snapshot only sets the baseline. */
  const stingers = new StingerWatch();
  let musicClockMs = 0;
  /** A notification: a toast with its cue. */
  const notify = (text: string, cue: Cue = CUE.notify): void => {
    pushToast(store, text);
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
  let discovery: DiscoveryState = loadDiscovery();
  /** True once the first realm has set up the view's camera; before that the view has no tiles. */
  let worldReady = false;
  let realmSide = 0;
  let realmSeed = 0;
  let calendarText = 'Y1 M1';
  let stroke: Stroke | null = null;
  /** Step drag (Settings): the first tap of a two-tap stroke, or null. */
  let stepAnchor: Tile | null = null;
  /** Insight Follow: armed (the next tap picks a being) and the being followed, by its feed key (slot << 16 | generation). */
  let followPending = false;
  let followKey: number | null = null;
  /** Insight Possess (07 section 13): armed (the next tap picks a being), and the being held by its snapshot id or null. Not saved. */
  let possessPending = false;
  let possessedId: number | null = null;
  /** The held Being's last order tile (its move target), and whether attack is held (J or the touch button). Not saved. */
  let possessOrder = { x: 0, y: 0 };
  let attackHeld = false;
  /** Touch pad for the held Being (src/ui/panels/possessControls.ts). Its handlers run possessControl, defined below. */
  const possessPad = mountPossessPad($('map'), {
    onAbility: (ability) => possessControl(ability, true),
    onAttack: (held) => possessControl('attack', held),
    onRelease: () => {
      if (possessedId !== null) releasePossession();
    },
  });
  /** Insight Hamlet Select: armed (the next tap picks a tile) and the hamlet picked (hamletsOf index, or -1). */
  let hamletPending = false;
  let selectedHamlet = -1;
  /** The tile a hamlet's info card was tapped on: its anchor, since the snapshot's hamlet rows carry no tile. */
  let hamletTile = { x: 0, y: 0 };
  /** Ties (Insight select step): waiting for a tap, and the dominion picked (-1 none). Not saved. */
  let dominionPending = false;
  let selectedDominion = -1;
  /** Accord Finder (Insight select step, 12 section 8.8): waiting for a tap, and the dominion picked (-1 none). Not saved. */
  let accordPending = false;
  let accordDominion = -1;
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
  /** The Age last written as a breadcrumb, so an Age change is recorded once. */
  let lastAgeCrumb: string | null = null;
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
  // Set when the page was hidden since the last frame, so a tab switch is not read as a freeze.
  let hiddenSinceFrame = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenSinceFrame = true;
  });
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
    const cap = renderScaleCapFor(renderer.kind, degradeLevel);
    return cap === null ? saved : Math.min(saved, cap);
  };
  // The 3D struggle toast shows once per session (sessionStorage, with a page-local fallback when storage throws).
  let struggleToastShown = false;
  const showStruggleToast = (): void => {
    if (struggleToastShown) return;
    struggleToastShown = true;
    try {
      if (window.sessionStorage.getItem('sr.struggle3d')) return;
      window.sessionStorage.setItem('sr.struggle3d', '1');
    } catch {
      // Without session storage the page-local flag still limits it to once per page.
    }
    pushToast(store, '3D is struggling on this device.', 'info', Date.now(), {
      label: 'Switch to 2D view',
      run: () => {
        writeSavedView(safeStorage(), '2d');
        location.reload();
      },
    });
  };
  const applyDegradeLevel = (level: number, meanMs: number): void => {
    degradeLevel = level;
    degradedOff.clear();
    const steps = ladderFor(renderer.kind);
    for (let k = 0; k < level && k < steps.length; k++) degradedOff.add(steps[k] ?? '');
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
    const max = ladderMaxLevel(renderer.kind);
    const next = stepDegrade(degrade, mean, frameBudgetMs(), renderer.liveEffects() === 0, max);
    if (next.level !== degrade.level) applyDegradeLevel(next.level, mean);
    if (renderer.kind === '3d' && next.level !== degrade.level && ladderExhausted(next, max)) showStruggleToast();
    degrade = next;
    degradeWindowMs = 0;
    degradeWindowFrameMs = 0;
    degradeWindowFrames = 0;
  };
  diagnosticsSource = () => ({
    degradeLevel,
    degradedOff: [...degradedOff],
    renderScale: effectiveRenderScale(),
    safeMode,
    realmSeed,
    realmSide,
    readCommands: () => client.replayCommands(),
  });
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
  /**
   * The main thread was frozen for `gapMs` (19 section 2, main_hang). Shown when the thread wakes, since a
   * frozen thread cannot draw anything. Journaled and recorded either way; the dialog waits when the
   * worker dialog is already open.
   */
  const showMainHang = (gapMs: number): void => {
    const seconds = Math.round(gapMs / 1000);
    journal('MAIN_HANG', `main thread frozen for about ${seconds} s`);
    const nowMs = Date.now();
    if (nowMs - mainHangRecordedMs > MAIN_HANG_DEDUP_MS) {
      mainHangRecordedMs = nowMs;
      void recordCrash({ kind: 'main_hang', ctx: 'main', message: `main thread frozen for about ${seconds} s`, recovery: [] });
    }
    if (watchdogShown) return;
    showFatal(
      'Not responding',
      `Sandbox Realms was frozen for about ${seconds} seconds and is running again. Wait to continue, or reload the page.`,
      [
        { label: 'Wait', run: () => hideFatal() },
        { label: 'Reload', primary: true, run: () => location.reload() },
      ],
    );
  };
  /** Shows the not-responding dialog after a stall, and clears it when heartbeats return. */
  const watchdogCheck = (now: number): void => {
    if (!client.watchdogArmed || document.hidden) return;
    const stalled = workerStalled(client.lastHeartbeat, now);
    if (stalled && !watchdogShown) {
      watchdogShown = true;
      journal('WORKER_STALL', 'no heartbeat for 6 s');
      void recordCrash({ kind: 'worker_dead', ctx: 'worker', message: 'no heartbeat for 6 s', recovery: [] });
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
    if (!worldReady) return;
    renderer.camera.centreOn({ x: tx, y: ty });
  });
  const minimapView = (): MinimapView | null => {
    if (!worldReady) return null;
    return renderer.camera.visibleTiles();
  };
  let minimapClockMs = 0;

  const brushRadius = (): number => BRUSH_RADII[state.sizeIndex] ?? 5;

  const tileAt = (sx: number, sy: number): Tile => {
    const t = renderer.screenToTile(sx, sy);
    if (!t) return { x: 0, y: 0 };
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
    worldReady = true;
    stroke = null;
    stepAnchor = null;
    followPending = false;
    followKey = null;
    // The info card and the effects of the old realm go too: being ids are reused across realms.
    store.info.value = null;
    // Extinctions and strains are judged within one realm: the species seen alive in the old one do not count in this one (spec E).
    discovery = { ...discovery, seen: [], strains: null };
    // A new, loaded or respawned realm has new Beings and buildings: the feed of the old one is dropped.
    // The feed sample goes here; the creature sprites go in renderer.setSide (resetCreatureView, split across the seam).
    interp.reset();
    creatureReset.resets++;
    beingCount = 0;
    beingsFed = false;
    // A new or loaded realm has new Beings: the held one is not carried over (control is not saved, 07 section 14).
    possessPending = false;
    possessedId = null;
    attackHeld = false;
    possessPad.setVisible(false);
    hamletPending = false;
    selectedHamlet = -1;
    dominionPending = false;
    selectedDominion = -1;
    accordPending = false;
    accordDominion = -1;
    historyFeed.clear();
    store.realm.value = { ...store.realm.value, name: `Realm ${seed.toString(36).toUpperCase().slice(-6)}` };
  };

  let lastSpeedCrumb = '';
  const applySpeed = (): void => {
    client.setSpeed(state.paused ? 0 : state.speed);
    const speedNow = state.paused ? 'paused' : `${state.speed}x`;
    if (speedNow !== lastSpeedCrumb) {
      lastSpeedCrumb = speedNow;
      crumb('SPEED', speedNow);
    }
    store.speed.value = state.speed;
    store.paused.value = state.paused;
  };

  /** The dialog title of a stopped sim, so a late save-list answer only redraws this dialog. */
  const SIM_PAUSED_TITLE = 'Simulation paused';
  /**
   * The sim switched itself off after a part's third switch-off (17 section 9, SYS_STOP). The worker has paused the sim and
   * the page shows that pause. The dialog offers the three options of 17 section 9 in their order. Continue resumes the sim
   * when the worker is still running, and the switched-off part stays off until its ticks run out. Reload last autosave
   * loads the newest valid save, which starts every part on.
   */
  const showSimStopped = (part: string | undefined, hasSave: boolean | null): void => {
    showFatal(
      SIM_PAUSED_TITLE,
      `A part of the simulation (${part ?? 'unknown'}) failed three times and is switched off. The simulation is paused.`,
      [
        restoreAction(hasSave, true),
        {
          label: 'Continue (feature disabled)',
          run: () => {
            hideFatal();
            state.paused = false;
            applySpeed();
          },
        },
        { label: 'Export diagnostics', run: exportDiagnosticsAndDownload },
      ],
    );
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

  /** The first-launch coach (shell top column): the current step, or null once the tutorial is done or skipped. */
  const renderCoach = (): void => {
    store.coach.value = currentStep(tutorial)?.id ?? null;
  };

  /** The chips the sheet shows: the starter chips plus those of the discoveries met (or all, with ui.allChips). */
  const refreshChips = (): void => {
    store.discovered.value = chipsFor(discovery.found, boolOption(options, 'ui.allChips'));
    store.found.value = [...discovery.found];
    store.seenPowers.value = [...discovery.seenPowers];
  };

  /** Marks powers as seen (the expanded grid showed them) or used. Their "New" markers clear and the seen set is saved. */
  const markPowersSeen = (ids: readonly string[]): void => {
    const fresh = ids.filter((id) => !discovery.seenPowers.includes(id));
    if (fresh.length === 0) return;
    discovery = { ...discovery, seenPowers: [...discovery.seenPowers, ...fresh] };
    saveDiscovery(discovery);
    refreshChips();
  };

  /** Evaluates the discovery triggers on each snapshot: chips come forward, and one card names what was met. */
  const noteDiscoveries = (snap: Snapshot): void => {
    // While a saved world resumes, the snapshots are the throwaway default world's: they are not judged (no false extinctions).
    if (resumingWorld) return;
    const next = evaluate(discovery, snap, { counters: snap.counters, sets: {} });
    if (next.state === discovery) return;
    discovery = next.state;
    saveDiscovery(discovery);
    refreshChips();
    const toast = discoveryToast(next.newly);
    if (toast) pushToast(store, toast.text, toast.kind);
  };

  const feedTutorial = (event: string): void => {
    const next = tutorialEvent(tutorial, event);
    if (next === tutorial) return;
    tutorial = next;
    saveTutorial(tutorial);
    renderCoach();
  };

  /** Releases the held Being (Cmd.Possess on=false) and clears the possession state. */
  const releasePossession = (): void => {
    const wasHeld = possessedId !== null;
    if (possessedId !== null) client.possess(possessedId, false, 0, 0, false);
    possessedId = null;
    possessPending = false;
    attackHeld = false;
    setStatus(wasHeld ? 'Possession released.' : 'Possess: off.');
    updatePowerButtons();
  };

  /** A Possess order the sim refused: the page drops its hold on the Being and says so. */
  const refusePossession = (): void => {
    possessedId = null;
    possessPending = false;
    attackHeld = false;
    possessPad.setVisible(false);
    setStatus("Can't take control of that being.");
    updatePowerButtons();
  };

  /**
   * Runs one possession control for the held Being (13 section 10 key or touch button; 07 section 13). Attack is held: each
   * change re-sends the order with the attack flag. An ability is one shot: a press sends the order with its flag set, on the
   * last order tile, and the held attack state is carried along (an order without it would clear the attack).
   */
  const possessControl = (action: PossessAction, held: boolean): void => {
    if (possessedId === null) return;
    if (action === 'attack') {
      if (attackHeld === held) return;
      attackHeld = held;
      client.possess(possessedId, true, possessOrder.x, possessOrder.y, attackHeld);
      return;
    }
    if (!held) return;
    const abilities: NonNullable<Parameters<SimClient['possess']>[5]> = {};
    abilities[action] = true;
    client.possess(possessedId, true, possessOrder.x, possessOrder.y, attackHeld, abilities);
  };

  /** Carries out a power button press: UI actions run at once, sim powers arm or disarm. */
  const activatePower = (power: PowerDef): void => {
    const status = powerStatus(power);
    if (!status.enabled) {
      setStatus(status.note);
      return;
    }
    // The recent row (spec B): the power just used moves to the front.
    store.recent.value = [power.id, ...store.recent.value.filter((id) => id !== power.id)].slice(0, 9);
    // A used power has been seen too: its "New" marker goes.
    markPowersSeen([power.id]);
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
        store.hidden.value = !store.hidden.value;
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
      case 'possess':
        // Possess (07 section 13): a press while a Being is held releases it. Otherwise the next tap picks a being
        // (onTap); later taps on the ground order it to move. Each order refreshes the control on the sim side.
        setArmed(null);
        if (possessedId !== null) {
          releasePossession();
          return;
        }
        possessPending = !possessPending;
        setStatus(possessPending ? 'Tap a being to possess it. Esc releases.' : 'Possess: off.');
        updatePowerButtons();
        return;
      case 'select_hamlet':
        // Hamlet Select waits for a tap on a tile (onTap), which picks the hamlet owning that tile.
        setArmed(null);
        hamletPending = true;
        setStatus('Tap a tile to select the hamlet that owns it.');
        return;
      case 'select_dominion': {
        // Ties: a second press on a selected row clears it. Otherwise the next tap picks the dominion owning that tile,
        // and the map shows the dominion layer (borders), as 12 section 8.8 says.
        setArmed(null);
        if (selectedDominion >= 0) {
          selectedDominion = -1;
          dominionPending = false;
          setStatus('Ties: cleared.');
          updatePowerButtons();
          return;
        }
        dominionPending = true;
        setStatus('Tap a tile to select the dominion that owns it.');
        updatePowerButtons();
        return;
      }
      case 'select_accord': {
        // Accord Finder: as Ties, a second press on the row clears the selection. The next tap picks the dominion owning
        // that tile, and only its pact candidates are drawn (12 section 8.8). The map layer is not changed.
        setArmed(null);
        if (accordDominion >= 0) {
          accordDominion = -1;
          accordPending = false;
          setStatus('Accord Finder: cleared.');
          updatePowerButtons();
          return;
        }
        accordPending = true;
        setStatus('Tap a tile to select the dominion whose pact candidates to show.');
        updatePowerButtons();
        return;
      }
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

  /** Publishes which powers show a pressed state and which cannot be used now. The power sheet draws both (spec B). */
  const updatePowerButtons = (): void => {
    possessPad.setVisible(possessedId !== null);
    const pressed: string[] = [];
    const unavailable: Record<string, string> = {};
    for (const power of POWERS) {
      const on =
        power.handler === 'toggle_rule'
          ? rules.isOn(String(power.params['rule']))
          : power.handler === 'toggle_option'
            ? boolOption(options, String(power.params['option']))
            : power.handler === 'toggle_view'
              ? viewFlags.has(String(power.params['key']))
              : power.handler === 'possess'
                ? possessPending || possessedId !== null
                : power.handler === 'select_dominion'
                  ? selectedDominion >= 0
                  : power.handler === 'select_accord'
                    ? accordDominion >= 0
                    : power.handler === 'layer_toggle'
                      ? stringOption(options, 'map.layer') === String(power.params['layer'])
                      : power.handler === 'arm_inspect'
                        ? state.armed === null
                        : state.armed?.id === power.id;
      if (on) pressed.push(power.id);
      const status = powerStatus(power);
      if (!status.enabled) unavailable[power.id] = status.note;
    }
    store.pressed.value = pressed;
    store.unavailable.value = unavailable;
  };

  /** Copies the armed power and brush into the shell store. */
  const syncArmed = (): void => {
    store.armed.value = state.armed ? { powerId: state.armed.id, brush: { index: state.sizeIndex, radius: brushRadius(), shape: state.shape } } : null;
  };
  /** Arms a power (null = inspect). The sheet and the map both show the armed state. */
  const setArmed = (power: PowerDef | null): void => {
    // A stroke in progress belongs to the old power: end it before the new one takes over.
    if (stroke) {
      flushStroke();
      stroke = null;
    }
    if (power) crumb('POWER_SELECT', power.id);
    state.armed = power;
    syncArmed();
    stepAnchor = null;
    const op = strokeOp(power);
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

  /** Sets the brush size by its slider index (0..10). The sheet's slider and the [ ] keys both come here. */
  const setBrushIndex = (index: number): void => {
    state.sizeIndex = index;
    syncArmed();
  };

  const setShape = (shape: BrushShape): void => {
    state.shape = shape;
    syncArmed();
  };

  /** Sets a Realm Rule on the mirror and in the sim. Returns false when the rule cannot change. */
  const setRule = (id: string, on: boolean): boolean => {
    if (!RULE_BY_ID.has(id) && !id.startsWith('age_enabled_')) return false;
    const before = rules.isOn(id);
    const ok = rules.set(id, on);
    if (!ok) {
      setStatus(`${plainName('rule', id)} cannot be turned off once on.`);
      return false;
    }
    if (before !== on) {
      client.setRule(id, on);
      // A rule switch that changed pulses the realm pill once (spec F); the pill itself stays still for reduced motion.
      store.rulePulses.value += 1;
    }
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
    // Only a power that has a cooldown changes the map of cooldowns; publishing for the others re-renders the sheet on every hold tick.
    if (power.cooldownMs > 0) {
      cooldownUntil.set(power.id, now + power.cooldownMs);
      store.cooldowns.value = Object.fromEntries(cooldownUntil);
    }
    const op = strokeOp(power);
    if (op) client.stroke(op, state.shape, brushRadius(), x, y, x, y, true);
    else client.power(power.id, x, y);
    // The effect plays only for a command that was sent (spec call 6): not on cooldown, not for a rule or a window.
    renderer.playEffect(recipeFor(power), x, y, power.kind === 'brush' ? brushRadius() : 1, false);
    if (power.handler === 'spawn_being') feedTutorial('spawned');
    crumb('POWER_APPLY', power.id);
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
    // The stroke's dust plays where the segment was sent (spec F); the layer throttles it and skips it under reduce motion.
    renderer.playEffect(recipeFor(stroke.power), target.x, target.y, stroke.power.kind === 'brush' ? brushRadius() : 1, true);
    stroke.last = target;
  };

  const brushOp = (): BrushOp | null => strokeOp(state.armed);

  // Windows: one dialog, filled by windowContent. Settings, rules, ages, and the rest open from here.
  // The window host routes each kind (atlasRoutes): confirmations open the modal dialog, the rest open in the Atlas.
  const openWindow = (id: string, params: WindowParams = {}): void => {
    crumb('WINDOW_OPEN', id);
    const build = windowHost.open(id, params);
    if (!build) {
      setStatus('That window is not available yet.');
      return;
    }
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
      const info = { realmName: store.realm.value.name, tick: simTick, year: Math.floor(simTick / YEAR_TICKS) + 1 };
      return { bytes, info };
    },
    restore: (bytes) => client.restore(bytes),
  };
  const saveController = new SaveController(
    async () => {
      const service = await SaveService.open(window.indexedDB, {
        isPhone: window.matchMedia('(pointer: coarse)').matches,
        storage: navigator.storage,
      });
      // Ask the browser not to evict the saves under storage pressure (best effort; refusal changes nothing).
      if (service.mode === 'indexeddb') void navigator.storage?.persist?.().catch(() => undefined);
      return service;
    },
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
  emergencySave = () => saveController.emergencySave();
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
    notify: (text) => pushToast(store, text),
    chronicle,
    exportCrash: exportCrashToFile,
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
        setBrushIndex(patch.sizeIndex);
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
    // Done buttons close whatever is open: a confirmation, else the Atlas.
    close: () => {
      if (windowHost.current !== null) windowHost.close();
      else closeAtlas(store);
    },
  };

  const windowHost = new WindowHost(
    $<HTMLDialogElement>('window'),
    $('window-title'),
    $('window-body'),
    {
      build: (kind, params) => windowFor(kind, windowDeps, params),
      toAtlas: (kind, params) => showAtlas(store, kind, params),
    },
  );
  // What the autosave timer and the pause and hide saves need to know about the UI right now.
  const autosaveState = (): AutosaveState => ({
    dirty: simTick !== savedTick,
    // Only a confirmation (a native dialog in the window host) pauses autosave. The Atlas is not a blocking modal for saving.
    modalOpen: windowHost.current !== null,
    gestureActive: stroke !== null,
    degradeLevel: 0,
  });
  $('window-close').addEventListener('click', () => windowHost.close());
  simView.subscribe(() => {
    // The O07 feed reads each snapshot once as it arrives (in memory only, src/ui/historyTicker.ts).
    if (simView.current) historyFeed.push(simView.current);
    windowHost.feed();
    feedAtlas();
  });

  /**
   * The being under a screen point in the latest feed sample (the snapshot holds only 96 beings): within 10 px, or 24 px
   * on touch. `key` is the feed key, `id` the sim's being id (generation * MAX_BEINGS + slot), `x` and `y` its tile.
   */
  /** The sim's being id of a feed key. The feed's generation is 16 bits, so a Being past 65535 generations gets another id and the sim refuses it. */
  const beingIdOf = (key: number): number => (key & 0xffff) * MAX_BEINGS + (key >>> 16);
  /** The feed Being nearest a screen point (fading Beings excluded), or null. */
  const beingAt = (sx: number, sy: number, radius: number): DrawBeing | null => {
    if (!worldReady) return null;
    return renderer.beingAt(sx, sy, radius);
  };
  const pickBeing = (sx: number, sy: number): { key: number; id: number; x: number; y: number } | null => {
    const radius = window.matchMedia('(pointer: coarse)').matches ? 24 : 10;
    const hit = beingAt(sx, sy, radius);
    if (!hit) return null;
    return { key: hit.key, id: beingIdOf(hit.key), x: Math.round(hit.x), y: Math.round(hit.y) };
  };

  /** The live feed Being with this id this frame, or null when it has left the feed (the info card reads it). */
  const liveBeing = (id: number): DrawBeing | null => {
    for (let i = 0; i < beingCount; i++) {
      const d = drawBeings[i];
      if (d && beingIdOf(d.key) === id) return d;
    }
    return null;
  };

  /** The hamlet building standing on tile (x, y) in the latest snapshot, as its structure id (y * 1024 + x), or null. */
  const buildingAt = (x: number, y: number): number | null => {
    const hit = simView.current?.mapBuildings?.find((b) => b.x === x && b.y === y);
    return hit ? hit.id : null;
  };

  /** Reads one tile from the sim and reports it in the status line. Held presses say so. */
  const inspectTile = (t: { x: number; y: number }, held: boolean): void => {
    void client.query(t.x, t.y).then((r) => {
      if (!r.inBounds) {
        setStatus('Off the map.');
        return;
      }
      const prefix = held ? 'Held: ' : '';
      setStatus(`${prefix}Tile ${r.tileX}, ${r.tileY} · elevation ${r.elevation} · ${plainName('ground', r.ground)}`);
      feedTutorial('tile-inspected');
    });
  };

  // Map input. A brush power (raise, lower, ground paint) drags; everything else pans. In 3D (MapInput3D) a drag looks
  // around at ground level, and right-drag or a twist turns the view from above.
  const mapHandlers: MapInput3DHandlers = {
    onRotate: (radians) => renderer.camera.rotateBy(radians),
    onLook: (dyaw, dpitch) => renderer.camera.look?.(dyaw, dpitch),
    brushArmed: () => state.armed?.kind === 'brush' && worldReady,
    toolArmed: () => state.armed !== null,
    onPan: (dx, dy) => {
      const k = numberOption(options, 'input.panSpeed') / 100;
      // A manual pan releases Follow (the camera would otherwise fight the drag).
      followKey = null;
      renderer.camera.panBy(dx * k, dy * k);
    },
    onZoom: (factor, sx, sy) => {
      const base = boolOption(options, 'input.invertZoom') ? 1 / factor : factor;
      renderer.camera.zoomAt(base ** (numberOption(options, 'input.zoomSpeed') / 100), sx, sy);
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
      if (dominionPending) {
        dominionPending = false;
        const dom = dominionAtTile(simView.current?.mapTiles, t.x, t.y);
        if (dom < 0) {
          setStatus('No dominion owns that tile.');
        } else {
          selectedDominion = dom;
          // The dominion layer shows the borders the relations are drawn over (12 section 8.8, "map switches to dominion layer").
          changeOption('map.layer', 'L01');
          changeOption('map.layerMode', 'borders');
          setStatus(`Dominion ${dom + 1} selected: its relations are drawn. Press Ties again to clear.`);
        }
        updatePowerButtons();
        return;
      }
      if (accordPending) {
        accordPending = false;
        const dom = dominionAtTile(simView.current?.mapTiles, t.x, t.y);
        if (dom < 0) {
          setStatus('No dominion owns that tile.');
        } else {
          accordDominion = dom;
          setStatus(`Dominion ${dom + 1} selected: its pact candidates are drawn. Press Accord Finder again to clear.`);
        }
        updatePowerButtons();
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
          followKey = hit.key;
          followPending = false;
          setStatus('Following that being. Esc or a pan releases it.');
        } else {
          setStatus('No being there. Tap a being to follow it, or press Esc.');
        }
        return;
      }
      if (possessPending) {
        // The order tile of the first order is the picked Being's own tile, so it stands still until the next tap.
        const hit = pickBeing(sx, sy);
        if (hit) {
          possessPending = false;
          possessedId = hit.id;
          possessOrder = { x: hit.x, y: hit.y };
          client.possess(hit.id, true, hit.x, hit.y, attackHeld);
          setStatus('Possessing that being. Tap the ground to move it. Esc releases.');
          updatePowerButtons();
        } else {
          setStatus('No being there. Tap a being to possess it, or press Esc.');
        }
        return;
      }
      if (possessedId !== null) {
        // Held Being: a tap on the ground is a move order. The attack hold (J or the touch button) carries over the order.
        possessOrder = { x: t.x, y: t.y };
        client.possess(possessedId, true, t.x, t.y, attackHeld);
        return;
      }
      // Inspect (default tap with nothing armed): a being near the tap opens its floating info card (UX redesign,
      // spec C). A hamlet building on the tapped tile, else the hamlet owning it, opens its card too (spec D); the
      // tile is still read into the status line. A tap on empty map closes the card and reads the tile as before.
      const hit = pickBeing(sx, sy);
      if (hit) {
        store.info.value = { kind: 'being', id: String(hit.id) };
        return;
      }
      const building = buildingAt(t.x, t.y);
      const owner = building === null ? hamletAtTile(simView.current?.mapTiles, t.x, t.y) : -1;
      if (building !== null) {
        store.info.value = { kind: 'building', id: String(building) };
      } else if (owner >= 0) {
        hamletTile = { x: t.x, y: t.y };
        store.info.value = { kind: 'hamlet', id: String(owner) };
      } else {
        store.info.value = null;
      }
      inspectTile(t, false);
    },
  };
  // The 3D view adds the ground gestures; 2D keeps its input as it was.
  const joystick = renderer.kind === '3d' ? new Joystick(host) : null;
  const crosshair = renderer.kind === '3d' ? new Crosshair(host) : null;
  if (renderer.kind === '3d') new MapInput3D(renderer.canvas, mapHandlers, () => ({ atGround: renderer.camera.atGround?.() === true }));
  else new MapInput(renderer.canvas, mapHandlers);

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
        if (event.stats.ticksThisPump > 0) noteSimMs(event.stats.avgTickMs);
        simSpeed = event.stats.speed;
        noteCrashRun({ tick: simTick, speed: simSpeed });
        const year = Math.floor(simTick / YEAR_TICKS) + 1;
        const month = (Math.floor(simTick / MONTH_TICKS) % 12) + 1;
        calendarText = `Y${year} M${month}`;
        if (store.realm.value.year !== year || store.realm.value.month !== month) store.realm.value = { ...store.realm.value, year, month };
        return;
      case Ev.Fault:
        progressBar.hide();
        // The page froze and the worker judged it from the pings it stopped getting (19 section 2, main_hang).
        // The page is awake now, so the overlay can show.
        if (event.code === 'MAIN_HANG') {
          showMainHang(PING_LOST_MS);
          return;
        }
        // The worker paused the sim itself after a part's third switch-off (worker.ts partFault, 17 section 9). Show that
        // pause, and send the speed the controls now mean (0), so the page and the worker agree again.
        if (event.code === 'SYS_STOP') {
          state.paused = true;
          applySpeed();
          const part = event.sys;
          showSimStopped(part, null);
          // The save list answers later: the reload button waits for it, as the fatal dialog does.
          const recovery = autosaveRecovery;
          if (recovery) {
            void recovery.hasSave().then((has) => {
              if (fatalOpen() && document.getElementById('fatal-title')?.textContent === SIM_PAUSED_TITLE) showSimStopped(part, has);
            });
          }
        }
        // The sim refused a Possess order: the Being is stale or its generation is past the feed's 16 bits (pickBeing).
        if (event.code === 'COMMAND_REFUSED' && event.detail === POSSESS_REFUSED && possessedId !== null) refusePossession();
        if (event.code === 'WORKER_RESPAWN') crumb('WORKER_RESTART', 'respawn');
        else journal(event.code, event.detail);
        if (event.severity === 'fatal') {
          reportCrash(
            event.code === 'WORKER_ERROR' ? 'worker_dead' : 'sim_fatal',
            'The simulation stopped',
            event.detail,
            undefined,
            'worker',
            event.sys,
          );
        } else {
          // Non-fatal worker faults get a crash record too (19 section 2 js_worker; section 1, principle 3).
          // A warning is not a crash, so it only goes to the log ring (recordCrash logs the errors it records).
          if (event.severity === 'error') void recordCrash({ kind: 'js_worker', ctx: 'worker', message: event.detail, sys: event.sys, sysOff: event.sysOff, recovery: [] });
          else logLine('warn', `${event.code}: ${event.detail}`);
          notify(event.detail, CUE.error);
        }
        return;
      case Ev.Beings: {
        const pushT0 = performance.now();
        interp.push(event.feed, pushT0);
        pushCostMs += performance.now() - pushT0;
        beingsFed = true;
        // The building list comes only when it changed; the boats come with every feed.
        if (event.feed.buildings) renderer.setBuildings(event.feed.buildings);
        renderer.setBoats(event.feed.boats);
        client.returnBuffer(event.feed.data.buffer as ArrayBuffer, true);
        return;
      }
      case Ev.Snapshot:
        noteCrashRun({ age: event.snap.age ?? null });
        if ((event.snap.age ?? null) !== lastAgeCrumb) {
          lastAgeCrumb = event.snap.age ?? null;
          if (lastAgeCrumb !== null) crumb('AGE', lastAgeCrumb);
        }
        simView.apply(event.snap);
        {
          const creatures = event.snap.population.total;
          // Hamlets, not towns: the first-town discovery counts hamlets too, so the pill and the card agree (spec E).
          const hamlets = event.snap.hamletCount;
          const realm = store.realm.value;
          if (realm.creatures !== creatures || realm.hamlets !== hamlets) store.realm.value = { ...realm, creatures, hamlets };
        }
        noteDiscoveries(event.snap);
        musicFeed.ingest(event.snap);
        for (const id of stingers.ingest(event.snap.age ?? null, event.snap.dominions.filter((d) => d.atWar).length)) playCue(id);
        return;
      case Ev.QueryResult:
        return;
    }
  });

  // Controls.
  // The shell's pills and toasts (spec A). The actions are the same calls the old top bar made.
  const shellActions: ShellActions = {
    setSpeed: (speed: Speed) => {
      state.speed = speed;
      state.paused = false;
      applySpeed();
      feedTutorial('speed-changed');
    },
    togglePause,
    markPowersSeen,
    activatePower: (id: string) => {
      const power = POWER_BY_ID.get(id);
      if (power) activatePower(power);
    },
    openWindow: (kind: string, params) => openWindow(kind, params),
    locateInfo: (target: InfoTarget): LocatedInfo | null => {
      const id = Number(target.id);
      // Screen point of a tile's centre, in client px (the map host's cached rect plus the view offset).
      const screenOf = (tx: number, ty: number): { x: number; y: number } => {
        const p = renderer.tileToScreen(tx, ty);
        return p ? { x: hostRect.left + p.sx, y: hostRect.top + p.sy } : { x: 0, y: 0 };
      };
      const snap = simView.current;
      if (target.kind === 'being') {
        const d = liveBeing(id);
        if (!d || !worldReady) return null;
        const speciesId = SPECIES[d.species]?.id;
        const name = speciesId ? plainName('species', speciesId) : 'Being';
        // More opens the being's full page, which reads its row: the latest snapshot's sample, or a favourite's kept row.
        const detailed = (snap?.detail?.notable?.beings ?? []).some((b) => b.id === id) || favouriteBeing(id) !== undefined;
        return { ...screenOf(d.x, d.y), name, facts: feedFacts(d), detailed };
      }
      if (!worldReady || !snap) return null;
      if (target.kind === 'hamlet') {
        // Gone once its index is past the snapshot's hamlets. A hamlet cut from the rows keeps its card, with no More.
        if (id < 0 || id >= snap.hamletCount) return null;
        const row = snap.hamlets[id];
        return {
          ...screenOf(hamletTile.x, hamletTile.y),
          name: row?.name ?? `Hamlet ${id + 1}`,
          facts: row ? hamletFacts(row) : 'Not in the latest realm overview',
          detailed: row !== undefined,
        };
      }
      if (target.kind === 'building') {
        // Gone once it is no longer in the map's building list (the list is capped, so a building past the cap is not sampled).
        const b = snap.mapBuildings?.find((m) => m.id === id);
        if (!b) return null;
        const kind = humanize(b.kind);
        const owner = hamletAtTile(snap.mapTiles, b.x, b.y);
        const ownerRow = owner >= 0 ? snap.hamlets[owner] : undefined;
        const facts = ownerRow ? `${kind}, in ${ownerRow.name}` : kind;
        // More opens the structure's page, which reads its row in the snapshot's notable structures.
        const detailed = (snap.detail?.notable?.structures ?? []).some((s) => s.id === id);
        return { ...screenOf(b.x, b.y), name: kind, facts, detailed };
      }
      return null;
    },
    followBeing: (id: number) => {
      const d = liveBeing(id);
      if (!d) {
        setStatus('That being is gone.');
        return;
      }
      followKey = d.key;
      followPending = false;
      setStatus('Following that being. Esc or a pan releases it.');
    },
    possessBeing: (id: number) => {
      const d = liveBeing(id);
      if (!d) {
        setStatus('That being is gone.');
        return;
      }
      setArmed(null);
      if (possessedId !== null) releasePossession();
      possessPending = false;
      possessedId = id;
      possessOrder = { x: Math.round(d.x), y: Math.round(d.y) };
      client.possess(id, true, possessOrder.x, possessOrder.y, attackHeld);
      setStatus('Possessing that being. Tap the ground to move it. Esc releases.');
      updatePowerButtons();
    },
    zoomBy: (factor: number) => {
      renderer.camera.zoomAt(factor, host.clientWidth / 2, host.clientHeight / 2);
    },
    disarm: () => setArmed(null),
    setBrushSize: (index: number) => setBrushIndex(index),
    setBrushShape: (shape: BrushShape) => setShape(shape),
    skipCoach: () => {
      tutorial = skipTutorial(tutorial);
      saveTutorial(tutorial);
      renderCoach();
    },
  };
  mountShell($('ui-root'), store, shellActions);
  mountAtlas($('atlas-root'), store, shellActions, windowDeps);
  mountToasts($('toast-root'), store, shellActions);
  if (started.fellBack) pushToast(store, VIEW_FALLBACK_TOAST);
  // Edge pan needs a hover position that is current: it clears when the pointer leaves the map or
  // when a press starts (a drag moves the camera by itself).
  renderer.canvas.addEventListener('pointerleave', () => {
    cursorScreen = null;
  });
  renderer.canvas.addEventListener('pointerdown', () => {
    pressed = true;
  });
  for (const type of ['pointerup', 'pointercancel'] as const) {
    renderer.canvas.addEventListener(type, () => {
      pressed = false;
    });
  }

  // Settings: every change is validated, saved, and applied at once.
  const changeOption = (id: string, value: OptionValue): void => {
    // The disasters row is a mirror of its Realm Rule: the rule changes first, and a refused change keeps the old value.
    if (id === 'game.disasters' && !setRule('natural_calamities', value === true)) return;
    options = setOption(options, id, value);
    saveOptions(safeStorage(), options);
    if (id === 'map.view') {
      // The View switch reloads. The world survives through the autosave: save first, then load the page with the new
      // view. The ?view= parameter is dropped, since it would beat the saved choice on the reload.
      writeSavedView(safeStorage(), value === '2d' ? '2d' : '3d');
      const next = new URL(location.href);
      next.searchParams.delete('view');
      void saveController.suspend(true).finally(() => location.assign(next.toString()));
      return;
    }
    if (id === 'privacy.errorReports') setCrashConsent(consentFromOption(stringOption(options, 'privacy.errorReports')));
    if (QUALITY_OPTIONS.has(id)) crumb('QUALITY', `${id}=${String(value)}`);
    if (id === 'ui.allChips') refreshChips();
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
    renderer.setFpsCap(safeMode ? 30 : numberOption(options, 'ui.fpsCap'));
    renderer.setRenderScale(effectiveRenderScale());
    $('debug').hidden = !(boolOption(options, 'ui.showFps') || debugOverlay);
    // Layout width, map layers, vignette and minimap.
    const layout = stringOption(options, 'ui.layout') as LayoutChoice;
    root.dataset['layout'] = layout;
    const maxWidth = layoutMaxWidth(layout);
    root.style.setProperty('--layout-max', maxWidth === null ? 'none' : `${maxWidth}px`);
    renderer.canvas.style.filter = mapCanvasFilter(stringOption(options, 'ui.colorBlindPalette') as ColourBlindPalette, numberOption(options, 'map.layerBrightness'));
    renderer.canvas.style.opacity = String(numberOption(options, 'map.layerOpacity') / 100);
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
  renderCoach();
  refreshChips();

  // The shell's keys (UX redesign, spec G): one keymap (src/ui/shell/keymap.ts). Each call is the one a click makes.
  const keyContext: KeyContext = {
    ...(renderer.kind === '3d' ? { rotate: (step: -1 | 1) => renderer.camera.rotateBy(step * KEY_ROTATE_RAD) } : {}),
    recent: () => recentRow(store),
    arm: (id: string) => {
      const power = POWER_BY_ID.get(id);
      if (power) activatePower(power);
    },
    toggleSheet: () => {
      store.sheet.value = store.sheet.value === 'expanded' ? 'collapsed' : 'expanded';
    },
    focusSearch: () => focusSheetSearch(() => {
      store.sheet.value = 'expanded';
    }),
    zoomBy: (factor: number) => shellActions.zoomBy(factor),
    togglePause,
    toggleHud: () => {
      store.hidden.value = !store.hidden.value;
    },
    brushStep: (step: -1 | 1) => setBrushIndex(Math.max(0, Math.min(BRUSH_RADII.length - 1, state.sizeIndex + step))),
  };
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    // The Atlas, a native dialog, and any control that already took the key (a tab list's arrows) own it: no shortcut, no pan.
    if (shellKeysBlocked(e, store.atlas.value.open) || isTyping(e.target)) return;
    if (!panBlocked(e.target)) keysDown.add(e.code);
    // Possession keys (13 section 10, DECISIONS "Possession controls close 14"): J holds attack, K/L/U/T/Y/N are one-shot
    // abilities. Modifier chords and auto-repeat do not fire them. They do nothing unless a Being is held.
    const control = possessActionOfCode(e.code);
    if (control !== null && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey) possessControl(control, true);
    if (dispatchKey(e, keyContext)) {
      if (e.code === 'Space') e.preventDefault();
      return;
    }
    if (e.code === 'Escape') {
      followPending = false;
      followKey = null;
      if (possessedId !== null || possessPending) releasePossession();
      hamletPending = false;
      dominionPending = false;
      accordPending = false;
      setArmed(null);
    }
  });
  window.addEventListener('keyup', (e: KeyboardEvent) => {
    keysDown.delete(e.code);
    const control = possessActionOfCode(e.code);
    if (control !== null) possessControl(control, false);
  });
  // Pause when the window loses focus, when the Settings row asks for it. Focus does not resume the sim.
  window.addEventListener('blur', () => {
    possessControl('attack', false);
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

  // Keep the camera viewport in step with the map element, and the cached host rect.
  new ResizeObserver(() => {
    renderer.resize();
    hostRect = host.getBoundingClientRect();
  }).observe(host);
  window.addEventListener('resize', () => {
    hostRect = host.getBoundingClientRect();
  });

  // One loop: Pixi's ticker drives rendering, stroke flushing and HUD.
  /** The camera's zoom in CSS px per tile, read from two tile centres on screen (0 before the camera exists). */
  const zoomPx = (): number => {
    const a = renderer.tileToScreen(0, 0);
    const b = renderer.tileToScreen(1, 0);
    return a && b ? b.sx - a.sx : 0;
  };
  const onFrame = (dtMs: number): void => {
    const ground = renderer.camera.atGround?.() === true;
    if (worldReady && (keysDown.size > 0 || joystick !== null)) {
      const dt = dtMs * KEY_PAN_PX_PER_MS * (numberOption(options, 'input.panSpeed') / 100);
      const dx = (keysDown.has('ArrowRight') || keysDown.has('KeyD') ? 1 : 0) - (keysDown.has('ArrowLeft') || keysDown.has('KeyA') ? 1 : 0);
      const dy = (keysDown.has('ArrowDown') || keysDown.has('KeyS') ? 1 : 0) - (keysDown.has('ArrowUp') || keysDown.has('KeyW') ? 1 : 0);
      if (ground) {
        // At ground level the keys and the joystick walk (forward is up, strafe is right); from above they pan.
        const stick = joystick?.value() ?? { f: 0, s: 0 };
        const f = Math.max(-1, Math.min(1, -dy + stick.f));
        const s = Math.max(-1, Math.min(1, dx + stick.s));
        if (f !== 0 || s !== 0) {
          renderer.camera.walk?.(f, s, dtMs);
          followKey = null;
        }
      } else if (dx !== 0 || dy !== 0) {
        renderer.camera.panBy(-dx * dt, -dy * dt);
        followKey = null;
      }
    }
    if (worldReady && joystick !== null && crosshair !== null) {
      joystick.setActive(ground && store.sheet.value !== 'expanded');
      // The collapsed sheet is tall on a portrait phone (its chips wrap), so the stick sits above it, not on it.
      const sheetTop = ground ? document.querySelector('.power-sheet')?.getBoundingClientRect().top : undefined;
      if (sheetTop !== undefined) joystick.setFloor(sheetTop - hostRect.top, hostRect.height);
      crosshair.setVisible(ground && state.armed !== null);
    }
    // The feed sample: every living Being, smoothed between worker frames (feed-interp.ts).
    const beingNowMs = performance.now();
    beingCount = interp.sample(beingNowMs, drawBeings);
    let frameCostMs = pushCostMs + (performance.now() - beingNowMs);
    pushCostMs = 0;
    // Follow: centre the camera on the followed being's sampled position. It is lost once it has left the feed.
    if (worldReady && followKey !== null) {
      let p: DrawBeing | undefined;
      for (let i = 0; i < beingCount; i++) if (drawBeings[i]?.key === followKey) p = drawBeings[i];
      if (p) {
        renderer.camera.centreOn({ x: p.x, y: p.y });
      } else if (beingsFed) {
        followKey = null;
        setStatus('Lost sight of the being you were following.');
      }
    }
    saveController.frame(dtMs, state.paused || document.hidden, autosaveState());
    degradeFrame(dtMs);
    noteFrameMs(dtMs);
    const hiddenGap = hiddenSinceFrame;
    hiddenSinceFrame = false;
    // On the frame the main thread wakes, the worker's heartbeats are queued behind it: judge the worker next frame.
    if (mainHangGap(dtMs, hiddenGap)) showMainHang(dtMs);
    else watchdogCheck(performance.now());
    flushStroke();

    // The music state is published about once a second (16 B8: never more often than that).
    musicClockMs += dtMs;
    if (audioUnlocked && worldReady && musicClockMs >= 1000) {
      musicClockMs = 0;
      const zoom01 = renderer.camera.zoom01();
      audio.setMusicState(musicViewState({ paused: state.paused || document.hidden, zoom01 }, musicFeed.partial()));
    }

    const cursor: CursorState = {
      tile: strokeOp(state.armed) !== null && cursorScreen && worldReady ? tileAt(cursorScreen.x, cursorScreen.y) : null,
      radius: brushRadius(),
      shape: state.shape,
    };
    // Edge pan: only with a fine pointer, since touch leaves a stale hover position behind.
    if (worldReady && cursorScreen && !pressed && boolOption(options, 'input.edgePan') && canHover && state.armed?.kind !== 'brush') {
      const edge = edgePanVector(cursorScreen.x, cursorScreen.y, host.clientWidth, host.clientHeight);
      if (edge.dx !== 0 || edge.dy !== 0) {
        const step = dtMs * KEY_PAN_PX_PER_MS * (numberOption(options, 'input.panSpeed') / 100) * 2;
        renderer.camera.panBy(-edge.dx * step, -edge.dy * step);
      }
    }
    if (worldReady) {
      // Insight hover (desktop only): the Being under the pointer, from the latest feed sample. Where the cursor arrows start.
      const hoverBeing = cursorScreen && canHover && !pressed ? beingAt(cursorScreen.x, cursorScreen.y, 10) : null;
      const hoverId = hoverBeing ? beingIdOf(hoverBeing.key) : -1;
      // The world view draws the feed, marks, effects and insight layers, then sets the terrain's view and cursor.
      frameCostMs += renderer.frame({
        dtMs,
        nowMs: beingNowMs,
        beings: drawBeings,
        beingCount,
        snapshot: simView.current,
        speed: simSpeed,
        marks: {
          items: boolOption(options, 'marks.items'),
          favourites: boolOption(options, 'marks.favourites'),
          armies: boolOption(options, 'marks.armies'),
          campaigns: boolOption(options, 'marks.campaigns'),
          battles: boolOption(options, 'marks.battles'),
          intrigues: boolOption(options, 'marks.intrigues'),
          names: stringOption(options, 'map.names') as 'full' | 'banner' | 'off',
          favouritesOnlyNames: boolOption(options, 'map.favouritesOnlyNames'),
          nameScale: numberOption(options, 'ui.scaleNames'),
        },
        insight: {
          layer: stringOption(options, 'map.layer'),
          mode: stringOption(options, 'map.layerMode'),
          happiness: boolOption(options, 'ui.happinessIcons'),
          tasks: boolOption(options, 'ui.taskIcons'),
          armyLines: boolOption(options, 'marks.armyLines'),
          selectedHamlet,
          talkBubbles: boolOption(options, 'ui.talkBubbles'),
          // The arrow kinds only when the Settings master is on, and never on touch.
          arrows: boolOption(options, 'ui.cursorArrows') && canHover ? new Set([...viewFlags].filter((k) => k.startsWith('arrow.'))) : new Set<string>(),
          hoverId,
          moneyFlow: boolOption(options, 'ui.moneyFlow'),
          selectedDominion,
          accordDominion,
        },
        map: {
          // Settings (`map.*`, `marks.boats`); the runtime-only quality flags turn off with the degradation ladder.
          shadows: boolOption(options, 'map.shadows') && !degradedOff.has('map.shadows'),
          boats: boolOption(options, 'marks.boats'),
          particles: boolOption(options, 'map.particles') && !degradedOff.has('map.particles'),
          crowdAnim: !degradedOff.has('map.crowdAnim'),
          dust: !degradedOff.has('map.dust'),
          creatureAnim: !degradedOff.has('map.creatureAnim'),
          nightLights: boolOption(options, 'map.nightLights'),
          bloom: boolOption(options, 'map.bloom'),
          vignette: boolOption(options, 'map.vignette'),
          treeSway: boolOption(options, 'map.treeWind'),
          cursorLights: boolOption(options, 'map.cursorLights'),
        },
        cursor,
        hoverId,
        degradedOff,
      });
      costRing[costWritten++ % COST_RING] = frameCostMs;
      // Cursor tooltip: the Being under the pointer (tip.beings), else the tile (tip.tiles). Settings master ui.worldTooltips.
      const snapNow = simView.current;
      let tip: string[] | null = null;
      if (cursorScreen && canHover && !pressed && boolOption(options, 'ui.worldTooltips')) {
        if (hoverBeing) {
          if (viewFlags.has('tip.beings')) {
            const speciesId = SPECIES[hoverBeing.species]?.id;
            const id = beingIdOf(hoverBeing.key);
            tip = beingTipLines(speciesId ? plainName('species', speciesId) : 'Being', snapNow?.mapKinds?.find((k) => k.id === id));
          }
        } else if (snapNow && viewFlags.has('tip.tiles')) {
          const at = tileAt(cursorScreen.x, cursorScreen.y);
          tip = tileTipLines(snapNow, at.x, at.y);
        }
      }
      if (tip && cursorScreen) {
        worldTip.show(tip, hostRect.left + cursorScreen.x, hostRect.top + cursorScreen.y);
      } else {
        worldTip.hide();
      }
      // O07 history ticker: the newest three changes, while the flag is on.
      tickerView.show(viewFlags.has('ticker') ? historyFeed.recent(3) : null);
    }
    // The minimap repaints about four times a second; it is skipped while hidden.
    minimapClockMs += dtMs;
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
        zoom: zoomPx(),
      });
    }
  };
  renderer.onFrame(onFrame);

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
  // Resume where the player left off: a ?seed= or ?new in the address starts a fresh world, Safe Mode and
  // the boot-loop dialog leave the choice to the player, and otherwise the newest save (autosave, quick,
  // suspend or manual slot) is loaded into the live realm.
  const wantsFreshWorld = params.has('seed') || params.has('new') || guard.loop || safeMode;
  // Until the resume lands, the throwaway default world must not be saved over the newest save, and the
  // map ignores input (saveController holds every save; the capture listener below holds the pointer).
  if (!wantsFreshWorld) {
    saveController.beginResume();
    resumingWorld = true;
    setStatus('Resuming…');
  }
  await client.newRealm(seed, sizeStep);
  if (!wantsFreshWorld) {
    // Not awaited: a slow or blocked store must not hold up the start of play.
    const announceResumed = (resumed: { ok: boolean; message: string }): void => {
      resumingWorld = false;
      // The message is announced once, by the toast; the status line only drops "Resuming…".
      setStatus('Tap a tile to inspect it.');
      if (!resumed.ok) return;
      pushToast(store, resumed.message, 'info', Date.now(), {
        label: 'Start a new world instead',
        run: () => {
          // The resumed realm is kept in a manual slot first, so choosing a new world never loses it.
          void saveController.keepResumedBeforeNewWorld().then((kept) => {
            if (kept) pushToast(store, kept.message);
            restartRealm?.();
          });
        },
      });
    };
    // Past the wait, the map takes input again and the status says the world is still coming back. Saves
    // stay held by saveController until the restore settles, and announceResumed runs then.
    const slowResume = (): void => {
      if (!resumingWorld) return;
      resumingWorld = false;
      setStatus(STILL_RESUMING);
    };
    void saveController.resumeNewest(false, slowResume).then(announceResumed);
  }
  client.setSpeed(state.paused ? 0 : state.speed);
  applySpeed();
  setArmed(null);
  setShape('circle');

  // Hooks for the Playwright tests; read-only except newRealm/speed through the UI.
  (window as unknown as { __sr: unknown }).__sr = {
    tick: () => simTick,
    hash: () => simHash,
    side: () => realmSide,
    tileToScreen: (x: number, y: number) => {
      const p = renderer.tileToScreen(x, y);
      return p ? { x: hostRect.left + p.sx, y: hostRect.top + p.sy } : null;
    },
    query: (x: number, y: number) => client.query(x, y),
    stroke: (x0: number, y0: number, x1: number, y1: number) => client.stroke('raise', 'circle', 5, x0, y0, x1, y1, true),
    speed: (s: Speed) => {
      state.speed = s;
      state.paused = false;
      applySpeed();
    },
    commands: () => [...client.sentKinds],
    openWindow: () => currentAtlasKind(store) ?? windowHost.current,
    /** Meets a discovery entry by id, as the triggers would (the e2e tests use it; the entry must exist). */
    forceDiscovery: (id: string) => {
      if (discovery.found.includes(id)) return;
      discovery = { ...discovery, found: [...discovery.found, id] };
      saveDiscovery(discovery);
      refreshChips();
      const toast = discoveryToast([id]);
      if (toast) pushToast(store, toast.text, toast.kind);
    },
    /** Opens a window kind as a player action would. The e2e tests use it for confirmations, which have no Atlas section. */
    showWindow: (kind: string) => openWindow(kind),
    snapshot: () => simView.current,
    creatureCount: () => renderer.stats().drawn,
    /** The world view in use, '3d' or '2d' (after any fallback). */
    rendererKind: () => renderer.kind,
    /** The 3D camera rig (height, focus tile, yaw), or null in 2D. */
    rig: () => renderer.camera.rig?.() ?? null,
    /** Dot sprites shown by the latest draw (the far-zoom level). */
    dotCount: () => renderer.stats().dots,
    /** The baked-art atlas: pages per frame size and frames held. */
    atlasStats: () => renderer.stats().atlas,
    /** Recent per-frame ms of the whole Pixi render() call (stage collect, batching, draw submission), oldest first, at most 600. */
    renderCost: () => renderCostMs(renderer),
    /** Beings in this frame's feed sample, in view or not. */
    beingTotal: () => beingCount,
    /** Recent per-frame ms of the creature pipeline (feed push + sample + draw + dust), oldest first, at most 600. */
    creatureCost: () => {
      const n = Math.min(costWritten, COST_RING);
      const out: number[] = [];
      for (let i = costWritten - n; i < costWritten; i++) out.push(costRing[i % COST_RING]!);
      return out;
    },
    /** The camera's zoom in CSS px per tile (0 before the camera exists). */
    zoom: () => zoomPx(),
    resets: () => creatureReset.resets,
    /** A new realm with a random seed, as the Realm tab's restart does. */
    newWorld: () => restartRealm?.(),
    /** The feed sample this frame: each Being's feed key, its sim id (generation * MAX_BEINGS + slot), and interpolated tile, in feed order. */
    beingPoints: () => drawBeings.slice(0, beingCount).map((d) => ({ key: d.key, id: beingIdOf(d.key), x: d.x, y: d.y, alpha: d.alpha, species: d.species })),
    /**
     * Spawns n beings of one species through the Beings tab's spawn power. Without x and y they go on the tile of the
     * land Being nearest the realm centre (a spawn needs a walkable tile, and the centre may be water). With x and y they
     * go on that tile instead; the sim refuses a non-walkable tile, so a caller spreading spawns gets fewer beings.
     */
    spawnMany: (speciesId: string, n: number, x?: number, y?: number) => {
      const power = POWERS.find((p) => p.handler === 'spawn_being' && p.params['species'] === speciesId);
      if (!power) throw new Error(`no spawn power for ${speciesId}`);
      let at = { x: x ?? 0, y: y ?? 0 };
      if (x === undefined || y === undefined) {
        const mid = Math.floor(realmSide / 2);
        let best = Infinity;
        at = { x: mid, y: mid };
        for (const d of drawBeings.slice(0, beingCount)) {
          const dist = (d.x - mid) ** 2 + (d.y - mid) ** 2;
          if (d.state !== BeingState.Swim && dist < best) {
            best = dist;
            at = { x: Math.round(d.x), y: Math.round(d.y) };
          }
        }
      }
      for (let i = 0; i < n; i++) client.power(power.id, at.x, at.y);
    },
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
