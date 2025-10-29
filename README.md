# Header Authentication for Foundry VTT

A run-time patch for Foundry VTT that bypasses password login, allowing user login via a reverse‑proxy header. This moves the authentication layer away from Foundry to a third-party such as Cloudflare Access or an OAuth2 provider. If the specified header value matches a Foundry user's `flags.core.user_id`, the script auto‑selects that user and bypasses the password check.

## Install

1) Copy these into your Foundry environment (or felddy’s `/data/container_patches/`):
   - `header-auth.sh`
   - `header-auth/patch-runner.js`
   - `header-auth/server-patch.js`
2) Make them executable: `chmod +x header-auth.sh header-auth/*.js`
3) Set `HEADER_AUTH_ID` (e.g. for Cloudflare Access: `cf-access-authenticated-user-email`).
4) Start Foundry. First run applies the patch; you’ll see `[ok] … inserted/updated` logs.

Note (felddy): the image runs patch scripts only during installation. To reapply later, run `./header-auth.sh` inside the container or recreate the container.

## HEADER_AUTH_ID (Environment Variable)

- What it is: an environment variable available to the Foundry process. The patch reads it at runtime to know which upstream header to trust.
- Name: `HEADER_AUTH_ID` (uppercase, literal).
- Set it in whichever way you start Foundry:
  - Docker Compose (felddy):
    - `environment:` → `- HEADER_AUTH_ID=cf-access-authenticated-user-email`
    - or add `HEADER_AUTH_ID=cf-access-authenticated-user-email` to your `.env` file used by Compose.
  - Docker CLI: `docker run -e HEADER_AUTH_ID=cf-access-authenticated-user-email …`
  - Bare metal: `export HEADER_AUTH_ID=cf-access-authenticated-user-email` before running `header-auth.sh` / starting Foundry.

Note: this is not a Foundry world setting; it must be present in the environment where the Foundry server runs.

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

## Portability (Reuse This Code for Other Patches)

- Keep `header-auth.sh` and `header-auth/patch-runner.js` as‑is.
- Change only `header-auth/server-patch.js`: define your patch operations with `{ label, remove?, patch }`.
  - If `remove` exists, its text is replaced by a sentinel‑wrapped `patch`.
  - If `remove` is omitted, the `patch` is appended (also sentinel‑wrapped).

## Verify

- Send `/join` with the trusted header → `{"status":"success","redirect":"/game"}`.
- Server logs include `[header-auth] preprocess: matched user`.
- Search the install for `// header-auth begin:` to audit applied changes.

## Credits

- Inspired by MaienM’s original header‑auth: https://github.com/MaienM/foundry-vtt-header-auth
- This implementation and structure by https://github.com/brstm
