# Social Hub

Instagram, Facebook and X messaging in one desktop app, without the feeds. See [SPEC.md](SPEC.md).

## Run

```sh
npm install
npm start          # dev
npm run dist       # packaged macOS app in release/ (cookie encryption fuse on)
```

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
