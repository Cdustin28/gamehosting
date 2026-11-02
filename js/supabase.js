// Shared Supabase client and small helpers used by every page.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm";
import { CONFIG } from "./config.js";

export const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${CONFIG.usernameEmailDomain}`;
}

export function isConfigured() {
  return !CONFIG.supabaseUrl.includes("YOUR-PROJECT") && !CONFIG.supabaseAnonKey.includes("YOUR-");
}

/** Returns { session, profile } or redirects to the sign-in page. */
export async function requireApprovedUser() {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    location.replace("index.html");
    return null;
  }
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, username, approved, is_admin, theme")
    .eq("id", session.user.id)
    .single();
  if (error || !profile || !profile.approved) {
    location.replace("index.html?pending=1");
    return null;
  }
  return { session, profile };
}

export async function signOut() {
  await supabase.auth.signOut();
  location.replace("index.html");
}

/** Short signed URL for a private storage object. */
export async function signedUrl(bucket, path, seconds = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw error;
  return data.signedUrl;
}

export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
