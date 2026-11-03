import type { HubConfig, PlatformId } from './config';

/** What to do with a URL a platform view wants to load. */
export type Verdict =
  | { kind: 'allow' }
  | { kind: 'viewer'; url: string }
  | { kind: 'call' }
  | { kind: 'external' }
  | { kind: 'block' };

export interface Platform {
  id: PlatformId;
  label: string;
  partition: string;
  home: string;
  /** Cosmetic CSS injected on every page load (hides nav that leads to feeds). */
  css?: string;
  classify(url: string): Verdict;
  /** Stable identity of a shared item, used to keep the viewer locked to it. */
  itemKey(url: string): string | null;
}

/** Hosts that belong to social platforms; they never leave the hub. */
const SOCIAL_HOST = /(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.watch|messenger\.com|x\.com|twitter\.com|threads\.net|threads\.com)$/;

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** l.instagram.com/?u=… and l.facebook.com/l.php?u=… wrap outbound links. */
export function unwrapLinkShim(url: string): string {
  const u = parse(url);
  if (u && /^l[m]?\.(instagram|facebook)\.com$/.test(u.hostname)) {
    return u.searchParams.get('u') ?? url;
  }
  return url;
}

function fallback(u: URL): Verdict {
  if (u.protocol === 'about:' || u.protocol === 'blob:' || u.protocol === 'data:') return { kind: 'allow' };
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { kind: 'block' };
  return SOCIAL_HOST.test(u.hostname) ? { kind: 'block' } : { kind: 'external' };
}

function extraMatchers(patterns: string[]): RegExp[] {
  return patterns.flatMap((p) => {
    try {
      return [new RegExp(p)];
    } catch {
      console.error(`Invalid extraAllow pattern: ${p}`);
      return [];
    }
  });
}

function instagram(config: HubConfig): Platform {
  const extra = extraMatchers(config.extraAllow.instagram);
  const host = /^(www\.)?instagram\.com$/;
  const allowPath = /^\/(direct|accounts|challenge|two_factor|auth_platform)(\/|$)/;
  const callPath = /^\/(call|rtc)(\/|$)/;
  const itemPath = /^\/(?:[\w.]+\/)?(p|reels?|tv)\/([\w-]+)/;
  const storyPath = /^\/stories\/([\w.]+)\/(\d+)/;

  const itemKey = (url: string) => {
    const u = parse(url);
    if (!u || !host.test(u.hostname)) return null;
    const item = u.pathname.match(itemPath);
    if (item) return `ig:post:${item[2]}`;
    const story = u.pathname.match(storyPath);
    if (story) return `ig:story:${story[1]}:${story[2]}`;
    return null;
  };

  return {
    id: 'instagram',
    label: 'Instagram',
    partition: 'persist:instagram',
    home: 'https://www.instagram.com/direct/inbox/',
    // Left rail: keep only Notifications, pinned top-left as a bare icon. Anchored on
    // the Search link (/explore/), since Notifications always follows it and labels
    // follow the account language. The rail panel is hidden with `visibility` (not
    // `display`) so the Notifications item can opt back in, and since hidden elements
    // take no hover, the rail never expands; the item itself is clipped to its icon.
    css: `
      div:has(> div > div > div > div > span > div > a[href="/explore/"]) {
        visibility: hidden !important;
        width: 72px !important;
      }
      div:has(> span > div > a[href="/explore/"]) + div {
        visibility: visible !important;
        position: fixed !important;
        top: 24px !important;
        left: 12px !important;
        width: 48px !important;
        overflow: hidden !important;
      }
    `,
    itemKey,
    classify(url) {
      const u = parse(url);
      if (!u) return { kind: 'block' };
      if (extra.some((r) => r.test(url))) return { kind: 'allow' };
      if (!host.test(u.hostname)) return fallback(u);
      if (allowPath.test(u.pathname)) return { kind: 'allow' };
      if (callPath.test(u.pathname)) return { kind: 'call' };
      const item = u.pathname.match(itemPath);
      if (item) {
        const kind = item[1] === 'tv' ? 'tv' : item[1] === 'p' ? 'p' : 'reel';
        const suffix = config.instagram.viewerUseEmbed ? 'embed/' : '';
        return { kind: 'viewer', url: `https://www.instagram.com/${kind}/${item[2]}/${suffix}` };
      }
      if (storyPath.test(u.pathname)) return { kind: 'viewer', url: u.href };
      return { kind: 'block' };
    },
  };
}

