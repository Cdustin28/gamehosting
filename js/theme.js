// Theme dropdown. Themes are CSS variable sets in css/style.css keyed by
// [data-theme]. The choice is kept in localStorage for instant paint and
// in the user's profile so it follows them to other devices.

export const THEMES = {
  cardinal: { label: "Cardinal & Gold", accent: "#C8102E", bg: "#FBF8F2" },
  midnight: { label: "Midnight", accent: "#5B8DEF", bg: "#0F1626" },
  pocket: { label: "Pocket Green", accent: "#306230", bg: "#C4CFA1" },
  classic: { label: "Classic Grey", accent: "#5B3E96", bg: "#E4E2E8" },
  charcoal: { label: "Charcoal", accent: "#E53935", bg: "#1E1F22" },
  varia: { label: "Varia", accent: "#F28C28", bg: "#151B22" },
};

const KEY = "cv-theme";

export function currentTheme() {
  let t = null;
  try { t = localStorage.getItem(KEY); } catch {}
  return THEMES[t] ? t : "cardinal";
}

export function applyTheme(name) {
  const theme = THEMES[name] ? name : "cardinal";
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEMES[theme].bg;
  return theme;
}

/**
 * Fill a <select> with the themes and wire it up.
 * onChange(name) is called after the theme is applied (used to save it).
 */
export function bindThemeSelect(select, onChange) {
  select.innerHTML = Object.entries(THEMES)
    .map(([k, t]) => `<option value="${k}">${t.label}</option>`)
    .join("");
  select.value = currentTheme();
  select.addEventListener("change", () => {
    const name = applyTheme(select.value);
    onChange?.(name);
  });
}

// Paint the saved theme as early as possible.
applyTheme(currentTheme());
