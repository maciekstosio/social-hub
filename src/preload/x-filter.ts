import { ipcRenderer } from 'electron';

/*
 * Runs inside the X view. Hides every post whose author isn't on the friends
 * list (ads, promoted and suggested posts included) and the trends/"who to
 * follow" column. This is also the hook point for a future model-based filter.
 */

const { friends, home } = ipcRenderer.sendSync('x-filter:config') as { friends: string[]; home: string };
const allowed = new Set(friends.map((h) => h.replace(/^@/, '').toLowerCase()));
/** An empty friends list turns the author filter off; your own handle must not turn it on. */
const filterOn = allowed.size > 0;

const HIDE_CSS = `
  [data-testid="sidebarColumn"] { display: none !important; }
  /* Left nav: keep only Home and Notifications (plus compose and the avatar, which live outside the nav). */
  header[role="banner"] h1,
  header[role="banner"] nav[role="navigation"] > :not([data-testid="AppTabBar_Home_Link"]):not([data-testid="AppTabBar_Notifications_Link"]) {
    display: none !important;
  }
  /* Floating Grok / Chat buttons in the bottom-right corner. */
  [data-testid="GrokDrawer"],
  [data-testid="DMDrawer"],
  [data-testid="chat-drawer-root"],
  [data-testid="ChatDrawer"] {
    display: none !important;
  }
`;

/** Bottom-right floating buttons whose test ids X keeps renaming; matched by label instead. */
const FLOATING_LABEL = /grok|chat|message/i;

function hideFloatingButtons() {
  for (const button of document.querySelectorAll<HTMLElement>('#layers [aria-label]')) {
    if (!FLOATING_LABEL.test(button.getAttribute('aria-label') ?? '')) continue;
    if (button.closest('[role="dialog"]')) continue;
    // Climb to the fixed-position wrapper so the whole floating widget goes away.
    let el: HTMLElement | null = button;
    while (el && el.id !== 'layers' && getComputedStyle(el).position !== 'fixed') el = el.parentElement;
    if (el && el.id !== 'layers') el.style.display = 'none';
  }
}

let reportedSelf: string | null = null;
/** Tells main which account is signed in so its profile pages are allowed. */
function reportSelf() {
  const href = document.querySelector('[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
  const handle = href?.split('/')[1]?.toLowerCase();
  if (!handle || handle === reportedSelf) return;
  reportedSelf = handle;
  allowed.add(handle);
  ipcRenderer.send('x-filter:self', handle);
}

/** Home leads back to the friends list (X's /home feed is blocked). */
function onHomeClick(event: MouseEvent) {
  const target = event.target as Element | null;
  if (!target?.closest('[data-testid="AppTabBar_Home_Link"]')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (location.href !== home) location.assign(home);
}

/** The avatar opens the (hidden) profile link instead of the account menu. */
function onAvatarClick(event: MouseEvent) {
  const target = event.target as Element | null;
  if (!target?.closest('[data-testid="SideNav_AccountSwitcher_Button"]')) return;
  const profile = document.querySelector<HTMLElement>('[data-testid="AppTabBar_Profile_Link"]');
  if (!profile) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  profile.click();
}

/** Only the friends list and single posts show timelines; DMs, settings and the list editor are left alone. */
function isTimelinePage() {
  // Not the list editor pages (/i/lists/<id>/members…), which are made of user cells.
  return /^\/i\/lists\/\d+\/?$|\/status\//.test(location.pathname);
}

function authorOf(article: Element): string | null {
  // The first User-Name block is the post's author; quoted posts come later in the DOM.
  const link = article.querySelector<HTMLAnchorElement>('[data-testid="User-Name"] a[href^="/"]');
  const handle = link?.getAttribute('href')?.split('/')[1];
  return handle ? handle.toLowerCase() : null;
}

function setHidden(el: HTMLElement, hidden: boolean) {
  el.style.display = hidden ? 'none' : '';
  if (hidden) el.dataset.hubHidden = '';
  else delete el.dataset.hubHidden;
}

function filterTimeline() {
  if (!filterOn || !isTimelinePage()) return;
  // X recycles DOM nodes while scrolling, so every pass re-evaluates every cell.
  for (const cell of document.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]')) {
    const article = cell.querySelector('article[data-testid="tweet"]');
    if (article) {
      const author = authorOf(article);
      setHidden(cell, author === null || !allowed.has(author));
    } else if (cell.querySelector('[data-testid="UserCell"]')) {
      // Inline "Who to follow" modules.
      setHidden(cell, true);
    } else {
      // Thread leftovers ("Show more replies", connector dots) belong to the post above;
      // drop them with it. Cells are visited in DOM order, so whole chains collapse.
      const prev = cell.previousElementSibling as HTMLElement | null;
      const orphaned = prev?.dataset.hubHidden !== undefined && !cell.querySelector('[role="progressbar"]');
      setHidden(cell, orphaned);
    }
  }
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    reportSelf();
    hideFloatingButtons();
    filterTimeline();
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = HIDE_CSS;
  document.head.append(style);
  document.addEventListener('click', onHomeClick, true);
  document.addEventListener('click', onAvatarClick, true);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
});
