// Performance mode and multithreading for the player.
//
// Performance mode is stored per device (not per account), because the
// same person may want it on a slow work computer and off at home.

const PERF_KEY = "cv-performance-mode";

// Lighter settings applied when performance mode is on. Keys are
// EmulatorJS settings ("shader") or libretro core options. Options a core
// doesn't have are ignored, so each system lists every core it may use.
const PERF_OPTIONS = {
  common: {
    shader: "disabled", // screen filters cost GPU time
  },
  gb: {
    gambatte_mix_frames: "disabled",
    gambatte_gbc_color_correction: "disabled",
    mgba_frameskip: "auto",
    mgba_interframe_blending: "OFF",
    mgba_color_correction: "OFF",
  },
  gba: {
    mgba_frameskip: "auto", // skip drawing a frame when the computer falls behind
    mgba_interframe_blending: "OFF",
    mgba_color_correction: "OFF",
  },
  snes: {
    snes9x_hires_blend: "disabled",
  },
  n64: {
    "mupen64plus-43screensize": "320x240", // native N64 resolution
    "mupen64plus-169screensize": "640x360",
    "mupen64plus-EnableNativeResFactor": "0",
    "mupen64plus-MultiSampling": "0",
    "mupen64plus-txFilterMode": "None",
    "mupen64plus-FrameDuping": "True",
    "mupen64plus-EnableCopyColorToRDRAM": "Off",
  },
};

export function performanceMode() {
  try { return localStorage.getItem(PERF_KEY) === "on"; } catch { return false; }
}

export function setPerformanceMode(on) {
  try { localStorage.setItem(PERF_KEY, on ? "on" : "off"); } catch {}
}

/** True when this page can run multithreaded cores. */
export function threadsAvailable() {
  return typeof SharedArrayBuffer === "function" && window.crossOriginIsolated === true;
}

function optionsFor(core) {
  return { ...PERF_OPTIONS.common, ...(PERF_OPTIONS[core] || {}) };
}

/** EJS_defaultOptions for a fresh game (no saved emulator settings yet). */
export function defaultOptions(core) {
  const opts = performanceMode() ? optionsFor(core) : {};
  opts.ejs_threads = threadsAvailable() ? "enabled" : "disabled";
  return opts;
}

/**
 * EmulatorJS remembers each game's settings in localStorage, and those
 * override EJS_defaultOptions. Update that saved copy so switching
 * performance mode (or gaining thread support) takes effect on games that
 * were already played.
 */
export function syncSavedEmulatorSettings(core, gameName) {
  const key = `ejs-1-${core}-${gameName}-settings`;
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    stored = null;
  }
  if (!stored || typeof stored !== "object") return; // first run: defaults apply
  if (!stored.settings || typeof stored.settings !== "object") stored.settings = {};
  const s = stored.settings;

  const perf = optionsFor(core);
  if (performanceMode()) {
    Object.assign(s, perf);
  } else {
    // Undo only values that performance mode set, keeping the user's own choices.
    for (const [k, v] of Object.entries(perf)) {
      if (s[k] === v) delete s[k];
    }
  }

  // Older visits saved "disabled" before threads were available. Switch it on
  // once; after that, respect the Threads setting in the emulator menu.
  const migrated = `cv-threads-v1-${key}`;
  try {
    if (!threadsAvailable()) {
      s.ejs_threads = "disabled";
    } else if (!localStorage.getItem(migrated)) {
      s.ejs_threads = "enabled";
      localStorage.setItem(migrated, "1");
    }
    localStorage.setItem(key, JSON.stringify(stored));
  } catch {}
}
