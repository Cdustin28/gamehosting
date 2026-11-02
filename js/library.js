import { zip } from "https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm";
import { CONFIG } from "./config.js";
import { THEMES, applyTheme, bindThemeSelect } from "./theme.js";
import {
  supabase, requireApprovedUser, signOut, formatBytes, timeAgo, escapeHtml,
} from "./supabase.js";
import {
  SYSTEMS, ACCEPTED_EXTENSIONS, detectSystem, extensionOf, titleFromFileName, thumbnailCandidates,
} from "./systems.js";
import { deleteCachedRom } from "./romcache.js";

const $ = (id) => document.getElementById(id);
const MAX_UPLOAD = 50 * 1024 * 1024; // Supabase free plan per-file limit
const FREE_STORAGE = 1024 * 1024 * 1024; // 1 GB

const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
};

const state = {
  user: null,
  profile: null,
  games: [],
  saves: new Map(), // game_id → save row
  coverUrls: new Map(), // game_id → url
  filter: "all",
  query: "",
};

// ── Startup ─────────────────────────────────────────────────────────

document.querySelectorAll("[data-site-name]").forEach((el) => (el.textContent = CONFIG.siteName));
document.title = `Library · ${CONFIG.siteName}`;

const auth = await requireApprovedUser();
if (auth) init(auth);

async function init({ session, profile }) {
  state.user = session.user;
  state.profile = profile;
  $("username").textContent = profile.username;
  $("sign-out").addEventListener("click", signOut);

  // The profile's theme wins so the choice follows the user between devices.
  if (THEMES[profile.theme]) applyTheme(profile.theme);
  bindThemeSelect($("theme"), async (name) => {
    await supabase.from("profiles").update({ theme: name }).eq("id", state.user.id);
  });

  buildFilters();
  buildSystemSelect();
  wireAddDialog();
  wireMenus();

  $("search").addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    render();
  });

  await loadGames();
  if (profile.is_admin) loadAdmin();
}

function notice(text, kind = "") {
  const el = $("notice");
  el.textContent = text;
  el.className = `alert ${kind}`;
  el.hidden = !text;
  if (text && kind === "ok") setTimeout(() => { if (el.textContent === text) el.hidden = true; }, 5000);
}

// ── Data ────────────────────────────────────────────────────────────

async function loadGames() {
  const [{ data: games, error }, { data: saves }] = await Promise.all([
    supabase.from("games").select("*").order("created_at", { ascending: false }),
    supabase.from("saves").select("game_id, updated_at, size"),
  ]);
  if (error) {
    notice(`Couldn't load your library: ${error.message}`, "error");
    return;
  }
  // Most recently played first, then newest.
  state.games = games.sort((a, b) =>
    (b.last_played || "").localeCompare(a.last_played || "") ||
    b.created_at.localeCompare(a.created_at));
  state.saves = new Map((saves || []).map((s) => [s.game_id, s]));

  const paths = games.filter((g) => g.cover_path).map((g) => g.cover_path);
  state.coverUrls = new Map();
  if (paths.length) {
    const { data } = await supabase.storage.from("covers").createSignedUrls(paths, 60 * 60 * 6);
    const byPath = new Map((data || []).map((d) => [d.path, d.signedUrl]));
    for (const g of games) {
      if (g.cover_path && byPath.get(g.cover_path)) state.coverUrls.set(g.id, byPath.get(g.cover_path));
    }
  }
  for (const g of games) {
    if (!state.coverUrls.has(g.id) && g.cover_url) state.coverUrls.set(g.id, g.cover_url);
  }
  render();
}

// ── Rendering ───────────────────────────────────────────────────────

function buildFilters() {
  const opts = [["all", "All"], ...Object.entries(SYSTEMS).map(([k, s]) => [k, s.short])];
  $("filters").innerHTML = opts
    .map(([k, label]) => `<button class="chip" type="button" data-filter="${k}" aria-pressed="${k === "all"}">${label}</button>`)
    .join("");
  $("filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    $("filters").querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === btn)));
    render();
  });
}

function tileHtml(game) {
  const sys = SYSTEMS[game.system];
  return `<div class="tile" style="--tint:${sys.tint}">
      <span class="tile-sys">${sys.short}</span>
      <span class="tile-title">${escapeHtml(game.title)}</span>
      <span class="tile-ridges"></span>
    </div>`;
}

