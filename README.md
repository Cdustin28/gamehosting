# Cartridge Vault

A private, browser-based game library for friends and family. Sign in with a username and password, upload the Game Boy, Game Boy Advance, SNES, and N64 games you own, and play them on a computer or phone. Games, covers, and in-game saves sync to the cloud per user.

- **Emulation:** [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) (RetroArch cores in WebAssembly)
- **Accounts, database, file storage:** [Supabase](https://supabase.com) free tier
- **Hosting:** GitHub Pages
- **No build step:** plain HTML, CSS, and JavaScript modules

See [OVERVIEW.md](OVERVIEW.md) for the full design: architecture, data model, themes, and free-tier limits.

> **This repository contains no games.** Each person uploads their own game files, dumped from cartridges they own, to their private storage folder. Don't commit ROMs to this repo.

---

## Setup

### 1. Create the Supabase project
1. Sign up at [supabase.com](https://supabase.com) and create a new project (free plan). Save the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. This creates the tables, security rules, and the three private storage buckets (`roms`, `covers`, `saves`).
3. Go to **Authentication → Sign In / Providers → Email** and turn **off** "Confirm email". (Usernames are converted to internal addresses that can't receive mail.)
4. Optional: in the same area, raise or lower the minimum password length (default 6).

### 2. Connect the site to Supabase
Edit [`js/config.js`](js/config.js):

| Setting | Where to find it |
|---|---|
| `supabaseUrl` | Project Settings → API (or the **Connect** button): Project URL |
| `supabaseAnonKey` | Same page: the `anon` / publishable key (**not** the `service_role` / secret key) |
| `usernameEmailDomain` | Any domain you own, e.g. `players.yourdomain.com`. No email is sent. **Don't change it after people sign up.** |
| `siteName` | Whatever you want in the header |

The anon key is designed to be public; the row-level security in `schema.sql` is what protects everyone's files. Never put the `service_role` key in this repo.

### 3. Publish with GitHub Pages
GitHub Pages is free for **public** repositories (private repos need a paid plan). This repo holds no games or secrets, so making it public is safe:

1. **Settings → General → Danger Zone → Change visibility → Public**.
2. **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, Branch **main**, folder **/ (root)**, then **Save**.

### 4. Use your own domain
1. **Settings → Pages → Custom domain**: enter your domain (e.g. `games.yourdomain.com`) and save. GitHub commits a `CNAME` file.
2. At your DNS provider:
   - Subdomain (`games.yourdomain.com`): a `CNAME` record pointing to `cdustin28.github.io`.
   - Apex domain (`yourdomain.com`): `A` records to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (and optionally the matching `AAAA` records GitHub lists).
3. When the DNS check passes, tick **Enforce HTTPS**.
4. In Supabase, **Authentication → URL Configuration → Site URL**: set it to `https://your-domain`.

### 5. First sign-in
1. Open the site and choose **Request account**. **The first account created becomes the admin** and is approved automatically.
2. Send the link to family and friends. They request accounts, and you approve them from the **Accounts** panel at the bottom of your library page.

### 6. Optional: keep the free project awake
Supabase pauses free projects after a week with no activity. The included workflow [`.github/workflows/keepalive.yml`](.github/workflows/keepalive.yml) pings it daily. To enable it, add two repository secrets under **Settings → Secrets and variables → Actions**: `SUPABASE_URL` and `SUPABASE_ANON_KEY`. If the project does pause, restore it with one click in the Supabase dashboard.

---

## Using the site

- **Add game:** pick a `.gb`, `.gbc`, `.gba`, `.sfc`, `.smc`, `.z64`, `.n64`, `.v64`, or `.zip` file. The console and title are filled in from the file name. The game is zipped in your browser before upload.
- **Covers:** upload an image, or leave "Find a cover automatically" checked. Automatic covers come from the [libretro-thumbnails](https://github.com/libretro-thumbnails/libretro-thumbnails) project and work best when the file has its standard (No-Intro) name, like `Pokemon - Red Version (USA, Europe) (SGB Enhanced).gb`. Without a cover, a styled title tile is shown.
- **Saves:** use the game's own save feature (for example, saving at a Pokémon Center). The player checks for a changed save every 30 seconds and uploads it, and also when you switch apps, lock your phone, or tap **Save & exit**. The status dot in the top bar shows when the last cloud save happened.
- **Bringing an existing save:** card menu (⋮) → **Upload save file** (`.sav` / `.srm`). **Download save** exports it.
- **Theme:** the dropdown in the header. Your choice follows you to other devices and recolors the emulator's menus.
- **Phones:** an on-screen gamepad appears automatically. Landscape works best. N64 is demanding; newer phones handle it, older ones may stutter.

## Admin notes

- **Approve, suspend, or remove requests:** the Accounts panel on the library page (admins only). Suspending keeps someone's files but blocks access.
- **Delete an approved account completely:** Supabase → **Authentication → Users** → delete the user, then in **Storage**, delete their folder (named with their user ID) from each bucket.
- **Reset a password:** Supabase → SQL Editor:
  ```sql
  update auth.users
  set encrypted_password = crypt('new-password-here', gen_salt('bf'))
  where email = 'username@players.yourdomain.com';
  ```
- **Storage budget:** the free plan has 1 GB of file storage shared by everyone and a 50 MB limit per file. The Accounts panel shows usage per person.

## Local development

Any static web server works, for example:

```sh
python3 -m http.server 8080
```

Then open <http://localhost:8080>. Add `http://localhost:8080` to Supabase **Authentication → URL Configuration → Redirect URLs** if needed.

## Licenses

Site code: GPL-3.0, to match EmulatorJS (see [LICENSE](LICENSE)). EmulatorJS and its cores are loaded from the EmulatorJS CDN under their own licenses; the SNES core (Snes9x) is free for non-commercial use only.
