interface HubBridge {
  platforms(): Promise<{ platforms: { id: string; label: string }[]; active: string }>;
  select(id: string): void;
  openLink(text?: string): void;
  onActive(cb: (id: string) => void): void;
  setDockOpen(open: boolean): void;
  onDockClose(cb: () => void): void;
}

const bridge = (window as unknown as { hub: HubBridge }).hub;
const SHORT_LABELS: Record<string, string> = { instagram: 'IG', facebook: 'FB', x: 'X' };

function markActive(id: string) {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.platform')) {
    button.classList.toggle('active', button.dataset.id === id);
  }
}

void bridge.platforms().then(({ platforms, active }) => {
  const nav = document.getElementById('platforms')!;
  for (const platform of platforms) {
    const button = document.createElement('button');
    button.className = 'platform';
    button.dataset.id = platform.id;
    button.title = `${platform.label} (click again to return home)`;
    button.textContent = SHORT_LABELS[platform.id] ?? platform.label[0];
    button.addEventListener('click', () => bridge.select(platform.id));
    nav.append(button);
  }
  markActive(active);
});

bridge.onActive(markActive);
// The dock view is a thin strip at the window edge until the pointer reaches it. Opening
// widens the view first, then slides the bubbles in; closing (decided by main, which can
// see the pointer over the platform page) slides them out, then shrinks the view.
const SLIDE_MS = 240;
let collapseTimer: ReturnType<typeof setTimeout> | undefined;

function openDock() {
  clearTimeout(collapseTimer);
  collapseTimer = undefined;
  if (document.body.classList.contains('open')) return;
  bridge.setDockOpen(true);
  requestAnimationFrame(() => document.body.classList.add('open'));
}

document.addEventListener('mousemove', openDock);
document.addEventListener('dragenter', openDock);
bridge.onDockClose(() => {
  document.body.classList.remove('open');
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => bridge.setDockOpen(false), SLIDE_MS);
});

document.getElementById('open-link')!.addEventListener('click', () => bridge.openLink());
// Links dropped onto the dock (e.g. dragged from Slack or a browser) open the same way.
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => {
  event.preventDefault();
  const text = event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain');
  if (text) bridge.openLink(text);
});