function render() {
  const visible = state.games.filter((g) =>
    (state.filter === "all" || g.system === state.filter) &&
    (!state.query || g.title.toLowerCase().includes(state.query)));

  $("count").textContent = state.games.length ? `· ${state.games.length}` : "";
  $("empty").hidden = state.games.length > 0;

  $("grid").innerHTML = visible.map((g) => {
    const sys = SYSTEMS[g.system];
    const save = state.saves.get(g.id);
    const cover = state.coverUrls.get(g.id);
    const sub = save ? `Saved ${timeAgo(save.updated_at)}` : g.last_played ? `Played ${timeAgo(g.last_played)}` : "Not played yet";
    return `<article class="card" data-id="${g.id}">
      <a class="cover" href="play.html?game=${g.id}" aria-label="Play ${escapeHtml(g.title)}">
        ${tileHtml(g)}
        ${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
        <span class="play-overlay"><span>${ICONS.play}</span></span>
      </a>
      <div class="meta">
        <div class="meta-text">
          <div class="title">${escapeHtml(g.title)}</div>
          <div class="sub"><span class="badge">${sys.short}</span><span>${sub}</span></div>
        </div>
        <button class="icon-btn" type="button" data-menu="${g.id}" aria-label="More options for ${escapeHtml(g.title)}">${ICONS.more}</button>
      </div>
    </article>`;
  }).join("");

  if (state.games.length && !visible.length) {
    $("grid").innerHTML = `<p class="muted">No games match.</p>`;
  }
}

// ── Add game ────────────────────────────────────────────────────────

function buildSystemSelect() {
  $("system").innerHTML = `<option value="">Choose…</option>` +
    Object.entries(SYSTEMS).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join("");
  $("rom").accept = ACCEPTED_EXTENSIONS.map((e) => "." + e).join(",");
}

function wireAddDialog() {
  const dialog = $("add-dialog");
  const open = () => {
    $("add-form").reset();
    $("add-error").hidden = true;
    $("upload-progress").hidden = true;
    $("add-submit").disabled = false;
    dialog.showModal();
  };
  $("add-game").addEventListener("click", open);
  document.querySelectorAll("[data-open-add]").forEach((b) => b.addEventListener("click", open));
  dialog.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => { if (!$("add-submit").disabled) dialog.close(); }));

  $("rom").addEventListener("change", () => {
    const file = $("rom").files[0];
    if (!file) return;
    const sys = detectSystem(file.name);
    if (sys) $("system").value = sys;
    if (!$("title").value) $("title").value = titleFromFileName(file.name);
  });

  $("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("add-error");
    err.hidden = true;
    try {
      $("add-submit").disabled = true;
      await addGame();
      dialog.close();
      notice("Game added.", "ok");
      await loadGames();
      if (state.profile.is_admin) loadAdmin();
    } catch (ex) {
      err.textContent = ex.message || String(ex);
      err.hidden = false;
    } finally {
      $("add-submit").disabled = false;
    }
  });
}

function progress(fraction, text) {
  $("upload-progress").hidden = false;
  $("progress-bar").style.width = `${Math.round(fraction * 100)}%`;
  $("progress-text").textContent = text;
}

function zipAsync(files) {
  return new Promise((resolve, reject) =>
    zip(files, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data))));
}

async function addGame() {
  const file = $("rom").files[0];
  const title = $("title").value.trim();
  const system = $("system").value;
  if (!file) throw new Error("Choose a game file.");
  if (!ACCEPTED_EXTENSIONS.includes(extensionOf(file.name))) throw new Error("That file type isn't supported.");
  if (!system) throw new Error("Choose the console.");
  if (!title) throw new Error("Enter a title.");

  const gameId = crypto.randomUUID();
  const uid = state.user.id;

  // 1. Compress
  let body;
  if (extensionOf(file.name) === "zip") {
    body = file;
  } else {
    progress(0.02, "Compressing…");
    const bytes = new Uint8Array(await file.arrayBuffer());
    body = new Blob([await zipAsync({ [file.name]: [bytes, { level: 6 }] })], { type: "application/zip" });
  }
  if (body.size > MAX_UPLOAD) {
    throw new Error(`This game is ${formatBytes(body.size)} after compression; the free storage plan allows 50 MB per file.`);
  }

  // 2. Upload ROM
  const romPath = `${uid}/${gameId}.zip`;
  await uploadWithProgress("roms", romPath, body, "application/zip", (f) =>
    progress(0.05 + f * 0.85, `Uploading ${formatBytes(body.size * f)} of ${formatBytes(body.size)}`));

  try {
    // 3. Cover
    let coverPath = null;
    let coverUrl = null;
    const coverFile = $("cover").files[0];
    if (coverFile) {
      progress(0.92, "Uploading cover…");
      coverPath = await uploadCover(gameId, coverFile);
    } else if ($("auto-cover").checked) {
      progress(0.92, "Looking for a cover…");
      coverUrl = await findCover(system, file.name);
    }

    // 4. Record
    progress(0.97, "Saving to your library…");
    const { error } = await supabase.from("games").insert({
      id: gameId,
      user_id: uid,
      title,
      system,
      rom_path: romPath,
      rom_name: file.name,
      rom_size: body.size,
      cover_path: coverPath,
      cover_url: coverUrl,
    });
    if (error) throw error;
    progress(1, "Done");
  } catch (ex) {
    await supabase.storage.from("roms").remove([romPath]);
    throw ex;
  }
}

