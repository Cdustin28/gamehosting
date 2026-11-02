// Console definitions shared by the library and the player.

export const SYSTEMS = {
  gb: {
    label: "Game Boy",
    short: "GB",
    core: "gb", // EmulatorJS system → Gambatte core
    extensions: ["gb"],
    thumbnails: "Nintendo - Game Boy",
    tint: "#8b956d",
  },
  gbc: {
    label: "Game Boy Color",
    short: "GBC",
    core: "gb",
    extensions: ["gbc"],
    thumbnails: "Nintendo - Game Boy Color",
    tint: "#6a3fa0",
  },
  gba: {
    label: "Game Boy Advance",
    short: "GBA",
    core: "gba", // mGBA core
    extensions: ["gba"],
    thumbnails: "Nintendo - Game Boy Advance",
    tint: "#3a3f9e",
  },
  snes: {
    label: "Super Nintendo",
    short: "SNES",
    core: "snes", // Snes9x core
    extensions: ["sfc", "smc"],
    thumbnails: "Nintendo - Super Nintendo Entertainment System",
    tint: "#7d6fb0",
  },
  n64: {
    label: "Nintendo 64",
    short: "N64",
    core: "n64", // Mupen64Plus-Next core
    extensions: ["z64", "n64", "v64"],
    thumbnails: "Nintendo - Nintendo 64",
    tint: "#2d6b3f",
  },
};

export const ACCEPTED_EXTENSIONS = [
  ...Object.values(SYSTEMS).flatMap((s) => s.extensions),
  "zip",
];

export function extensionOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

export function stripExtension(name) {
  return (name || "").replace(/\.[a-z0-9]+$/i, "");
}

/** Guess the console from a file name; returns a key of SYSTEMS or null. */
export function detectSystem(fileName) {
  const ext = extensionOf(fileName);
  for (const [key, sys] of Object.entries(SYSTEMS)) {
    if (sys.extensions.includes(ext)) return key;
  }
  return null;
}

/** Turn a No-Intro style file name into a friendly title. */
export function titleFromFileName(fileName) {
  return stripExtension(fileName)
    .replace(/\s*[([].*?[)\]]/g, "") // drop (USA), [!] and similar tags
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Candidate cover URLs from the libretro-thumbnails project. Their file
 * names follow No-Intro naming, which most ROM dumps already use.
 */
export function thumbnailCandidates(systemKey, fileName) {
  const sys = SYSTEMS[systemKey];
  if (!sys) return [];
  const clean = (s) => s.replace(/[&*/:`<>?\\|"]/g, "_");
  const stem = clean(stripExtension(fileName));
  const repo = encodeURIComponent(sys.thumbnails.replace(/ /g, "_"));
  const names = [stem];
  // Also try without trailing tags like [!] or (Rev 1)
  const noBrackets = stem.replace(/\s*\[.*?\]/g, "").trim();
  if (noBrackets !== stem) names.push(noBrackets);
  const urls = [];
  for (const n of names) {
    // The thumbnail server RetroArch itself uses, then the GitHub mirror.
    urls.push(
      `https://thumbnails.libretro.com/${encodeURIComponent(sys.thumbnails)}/Named_Boxarts/${encodeURIComponent(n)}.png`
    );
    urls.push(
      `https://raw.githubusercontent.com/libretro-thumbnails/${repo}/master/Named_Boxarts/${encodeURIComponent(n)}.png`
    );
  }
  return urls;
}
