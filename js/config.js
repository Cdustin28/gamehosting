// ─────────────────────────────────────────────────────────────
//  Site configuration — edit these values after creating your
//  Supabase project (see README.md, "Setup").
// ─────────────────────────────────────────────────────────────

export const CONFIG = {
  // Name shown in the header and browser tab.
  siteName: "Cartridge Vault",

  // Supabase → Project Settings → API (or "Connect").
  // The anon/publishable key is safe to publish: row-level security
  // in supabase/schema.sql decides what each user can access.
  supabaseUrl: "https://YOUR-PROJECT-REF.supabase.co",
  supabaseAnonKey: "YOUR-ANON-KEY",

  // Usernames are turned into internal email addresses like
  // "cole@players.example.com" because Supabase Auth needs an email.
  // Use a domain you own (no mail is ever sent). Never change this after
  // people have signed up, or their usernames will stop working.
  usernameEmailDomain: "players.thehomeserver.dev",

  // EmulatorJS CDN version: "stable" is recommended.
  emulatorVersion: "stable",

  // How often (ms) the player checks for a changed in-game save.
  saveCheckIntervalMs: 30000,
};