/** Upload with a progress callback (supabase-js doesn't report progress). */
async function uploadWithProgress(bucket, path, blob, contentType, onProgress) {
  const { data: { session } } = await supabase.auth.getSession();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${CONFIG.supabaseUrl}/storage/v1/object/${bucket}/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
    xhr.setRequestHeader("apikey", CONFIG.supabaseAnonKey);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = `Upload failed (${xhr.status}).`;
      try { message = JSON.parse(xhr.responseText).message || message; } catch {}
      if (xhr.status === 413) message = "The file is larger than the storage plan allows.";
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
    xhr.send(blob);
  });
}

/** Resize an image to a small JPEG and upload it to covers/. */
async function uploadCover(gameId, file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 640 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  const path = `${state.user.id}/${gameId}.jpg`;
  const { error } = await supabase.storage.from("covers").upload(path, blob, {
    upsert: true, contentType: "image/jpeg",
  });
  if (error) throw error;
  return path;
}

/** Try the libretro thumbnail names; resolves to the first URL that loads, or null. */
async function findCover(system, fileName) {
  for (const url of thumbnailCandidates(system, fileName)) {
    const ok = await new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve(false), 6000);
      img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 0); };
      img.onerror = () => { clearTimeout(timer); resolve(false); };
      img.src = url;
    });
    if (ok) return url;
  }
  return null;
}

// ── Card menu ───────────────────────────────────────────────────────

let menuEl = null;
let menuGame = null;

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}

function wireMenus() {
  $("grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-menu]");
    if (!btn) return;
    e.stopPropagation();
    openMenu(btn, state.games.find((g) => g.id === btn.dataset.menu));
  });
  document.addEventListener("click", (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  window.addEventListener("resize", closeMenu);
  window.addEventListener("scroll", closeMenu, { passive: true });

  $("cover-picker").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || !menuGame) return;
    try {
      const path = await uploadCover(menuGame.id, file);
      const { error } = await supabase.from("games").update({ cover_path: path, cover_url: null }).eq("id", menuGame.id);
      if (error) throw error;
      notice("Cover updated.", "ok");
      await loadGames();
    } catch (ex) {
      notice(`Couldn't update the cover: ${ex.message}`, "error");
    }
  });

  $("save-picker").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || !menuGame) return;
    if (file.size > 2 * 1024 * 1024) return notice("That doesn't look like a save file (over 2 MB).", "error");
    if (!confirm(`Replace the cloud save for "${menuGame.title}" with ${file.name}?`)) return;
    try {
      const path = `${state.user.id}/${menuGame.id}.sav`;
      const { error } = await supabase.storage.from("saves").upload(path, file, {
        upsert: true, contentType: "application/octet-stream",
      });
      if (error) throw error;
      const { error: rowErr } = await supabase.from("saves").upsert({
        game_id: menuGame.id, user_id: state.user.id, save_path: path,
        hash: null, size: file.size, updated_at: new Date().toISOString(),
      });
      if (rowErr) throw rowErr;
      notice("Save uploaded. It will load next time you play.", "ok");
      await loadGames();
    } catch (ex) {
      notice(`Couldn't upload the save: ${ex.message}`, "error");
    }
  });
}

