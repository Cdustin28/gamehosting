# Cartridge Vault — Project Overview and Outline

A private, browser-based retro game library for friends and family. Each person signs in with a username and password, uploads the Game Boy, Game Boy Advance, Super Nintendo, and Nintendo 64 games they own, and plays them in the browser on a computer or phone. Their games, cover art, and in-game battery saves are stored in a cloud database tied to their account, so a save made on a laptop continues on a phone.

The site is static HTML, CSS, and JavaScript hosted on GitHub Pages under its own domain. All storage and sign-in is handled by Supabase on its free tier. Every component is free and open source.

---

## 1. Goals and scope

| Requirement | How it is met |
|---|---|
| Play Game Boy, SNES, and N64 in the browser | EmulatorJS (GPL-3.0) running RetroArch cores compiled to WebAssembly |
| Pokémon, Zelda, Metroid | Each user uploads their own copies of these games to their private library |
| Username and password | Supabase Auth; usernames are mapped to an internal email address so nobody needs to enter one |
| Saves tied to each user | Battery saves stored in a private per-user storage folder and synced automatically |
| ROMs stored on the backend per user | Private per-user storage bucket; nobody else can read another user's files |
| Library with covers | Grid of game cards with uploaded cover art, an automatic cover lookup, or a generated title tile |
| Works on phones | Responsive layout plus EmulatorJS's on-screen touch gamepad |
| Theme color dropdown | Six built-in themes; the choice syncs to the user's profile and recolors the emulator too |
| Hosted on GitHub, own domain | GitHub Pages with a custom domain |
| Friends and family only | New sign-ups stay pending until an admin approves them from the site |

**Out of scope for version 1:** save states, netplay, cheats, and game sharing between users.

### Important note on game files

The repository contains no games. Nintendo's games are copyrighted, and public repos containing ROMs get removed by DMCA notices. Each user uploads game files dumped from cartridges they own, and those files stay in that user's private storage folder. Free homebrew games can be uploaded the same way.

---

## 2. Architecture

```
 Browser (computer or phone)
 ┌──────────────────────────────────────────────┐
 │  GitHub Pages (static files, your domain)    │
 │   index.html   → sign in / request account   │
 │   library.html → game grid, upload, admin    │
 │   play.html    → EmulatorJS player           │
 │                                              │
 │  EmulatorJS loader + cores ← cdn.emulatorjs.org
 │  supabase-js, fflate       ← cdn.jsdelivr.net │
 └──────────────┬───────────────────────────────┘
                │ HTTPS (anon key + user session, row-level security)
 ┌──────────────▼───────────────────────────────┐
 │  Supabase (free tier)                        │
 │   Auth      → username/password accounts     │
 │   Postgres  → profiles, games, saves tables  │
 │   Storage   → roms/, covers/, saves/ buckets │
 │               each split by user ID folder   │
 └──────────────────────────────────────────────┘
```

Because GitHub Pages cannot run server code, all logic runs in the browser. Security is enforced by Supabase row-level security (RLS) policies, which restrict every table row and storage file to its owner. The Supabase "anon" key in the site's config is designed to be public; it grants nothing on its own.

---

## 3. Tech stack (all free and open source)

| Layer | Package | License | Notes |
|---|---|---|---|
| Emulator frontend | EmulatorJS 4.x | GPL-3.0 | Loaded from its official CDN |
| Game Boy / Color core | Gambatte | GPL-2.0 | Fast and accurate |
| Game Boy Advance core | mGBA | MPL-2.0 | |
| SNES core | Snes9x | Non-commercial | Free for personal use |
| N64 core | Mupen64Plus-Next | GPL-2.0 | Heaviest core; best on desktop |
| Backend | Supabase | Apache-2.0 | Hosted free tier; can be self-hosted later |
| Client library | supabase-js v2 | MIT | |
| ROM compression | fflate | MIT | Zips ROMs in the browser before upload |
| Hosting | GitHub Pages | — | Free for public repositories |

