# Social Hub

Instagram, Facebook and X messaging in one desktop app, without the feeds. See [SPEC.md](SPEC.md).

## Install

Download the latest `Social-Hub-<version>-arm64.dmg` from
[Releases](https://github.com/maciekstosio/social-hub/releases/latest). Installed copies
check for updates hourly, download them in the background and install on quit; the ↻ button
turns green when an update is ready, and clicking it restarts into the new version.

## Develop

```sh
npm install
npm start          # dev build (no auto-updates, no cookie encryption)
npm test           # URL allowlist rules
npm run dist       # local packaged app in release/
```

## CI

- **Check** (`.github/workflows/check.yml`): typecheck + tests on every PR and push to `main`.
- **Release** (`.github/workflows/release.yml`): every push to `main` builds a Developer ID
  signed, notarized app and publishes it as a GitHub Release (`v0.1.<run>`), which installed
  apps pick up. Bump major/minor in `package.json` by hand.

Repository secrets it needs (same as in `declutter`):

| Secret | What |
|---|---|
| `CSC_LINK` | Developer ID Application certificate, `.p12` as base64 |
| `CSC_KEY_PASSWORD` | Its password |
| `APPLE_API_KEY` | App Store Connect API key, contents of `AuthKey_XXXX.p8` |
| `APPLE_API_KEY_ID` | Its key ID |
| `APPLE_API_ISSUER` | Its issuer ID |

## Configure

Click ⚙ in the sidebar to open `config.json`, then ↻ to restart and apply it.

```json
{
  "x": { "listId": "1234567890", "friends": ["alice", "bob"] },
  "instagram": { "viewerUseEmbed": false },
  "extraAllow": { "instagram": [], "facebook": [], "x": [] }
}
```

- `x.listId`: your private X List (`x.com/i/lists/<id>`). Empty = X opens on DMs.
- `x.friends`: handles whose posts are shown; everything else in the X view is hidden.
- `extraAllow`: extra URL regexes per platform, if a needed page gets blocked.

☰ opens `blocked.log`: every blocked navigation, useful when a site changes its URLs.

## Keys

- `⌘1` / `⌘2` / `⌘3`: switch platform (clicking the active icon again returns home)
- `Esc` or `⌘[` in a shared-item viewer: close it and return to the chat