function openMenu(anchor, game) {
  closeMenu();
  menuGame = game;
  const hasSave = state.saves.has(game.id);
  menuEl = document.createElement("div");
  menuEl.className = "menu";
  menuEl.setAttribute("role", "menu");
  menuEl.innerHTML = `
    <button type="button" data-act="play">Play</button>
    <button type="button" data-act="rename">Rename</button>
    <button type="button" data-act="cover">Change cover</button>
    ${game.cover_path || game.cover_url ? `<button type="button" data-act="nocover">Remove cover</button>` : ""}
    <hr>
    ${hasSave ? `<button type="button" data-act="download-save">Download save</button>` : ""}
    <button type="button" data-act="upload-save">Upload save file</button>
    <hr>
    <button type="button" data-act="delete" class="danger">Delete game</button>`;
  document.body.appendChild(menuEl);

  const r = anchor.getBoundingClientRect();
  const w = menuEl.offsetWidth;
  const h = menuEl.offsetHeight;
  menuEl.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
  menuEl.style.top = `${r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;

  menuEl.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    closeMenu();
    try {
      await menuAction(act, game);
    } catch (ex) {
      notice(ex.message || String(ex), "error");
    }
  });
}

async function menuAction(act, game) {
  switch (act) {
    case "play":
      location.href = `play.html?game=${game.id}`;
      break;
    case "rename": {
      const title = prompt("Game title", game.title)?.trim();
      if (!title || title === game.title) return;
      const { error } = await supabase.from("games").update({ title: title.slice(0, 120) }).eq("id", game.id);
      if (error) throw error;
      await loadGames();
      break;
    }
    case "cover":
      $("cover-picker").click();
      break;
    case "nocover": {
      if (game.cover_path) await supabase.storage.from("covers").remove([game.cover_path]);
      const { error } = await supabase.from("games").update({ cover_path: null, cover_url: null }).eq("id", game.id);
      if (error) throw error;
      await loadGames();
      break;
    }
    case "download-save": {
      const { data, error } = await supabase.storage.from("saves").download(`${state.user.id}/${game.id}.sav`);
      if (error) throw error;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(data);
      a.download = `${game.title.replace(/[^\w\- ]+/g, "").trim() || "game"}.sav`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      break;
    }
    case "upload-save":
      $("save-picker").click();
      break;
    case "delete": {
      if (!confirm(`Delete "${game.title}" and its save? This can't be undone.`)) return;
      const removals = [supabase.storage.from("roms").remove([game.rom_path])];
      if (game.cover_path) removals.push(supabase.storage.from("covers").remove([game.cover_path]));
      if (state.saves.has(game.id)) removals.push(supabase.storage.from("saves").remove([`${state.user.id}/${game.id}.sav`]));
      await Promise.all(removals);
      const { error } = await supabase.from("games").delete().eq("id", game.id);
      if (error) throw error;
      await deleteCachedRom(game.rom_path);
      notice("Game deleted.", "ok");
      await loadGames();
      if (state.profile.is_admin) loadAdmin();
      break;
    }
  }
}

// ── Admin panel ─────────────────────────────────────────────────────

async function loadAdmin() {
  const { data: users, error } = await supabase.rpc("admin_list_users");
  if (error) return;
  $("admin").hidden = false;

  const total = users.reduce((n, u) => n + Number(u.rom_bytes || 0), 0);
  const pending = users.filter((u) => !u.approved).length;
  $("usage-text").textContent =
    `${formatBytes(total)} of ${formatBytes(FREE_STORAGE)} used by games` +
    (pending ? ` · ${pending} waiting for approval` : "");
  $("usage-bar").style.width = `${Math.min(100, (total / FREE_STORAGE) * 100).toFixed(1)}%`;

  $("users").innerHTML = users.map((u) => {
    const self = u.id === state.user.id;
    let actions = "";
    if (!u.approved) {
      actions = `<button class="btn primary" data-approve="${u.id}">Approve</button>
                 <button class="btn ghost" data-remove="${u.id}" data-name="${escapeHtml(u.username)}">Remove</button>`;
    } else if (!self) {
      actions = `<button class="btn ghost" data-revoke="${u.id}" data-name="${escapeHtml(u.username)}">Suspend</button>`;
    }
    return `<tr>
      <td><strong>${escapeHtml(u.username)}</strong>${u.is_admin ? ' <span class="muted">(admin)</span>' : ""}</td>
      <td><span class="status-pill ${u.approved ? "active" : "pending"}">${u.approved ? "Active" : "Pending"}</span></td>
      <td class="hide-sm">${u.game_count}</td>
      <td class="mono">${formatBytes(Number(u.rom_bytes))}</td>
      <td class="actions">${actions}</td>
    </tr>`;
  }).join("");

  $("users").onclick = async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    b.disabled = true;
    let res;
    if (b.dataset.approve) {
      res = await supabase.rpc("admin_set_approved", { target: b.dataset.approve, value: true });
    } else if (b.dataset.revoke) {
      if (!confirm(`Suspend ${b.dataset.name}? Their games and saves stay stored, but they can't sign in to use them until approved again.`)) { b.disabled = false; return; }
      res = await supabase.rpc("admin_set_approved", { target: b.dataset.revoke, value: false });
    } else if (b.dataset.remove) {
      if (!confirm(`Remove the account request from ${b.dataset.name}?`)) { b.disabled = false; return; }
      res = await supabase.rpc("admin_remove_pending", { target: b.dataset.remove });
    }
    if (res?.error) notice(res.error.message, "error");
    loadAdmin();
  };
}
