# Header Authentication for Foundry VTT

A run-time patch for Foundry VTT that bypasses password login, allowing user login via a reverse‑proxy header. This moves the authentication layer away from Foundry to a third-party such as Cloudflare Access or an OAuth2 provider. If the specified header value matches a Foundry user's `flags.core.user_id`, the script auto‑selects that user and bypasses the password check.

## Install

### Felddy (Docker) quick start

1. Add `bootstrap.sh` to the container’s patch directory (default `/data/container_patches`).  
   - You can also point Felddy at the script via `CONTAINER_PATCH_URLS=https://.../bootstrap.sh`; the image will download and run each URL.
   - To move the patch directory elsewhere, set `CONTAINER_PATCHES=/custom/path` and place `bootstrap.sh` there.
2. Ensure it’s executable: `chmod +x /data/container_patches/bootstrap.sh`.
3. If you host the bundle yourself, set `PATCH_SOURCE_URL=file:///data/header-auth.tar.gz`; otherwise the script pulls from GitHub.
4. Export `PATCH_HEADER_ID=cf-access-authenticated-user-email` (or your header of choice).
5. Launch the container. During the first install you’ll see `[ok] … inserted/updated` in the entrypoint logs as the patch runs.

Felddy only runs patch scripts during the install phase. To rerun later, exec into the container and run `/data/container_patches/bootstrap.sh`, or recreate the container.

### Bare metal / other setups

1. Copy `bootstrap.sh` into the directory where you plan to run Foundry and make it executable.
2. Optionally set `PATCH_SOURCE_URL` if you want to feed it a local tarball.
3. Export `PATCH_HEADER_ID` and run `./bootstrap.sh` before starting Foundry (or wire it into your startup script).

## PATCH_HEADER_ID (Environment Variable)

- What it is: the header name the server should trust (for example Cloudflare Access’ `cf-access-authenticated-user-email`).
- Name: `PATCH_HEADER_ID` (uppercase, literal). The patch skips itself if this variable is empty.
- Set it however you launch Foundry:
  - Docker Compose (felddy): add `PATCH_HEADER_ID=cf-access-authenticated-user-email` to your `.env` or `environment:` block.
  - Docker CLI: `docker run -e PATCH_HEADER_ID=cf-access-authenticated-user-email …`
  - Bare metal: `export PATCH_HEADER_ID=cf-access-authenticated-user-email` before running `bootstrap.sh` / starting Foundry.

Note: this is not a Foundry world setting; it must be present in the process environment.

## How It Works

- On startup, the script patches Foundry so the server trusts your chosen header and maps it to a user by matching `flags.core.user_id`.
- When a match is found, the server selects that user and skips the password prompt; the client form allows submission without manual selection.
- All changes are clearly marked in the code with begin/end comments so you can re‑run safely or audit later.

## Set flags.core.user_id via Macro (One‑Time Setup)

Run as a GM inside Foundry to assign each user’s external identifier (e.g., email) to `flags.core.user_id`.

- Set for the current logged‑in user:
  ```js
  await game.user.setFlag('core', 'user_id', 'alice@example.com');
  ui.notifications.info(`core.user_id set for ${game.user.name}`);
  ```

- Set for a specific user by name:
  ```js
  const u = game.users.getName('Alice');
  if (u) {
    await u.setFlag('core', 'user_id', 'alice@example.com');
    ui.notifications.info(`core.user_id set for ${u.name}`);
  }
  ```

- Bulk assign from a map:
  ```js
  const map = {
    'Alice': 'alice@example.com',
    'Bob': 'bob@example.com'
  };
  for (const [name, id] of Object.entries(map)) {
    const u = game.users.getName(name);
    if (u) await u.setFlag('core', 'user_id', id);
  }
  ui.notifications.info('core.user_id flags updated');
  ```

- Verify current values:
  ```js
  console.table(game.users.contents.map(u => ({ name: u.name, user_id: u.getFlag('core','user_id') })));
  ```

The server compares the trusted header’s value to this flag (case‑insensitive).

**Optional overrides:**

- `PATCH_VERSION` (default `latest`) – pin to a specific GitHub release tag.
- `PATCH_SOURCE_URL` – override the download location entirely (e.g., `file:///data/header-auth.tar.gz`).
- `PATCH_NAME` (default `header-auth`) – only change this if you publish a bundle under a different name.

## Portability

`bootstrap.sh` is intentionally generic: it downloads `<PATCH_NAME>.tar.gz`, unpacks it, and runs `exec.js` with the matching patch module. To adapt the pattern for another project, ship a release bundle that contains `exec.js` plus your patch module, update `PATCH_NAME`, and reuse the same script.

## Verify

- Fetch `/join` once to establish a session cookie, then POST with the trusted header:
  ```bash
  curl -s -c /tmp/cookies.txt http://localhost:30000/join >/dev/null
  curl -i -b /tmp/cookies.txt -X POST http://localhost:30000/join \
    -H "cf-access-authenticated-user-email: alice@example.com" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data "userid=&password=&action=join"
  ```
- Expected response: `{"request":"join","status":"success","message":"JOIN.LoginSuccess","redirect":"/game"}` and server logs showing `[header-auth] preprocess: matched user`.
- Server logs include `[header-auth] preprocess: matched user`.
- Search the install for your sentinel prefix (by default `// patch begin:`) to audit applied changes.

## Credits

- Inspired by MaienM’s original header‑auth: https://github.com/MaienM/foundry-vtt-header-auth
- This implementation and structure by https://github.com/brstm