No build step is required; the site is plain ES modules.

---

## 4. Pages and user flow

### 4.1 Sign-in page (`index.html`)
- Username and password fields, with "Sign in" and "Request account" tabs.
- Usernames: 3–20 characters, lowercase letters, numbers, and underscores.
- Passwords: at least 6 characters (Supabase default).
- New accounts show "Waiting for approval" until an admin approves them.
- The **first account ever created becomes the admin automatically** and is approved.

### 4.2 Library page (`library.html`)
- Header: site name, theme dropdown, username, sign-out.
- Filter chips: All, Game Boy, GBA, SNES, N64, plus a search box.
- Game cards: cover, title, console badge, and "last played" or "last saved" time.
- Card menu: Play, Change cover, Download save, Upload save, Delete.
- **Add game** dialog:
  1. Pick a ROM file (`.gb .gbc .gba .sfc .smc .z64 .n64 .v64 .zip`).
  2. Console is detected from the file extension and can be changed.
  3. Title is pre-filled from the file name and can be edited.
  4. Optional cover image upload; otherwise "Find cover automatically" tries the libretro-thumbnails project by the ROM's file name.
  5. The ROM is zipped in the browser and uploaded, with a progress bar.
- **Admin panel** (admins only): pending accounts with Approve and Remove buttons, and storage used per user.

