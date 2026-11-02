import { ipcRenderer } from 'electron';

/*
 * Runs inside the X view. Hides every post whose author isn't on the friends
 * list (ads, promoted and suggested posts included) and the trends/"who to
 * follow" column. This is also the hook point for a future model-based filter.
 */

const { friends } = ipcRenderer.sendSync('x-filter:config') as { friends: string[] };
const allowed = new Set(friends.map((h) => h.replace(/^@/, '').toLowerCase()));

const HIDE_CSS = `
  [data-testid="sidebarColumn"] { display: none !important; }
`;

/** Only the friends list and single posts show timelines; DMs and settings are left alone. */
function isTimelinePage() {
  return /^\/i\/lists\/|\/status\//.test(location.pathname);
}

function authorOf(article: Element): string | null {
  // The first User-Name block is the post's author; quoted posts come later in the DOM.
  const link = article.querySelector<HTMLAnchorElement>('[data-testid="User-Name"] a[href^="/"]');
  const handle = link?.getAttribute('href')?.split('/')[1];
  return handle ? handle.toLowerCase() : null;
}

function cellOf(el: Element): HTMLElement {
  return (el.closest('[data-testid="cellInnerDiv"]') as HTMLElement | null) ?? (el as HTMLElement);
}

function setHidden(el: HTMLElement, hidden: boolean) {
  el.style.display = hidden ? 'none' : '';
}

function filterTimeline() {
  if (allowed.size === 0 || !isTimelinePage()) return;
  // X recycles DOM nodes while scrolling, so every pass re-evaluates every post.
  for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
    const author = authorOf(article);
    setHidden(cellOf(article), author === null || !allowed.has(author));
  }
  // Inline "Who to follow" modules.
  for (const userCell of document.querySelectorAll('[data-testid="UserCell"]')) {
    setHidden(cellOf(userCell), true);
  }
}

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    filterTimeline();
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = HIDE_CSS;
  document.head.append(style);
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
});
