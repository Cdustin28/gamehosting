import { CONFIG } from "./config.js";
import { THEMES, applyTheme } from "./theme.js";
import { supabase, requireApprovedUser, signedUrl, formatBytes, timeAgo } from "./supabase.js";
import { SYSTEMS, stripExtension, extensionOf } from "./systems.js";
import { getCachedRom, putCachedRom } from "./romcache.js";

const $ = (id) => document.getElementById(id);
const gameId = new URLSearchParams(location.search).get("game");

let user = null;
let game = null;
let savePath = null;
let lastSyncedBytes = null; // bytes currently in the cloud
let lastSyncedAt = null;
let uploadChain = Promise.resolve();
let uploading = 0;
let started = false;

// A save that changed locally but couldn't be uploaded (offline, etc.)
// is flagged so it isn't overwritten by the older cloud copy next time.
const pendingKey = () => `cv-pending-save-${gameId}`;
const setPending = (on) => {
  try { on ? localStorage.setItem(pendingKey(), "1") : localStorage.removeItem(pendingKey()); } catch {}
};
const hasPending = () => {
  try { return localStorage.getItem(pendingKey()) === "1"; } catch { return false; }
};

// ── UI helpers ──────────────────────────────────────────────────────

function loading(fraction, text, title) {
  if (title) $("loading-title").textContent = title;
  if (fraction != null) $("loading-bar").style.width = `${Math.round(fraction * 100)}%`;
  if (text != null) $("loading-text").textContent = text;
}

function fail(message) {
  $("loading").hidden = false;
  loading(0, message, "Couldn't start the game");
}

function setSync(stateName, label) {
  $("sync").dataset.state = stateName;
  $("sync-label").textContent = label;
}

function refreshSyncLabel() {
  if (uploading) return;
  if (lastSyncedAt) setSync("ok", `Saved to cloud ${timeAgo(lastSyncedAt)}`);
}
setInterval(refreshSyncLabel, 30000);

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ── Startup ─────────────────────────────────────────────────────────

const auth = await requireApprovedUser();
if (auth) start(auth).catch((e) => fail(e.message || String(e)));

async function start({ session, profile }) {
  user = session.user;
  if (THEMES[profile.theme]) applyTheme(profile.theme);
  if (!gameId) throw new Error("No game was selected.");

  const { data, error } = await supabase.from("games").select("*").eq("id", gameId).single();
  if (error || !data) throw new Error("That game isn't in your library.");
  game = data;
  savePath = `${user.id}/${game.id}.sav`;
  document.title = `${game.title} · ${CONFIG.siteName}`;
  $("game-title").textContent = game.title;

  // ROM: browser cache first, then cloud storage.
  let rom = await getCachedRom(game.rom_path, game.created_at);
  if (!rom) {
    rom = await downloadWithProgress(await signedUrl("roms", game.rom_path, 600), game.rom_size);
    putCachedRom(game.rom_path, game.created_at, rom);
  }

  // Cloud save (may not exist yet).
  loading(1, "Checking for your save…");
  let cloudSave = null;
  const { data: saveRow } = await supabase.from("saves").select("updated_at").eq("game_id", game.id).maybeSingle();
  if (saveRow) {
    const { data: blob, error: dlErr } = await supabase.storage.from("saves").download(savePath);
    if (dlErr) throw new Error(`Couldn't download your save: ${dlErr.message}`);
    cloudSave = new Uint8Array(await blob.arrayBuffer());
    lastSyncedBytes = cloudSave;
    lastSyncedAt = saveRow.updated_at;
    refreshSyncLabel();
  } else {
    setSync("idle", "No cloud save yet");
  }

  supabase.from("games").update({ last_played: new Date().toISOString() }).eq("id", game.id).then(() => {});

  bootEmulator(rom, cloudSave);
}

async function downloadWithProgress(url, expectedSize) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || expectedSize || 0;
  if (!res.body || !total) return res.blob();
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    loading(received / total, `Downloading ${formatBytes(received)} of ${formatBytes(total)}`);
  }
  return new Blob(chunks);
}

// ── Emulator ────────────────────────────────────────────────────────