### 4.3 Player page (`play.html?game=<id>`)
- Full-screen EmulatorJS player that uses the selected theme color.
- Top bar: back to library, game title, sync status ("Saved to cloud 2 min ago").
- On load: downloads the ROM (or uses the browser's cached copy), then loads the cloud save into the emulator.
- While playing: checks for in-game save changes every 30 seconds and uploads only when the save actually changed.
- Also uploads when the tab is hidden (phone lock or app switch) and from the "Save & exit" button.
- On phones, EmulatorJS shows its touch gamepad automatically; landscape is recommended.
- Save-state buttons are hidden so everyone uses in-game saves, which are the ones that sync.

---

## 5. Data model

### Tables

**`profiles`** — one row per account
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | Matches `auth.users.id` |
| username | text, unique | |
| approved | boolean | False until an admin approves |
| is_admin | boolean | |
| theme | text | Saved theme choice |
| created_at | timestamptz | |

**`games`** — one row per game in a user's library
| Column | Type | Notes |
|---|---|---|
| id | uuid (PK) | |
| user_id | uuid | Owner |
| title | text | |
| system | text | `gb`, `gbc`, `gba`, `snes`, `n64` |
| rom_path | text | `roms/<user_id>/<game_id>.zip` |
| rom_name | text | Original file name (determines the save file name) |
| rom_size | bigint | Bytes stored after compression |
| cover_path | text | Uploaded cover in `covers/` (optional) |
| cover_url | text | Automatic cover URL (optional) |
| last_played | timestamptz | |
| created_at | timestamptz | |

**`saves`** — the latest battery save per game
| Column | Type | Notes |
|---|---|---|
| game_id | uuid (PK) | |
| user_id | uuid | Owner |
| save_path | text | `saves/<user_id>/<game_id>.sav` |
| hash | text | Used to skip uploads when nothing changed |
| size | integer | |
| updated_at | timestamptz | |

### Storage buckets (all private)
| Bucket | Max file size | Contents |
|---|---|---|
| `roms` | 50 MB | Zipped ROMs |
| `covers` | 2 MB | Cover images resized in the browser |
| `saves` | 2 MB | Battery save files |

### Security rules
- Every table and bucket uses RLS so a user can read and write only their own rows and files under the folder named with their user ID.
- Users who are not yet approved cannot read or write anything except their own profile.
- Admins can read all profiles and approve or remove accounts.

---

## 6. Theme dropdown

Themes are CSS variable sets selected by a dropdown in the header. The choice is saved to the profile so it follows the user across devices, and the accent color is passed to EmulatorJS so the player's menus match.

| Theme | Feel |
|---|---|
| Cardinal & Gold (default) | Light background, cardinal red, gold accents |
| Midnight | Dark navy, cool blue accents |
| Pocket Green | Four-tone olive green, handheld-screen look |
| Classic Grey | Light grey, purple and lavender accents |
| Charcoal | Dark grey with red, yellow, green, and blue accents |
| Varia | Dark slate with orange and teal accents |

---

## 7. Free-tier limits and what they mean

Supabase free plan: 1 GB file storage, 50 MB maximum per file, 500 MB database, 5 GB egress per month, and projects pause after one week without activity.

- **Storage (1 GB shared by everyone):** Game Boy games are under 2 MB, SNES games about 1–4 MB, and N64 games 8–64 MB (roughly half that once zipped). Ten people with a few games each fits comfortably if N64 libraries stay modest. The admin panel shows usage per user.
- **50 MB per file:** ROMs are zipped before upload, which brings even the largest N64 games under the limit.
- **Egress (5 GB/month):** Each play session would download the ROM, so the site caches ROMs in the browser and only re-downloads when the game changes.
- **Pausing:** If nobody signs in for a week, the project pauses; restore it with one click in the Supabase dashboard. Optionally, a free GitHub Actions workflow can ping the project daily to keep it awake.

---

## 8. Repository layout

```
gamehosting/
├── index.html            Sign-in and account request
├── library.html          Game library, upload dialog, admin panel
├── play.html             Emulator player
├── favicon.svg
├── css/
│   └── style.css         Layout, components, theme variables
├── js/
│   ├── config.js         Supabase URL, anon key, site name  ← edit this
│   ├── supabase.js       Shared client and helpers
│   ├── auth.js           Sign-in page logic
│   ├── library.js        Library, upload, admin
│   ├── play.js           Player and save sync
│   ├── theme.js          Theme dropdown
│   ├── systems.js        Console definitions and file detection
│   └── romcache.js       Browser cache for downloaded ROMs
├── supabase/
│   └── schema.sql        Tables, RLS, buckets, triggers (run once)
├── .github/workflows/
│   └── keepalive.yml     Optional daily ping to keep Supabase awake
├── OVERVIEW.md           This document
├── README.md             Setup instructions
└── LICENSE               GPL-3.0
```

---

## 9. Setup steps

1. **Supabase:** create a free project, open the SQL editor, and run `supabase/schema.sql`.
2. **Auth settings:** under Authentication → Sign In / Providers → Email, turn off "Confirm email" so username-only accounts work.
3. **Config:** copy the project URL and anon key into `js/config.js`, and set the internal email domain (any domain you own, for example your site's domain).
4. **GitHub Pages:** GitHub Pages requires a paid plan for private repos, so make the repo public (it contains no games or secrets), then enable Pages from the `main` branch.
5. **Custom domain:** add the domain in Settings → Pages, create the DNS records GitHub lists, and enable "Enforce HTTPS".
6. **Supabase URL settings:** set the Site URL under Authentication → URL Configuration to your domain.
7. **First sign-in:** request an account; the first one becomes the admin. Approve everyone else from the admin panel.

---

## 10. Milestones

1. Supabase project, schema, and auth settings.
2. Sign-in page with approval flow.
3. Library page with upload, compression, and covers.
4. Player page with cloud save sync.
5. Theme dropdown and mobile polish.
6. Admin panel and storage usage display.
7. Custom domain, HTTPS, and keep-alive workflow.

## 11. Known limitations
- N64 runs well on most computers but can stutter on older phones; some N64 games have graphical glitches.
- If the same game is played on two devices at once, the most recent upload wins.
- iPhone and iPad require a tap before audio starts, which EmulatorJS's start button handles.
- There are no real email addresses, so "forgot password" emails aren't possible; the admin resets passwords with a one-line SQL command (see README).
