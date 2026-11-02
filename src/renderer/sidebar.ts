interface HubBridge {
  platforms(): Promise<{ platforms: { id: string; label: string }[]; active: string }>;
  select(id: string): void;
  openConfig(): void;
  openLog(): void;
  relaunch(): void;
  onActive(cb: (id: string) => void): void;
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
document.getElementById('open-config')!.addEventListener('click', () => bridge.openConfig());
document.getElementById('open-log')!.addEventListener('click', () => bridge.openLog());
document.getElementById('relaunch')!.addEventListener('click', () => bridge.relaunch());