function bootEmulator(romBlob, cloudSave) {
  const sys = SYSTEMS[game.system];
  const theme = THEMES[document.documentElement.dataset.theme] || THEMES.cardinal;
  const fileName = extensionOf(game.rom_name) === "zip" ? game.rom_name : `${stripExtension(game.rom_name)}.zip`;

  Object.assign(window, {
    EJS_player: "#game",
    EJS_core: sys.core,
    EJS_gameUrl: new File([romBlob], fileName),
    EJS_gameName: game.title,
    EJS_pathtodata: `https://cdn.emulatorjs.org/${CONFIG.emulatorVersion}/data/`,
    EJS_color: theme.accent,
    EJS_backgroundColor: theme.bg,
    EJS_startOnLoaded: false,
    EJS_fixedSaveInterval: CONFIG.saveCheckIntervalMs,
    // Only in-game (battery) saves sync, so hide save states and manual save files.
    EJS_Buttons: {
      saveState: false,
      loadState: false,
      quickSave: false,
      quickLoad: false,
      saveSavFiles: false,
      loadSavFiles: false,
      netplay: false,
      cheat: false,
      screenRecord: false,
    },
    EJS_onGameStart: () => onGameStart(cloudSave),
    EJS_onSaveUpdate: ({ save }) => queueUpload(save),
  });

  $("loading").hidden = true;
  const script = document.createElement("script");
  script.src = `${window.EJS_pathtodata}loader.js`;
  script.onerror = () => fail("Couldn't load the emulator. Check your connection and try again.");
  document.body.appendChild(script);
}

function gm() {
  return window.EJS_emulator?.gameManager;
}

function onGameStart(cloudSave) {
  started = true;
  const manager = gm();
  if (!manager) return;

  const local = manager.getSaveFile(false);
  if (hasPending() && local) {
    // The last session's save never reached the cloud; keep it and retry.
    queueUpload(local);
    return;
  }
  if (cloudSave) writeSaveIntoEmulator(manager, cloudSave);
}

function writeSaveIntoEmulator(manager, bytes) {
  const path = manager.getSaveFilePath();
  const FS = manager.FS;
  let dir = "";
  for (const part of path.split("/").slice(0, -1)) {
    if (!part) continue;
    dir += "/" + part;
    if (!FS.analyzePath(dir).exists) FS.mkdir(dir);
  }
  if (FS.analyzePath(path).exists) FS.unlink(path);
  FS.writeFile(path, bytes);
  manager.loadSaveFiles();
}

// ── Cloud sync ──────────────────────────────────────────────────────

function queueUpload(bytes) {
  if (!bytes || !bytes.length) return uploadChain;
  const copy = new Uint8Array(bytes);
  uploadChain = uploadChain.then(() => uploadSave(copy)).catch(() => {});
  return uploadChain;
}

async function uploadSave(bytes) {
  if (sameBytes(bytes, lastSyncedBytes)) return;
  uploading++;
  setSync("busy", "Saving to cloud…");
  try {
    const { error } = await supabase.storage.from("saves").upload(savePath, new Blob([bytes]), {
      upsert: true,
      contentType: "application/octet-stream",
    });
    if (error) throw error;
    const now = new Date().toISOString();
    const { error: rowErr } = await supabase.from("saves").upsert({
      game_id: game.id,
      user_id: user.id,
      save_path: savePath,
      size: bytes.length,
      updated_at: now,
    });
    if (rowErr) throw rowErr;
    lastSyncedBytes = bytes;
    lastSyncedAt = now;
    setPending(false);
    uploading--;
    refreshSyncLabel();
  } catch (e) {
    uploading--;
    setPending(true);
    setSync("error", "Cloud save failed — will retry");
    throw e;
  }
}

/** Write the in-game save to disk and upload it if it changed. */
function flush() {
  const manager = gm();
  if (!started || !manager) return uploadChain;
  try {
    const bytes = manager.getSaveFile(true); // true = ask the core to write SRAM first
    if (bytes) return queueUpload(bytes);
  } catch {}
  return uploadChain;
}

// Phones often kill backgrounded tabs, so save whenever the page is hidden.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flush();
});

window.addEventListener("beforeunload", (e) => {
  flush();
  if (uploading) {
    e.preventDefault();
    e.returnValue = "";
  }
});

async function saveAndExit(e) {
  e?.preventDefault();
  $("save-exit").disabled = true;
  setSync("busy", "Saving to cloud…");
  await flush();
  if ($("sync").dataset.state === "error" &&
      !confirm("Your latest save couldn't be uploaded. It's kept on this device and will upload next time you play here. Leave anyway?")) {
    $("save-exit").disabled = false;
    return;
  }
  location.href = "library.html";
}

$("save-exit").addEventListener("click", saveAndExit);
$("back").addEventListener("click", saveAndExit);