function facebook(config: HubConfig): Platform {
  const extra = extraMatchers(config.extraAllow.facebook);
  const host = /^(www|web)\.facebook\.com$/;
  const allowPath =
    /^\/(messages|login|login\.php|checkpoint|two_step_verification|recover|settings|privacy|security|auth_platform|logout\.php)(\/|$)/;
  const callPath = /^\/(groupcall|videocall)(\/|$)/;
  const itemPath =
    /^\/(reel\/\d+|watch\/?$|share\/|photo(\.php|\/)|permalink\.php|story\.php|[^/]+\/(posts|videos|photos)\/)/;

  const itemKey = (url: string) => {
    const u = parse(url);
    if (!u) return null;
    if (u.hostname === 'fb.watch') return `fb:${u.pathname}`;
    if (!host.test(u.hostname) || !itemPath.test(u.pathname)) return null;
    // Item identity lives in the path for most URLs, in the query for watch/photo/permalink.
    const id = u.searchParams.get('v') ?? u.searchParams.get('fbid') ?? u.searchParams.get('story_fbid') ?? '';
    return `fb:${u.pathname}:${id}`;
  };

  return {
    id: 'facebook',
    label: 'Facebook',
    partition: 'persist:facebook',
    home: 'https://www.facebook.com/messages/',
    // Top bar: keep only notifications and the profile menu. Structural selectors,
    // because aria-labels follow the account language.
    css: `
      [role="banner"] a[href="/"]:not(ul a),
      [role="banner"] *:has(> input[type="search"]),
      [role="banner"] *:has(> * > input[type="search"]),
      [role="banner"] [role="navigation"]:has(ul),
      [role="banner"] [role="navigation"]:not(:has(ul)) > :not(:nth-last-child(-n + 2)) {
        display: none !important;
      }
    `,
    itemKey,
    classify(url) {
      const u = parse(url);
      if (!u) return { kind: 'block' };
      if (extra.some((r) => r.test(url))) return { kind: 'allow' };
      if (u.hostname === 'fb.watch') return { kind: 'viewer', url: u.href };
      if (!host.test(u.hostname)) return fallback(u);
      if (allowPath.test(u.pathname)) return { kind: 'allow' };
      if (callPath.test(u.pathname)) return { kind: 'call' };
      if (itemPath.test(u.pathname)) return { kind: 'viewer', url: u.href };
      return { kind: 'block' };
    },
  };
}

function x(config: HubConfig): Platform {
  const extra = extraMatchers(config.extraAllow.x);
  const friends = new Set(config.x.friends.map((h) => h.replace(/^@/, '').toLowerCase()));
  const listId = config.x.listId.trim();
  const host = /^(www\.)?(x|twitter)\.com$/;
  const allowPath = /^\/(messages|i\/chat|i\/flow|i\/jf|login|logout|account|settings)(\/|$)/;
  const statusPath = /^\/(\w{1,15})\/status\/(\d+)/;

  return {
    id: 'x',
    label: 'X',
    partition: 'persist:x',
    home: listId ? `https://x.com/i/lists/${listId}` : 'https://x.com/messages',
    itemKey(url) {
      const u = parse(url);
      const m = u && host.test(u.hostname) ? u.pathname.match(statusPath) : null;
      return m ? `x:${m[2]}` : null;
    },
    classify(url) {
      const u = parse(url);
      if (!u) return { kind: 'block' };
      if (extra.some((r) => r.test(url))) return { kind: 'allow' };
      if (!host.test(u.hostname)) return fallback(u);
      if (allowPath.test(u.pathname)) return { kind: 'allow' };
      if (listId && new RegExp(`^/i/lists/${listId}/?$`).test(u.pathname)) return { kind: 'allow' };
      const status = u.pathname.match(statusPath);
      if (status) {
        // Friends' posts open inline; anyone else's only in the locked viewer.
        return friends.has(status[1].toLowerCase()) ? { kind: 'allow' } : { kind: 'viewer', url: u.href };
      }
      return { kind: 'block' };
    },
  };
}

export function createPlatforms(config: HubConfig): Platform[] {
  return [instagram(config), facebook(config), x(config)];
}
