# Social Hub — Spec (MVP)

A desktop app that keeps social messaging in one place without exposing feeds.
Goal: log out of Instagram / Facebook / X everywhere else and use only this.

## Decisions

| # | Decision |
|---|---|
| 1 | Personal accounts → no official APIs (Meta has none for personal DMs; X DM API is paid). |
| 2 | PC-first. Wrap the official web apps. No Matrix / mautrix bridges (possible later for mobile). |
| 3 | Navigation is URL-allowlisted. Anything else is blocked and redirected home. Must catch SPA (in-page) navigation, not only full loads. |
| 4 | Shared posts/reels/stories open in a **locked single-item viewer**; prefer `/embed` pages, fall back to the exact URL. Any URL change → close viewer. **Back always returns to the chat.** |
| 5 | Layout: left sidebar with platform icons; one WebView per platform. |
| 6 | X: DMs + friends-only feed via a **private X List**, plus a local author-handle check that hides anything not from listed friends (ads, promoted, suggested). Model-based filter plugin deferred. |
| 7 | Electron + TypeScript. One persistent session partition per platform. Cookie encryption enabled via Electron fuse (Keychain). |
| 8 | No notifications in MVP. |
| 9 | IG / FB scope: DMs, calls, login/2FA, account settings. Everything else blocked. |
| 10 | No bypass. Blocked means blocked; allowlist lives in a config file. Blocked URLs are logged for debugging. |

## Layout

```
┌────┬──────────────────────────────────┐
│ IG │                                  │
│ FB │   WebContentsView for platform   │
│ X  │   (session: persist:<platform>)  │
│    │                                  │
│ ⚙  │                                  │
└────┴──────────────────────────────────┘
```

## Allowlist (initial, to be verified against live sites)

### Instagram — home: `https://www.instagram.com/direct/inbox/`
- `/direct/*`
- `/accounts/*` (login, 2FA, settings)
- `/challenge/*` (security checks)
- Locked viewer only: `/p/<id>/`, `/reel/<id>/`, `/stories/<user>/<id>/` (+ `/embed`)
- Blocked: `/`, `/explore/*`, `/reels/*`, profiles, everything else

### Facebook — home: `https://www.facebook.com/messages/`
- `/messages/*`
- `/login*`, `/checkpoint/*`, `/two_step_verification/*`
- `/settings*`, `/privacy/*`
- Call windows (verify URL pattern)
- Locked viewer only: shared post/reel/video URLs
- Blocked: `/`, `/watch`, `/marketplace`, `/groups`, `/events`, `/reel/*` (outside viewer), profiles, everything else

### X — home: `https://x.com/i/lists/<LIST_ID>`
- `/i/lists/<LIST_ID>` plus its editor: `/info`, `/members`, `/members/suggested` (only the configured list)
- `/messages/*`, `/i/chat/*`
- `/notifications/*`, `/compose/*`
- Own profile (handle auto-detected from X's nav) and its tabs: posts, `/with_replies`, `/media`, `/likes`, `/highlights`, `/articles`
- `/<handle>/status/<id>` inline when `<handle>` is in the friends set or is you; anyone else's → locked viewer
- Login / 2FA / `/account/*` / `/settings/*` / `/logout`
- Blocked: `/home`, `/explore`, `/search`, `/i/trends`, `/i/grok`, other profiles, own followers/following, other lists, everything else

## What's visible (agreed UI)

Decisions made while using the app; keep these when sites change their DOM.

**Instagram**
- DM inbox and threads, calls, login/2FA, account settings.
- Left rail hidden; only the **Notifications** heart stays, pinned top-left as a bare icon.
  The rail must not expand on hover.

**Facebook**
- Messages, calls, login/2FA, settings/privacy.
- Top bar: only **notifications** and the **profile menu**; logo/home, search and the nav tabs are hidden.

**X**
- Left nav: only **Home**, **Notifications**, the **compose** button and the **avatar**.
  The X logo and every other nav item (Explore, Grok, Chat, Lists, Bookmarks, Communities,
  Premium, Profile link, More) are hidden.
- **Home** returns to the friends list (the app's X home), never X's `/home` feed.
- **Avatar** opens your own profile instead of the account menu (so "Log out" is gone from there;
  `/logout` is still allowed).
- Right sidebar column (trends, who to follow) hidden; floating **Grok** and **Chat** buttons hidden.
- The list feed shows everything from the list. The friends-only author filter runs only when
  `x.friends` in `config.json` is non-empty; your own handle never switches it on. When on, it hides
  non-friend posts, "Who to follow" cells and the thread leftovers ("Show more replies") under hidden posts.
- List editing works for the configured list: details, members, add/remove via the buttons;
  opening a member's profile stays blocked.
- DMs are reachable via their URL but have no nav icon.

**Opening links from outside** (e.g. recommendations from work)
- Sidebar link button, **⌘L** (View → Open Link from Clipboard), or dropping a link on the sidebar.
- The link goes through the same allowlist: allowed pages open in their platform's view, shared
  posts/reels/stories in the locked viewer, non-social links in the system browser.
  Anything blocked (profiles, feeds, Threads) stays blocked: a dialog says so and it's logged.

## Mechanics

- **Navigation guard** (main process, per WebContents):
  `will-navigate`, `will-redirect`, `did-navigate-in-page`, `setWindowOpenHandler`.
  Not allowed → `loadURL(home)` (or close, in the viewer) and log.
- **Locked viewer**: separate window sharing the platform's session; allowlist = that single item URL.
- **X author check** (preload / injected script): `MutationObserver` on
  `article[data-testid="tweet"]`; hide posts whose author handle isn't in the friends set.
  This is the hook point for a future model-based filter (which should cache verdicts by post ID).
- **Config** (`config.json` in app data): X list ID, friends handles, allowlist patterns per platform.

## Later / out of scope
- Notifications (badges from page title, native notifications for DMs).
- Model-based filtering of X posts (local model via Ollama).
- Mobile access (Matrix + mautrix bridges on a home server).
- Stories, profiles, Events, Groups.

## Implementation notes
- Non-social links (articles etc.) open in the system browser; social links never leave the hub.
  Meta's `l.instagram.com` / `l.facebook.com` link wrappers are unwrapped first.
- X's DOM is filtered only on list and status pages; reposts by friends of non-friends' posts are hidden too.
- Dev runs (`npm start`) use the stock Electron binary, so cookie encryption applies only to `npm run dist` builds.
