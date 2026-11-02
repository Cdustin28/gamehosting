import { CONFIG } from "./config.js";
import { bindThemeSelect } from "./theme.js";
import { supabase, usernameToEmail, USERNAME_PATTERN, isConfigured } from "./supabase.js";

const $ = (id) => document.getElementById(id);
const form = $("auth-form");
const msg = $("message");
const submit = $("submit");
let mode = "signin";

document.title = `Sign in · ${CONFIG.siteName}`;
document.querySelectorAll("[data-site-name]").forEach((el) => (el.textContent = CONFIG.siteName));
bindThemeSelect($("theme"));

function show(text, kind = "") {
  msg.textContent = text;
  msg.className = `alert ${kind}`;
  msg.hidden = !text;
}

function setMode(next) {
  mode = next;
  $("tab-signin").setAttribute("aria-selected", String(next === "signin"));
  $("tab-request").setAttribute("aria-selected", String(next === "request"));
  $("confirm-field").hidden = next !== "request";
  $("username-hint").hidden = next !== "request";
  $("password-hint").hidden = next !== "request";
  $("password").autocomplete = next === "request" ? "new-password" : "current-password";
  submit.textContent = next === "request" ? "Request account" : "Sign in";
  show("");
}
$("tab-signin").addEventListener("click", () => setMode("signin"));
$("tab-request").addEventListener("click", () => setMode("request"));

/** After a session exists, send approved users to the library. */
async function routeSignedIn() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from("profiles")
    .select("approved")
    .eq("id", user.id)
    .single();
  if (profile?.approved) {
    location.replace("library.html");
    return true;
  }
  await supabase.auth.signOut();
  setMode("signin");
  show("Your account is waiting for approval. Ask the site admin to approve it, then sign in again.", "ok");
  return false;
}

function friendlyError(error) {
  const m = (error?.message || "").toLowerCase();
  if (m.includes("invalid login")) return "Wrong username or password.";
  if (m.includes("already registered") || m.includes("already been registered")) return "That username is already taken.";
  if (m.includes("signups not allowed")) return "New accounts are turned off right now.";
  if (m.includes("email not confirmed")) return "Email confirmation is still on in Supabase. The admin needs to turn it off (see README).";
  if (m.includes("rate limit")) return "Too many attempts. Wait a minute and try again.";
  if (m.includes("failed to fetch")) return "Can't reach the server. Check your connection.";
  return error?.message || "Something went wrong.";
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  show("");
  const username = $("username").value.trim().toLowerCase();
  const password = $("password").value;

  if (!USERNAME_PATTERN.test(username)) {
    return show("Usernames are 3–20 characters: lowercase letters, numbers, and underscores.", "error");
  }
  if (password.length < 6) return show("Passwords need at least 6 characters.", "error");
  if (mode === "request" && password !== $("confirm").value) {
    return show("The passwords don't match.", "error");
  }

  submit.disabled = true;
  try {
    const email = usernameToEmail(username);
    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await routeSignedIn();
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
      });
      if (error) throw error;
      // Supabase hides duplicate sign-ups by returning a user with no identities.
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error("already registered");
      }
      if (data.session) {
        await routeSignedIn();
      } else {
        setMode("signin");
        show("Account requested. You can sign in once the admin approves it.", "ok");
      }
    }
  } catch (err) {
    show(friendlyError(err), "error");
  } finally {
    submit.disabled = false;
  }
});

(async () => {
  if (!isConfigured()) {
    show("This site isn't connected to its database yet. Fill in js/config.js (see README).", "error");
    submit.disabled = true;
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    await routeSignedIn();
  } else if (new URLSearchParams(location.search).has("pending")) {
    show("Your account is waiting for approval.", "ok");
  }
})();
