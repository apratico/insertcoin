import { registerSW } from "virtual:pwa-register";

type ToastOpts = { countdownSec: number; onReload: () => void };

function showUpdateToast({ countdownSec, onReload }: ToastOpts): void {
  let el = document.querySelector<HTMLElement>(".update-toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "update-toast";
    document.body.appendChild(el);
  }
  let remaining = countdownSec;
  const render = (): void => {
    el!.innerHTML = `
      <span class="update-toast-dot"></span>
      <span class="update-toast-msg">Nuova versione · ricarico in ${remaining}s</span>
      <button class="update-toast-btn" id="update-now">RICARICA ORA</button>
    `;
    el!.querySelector<HTMLButtonElement>("#update-now")?.addEventListener("pointerup", () => {
      clearInterval(tick);
      onReload();
    });
  };
  render();
  const tick = window.setInterval(() => {
    remaining--;
    if (remaining <= 0) { clearInterval(tick); onReload(); return; }
    render();
  }, 1000);
}

export function setupAutoUpdate(): void {
  if (!("serviceWorker" in navigator)) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      showUpdateToast({
        countdownSec: 4,
        onReload: () => void updateSW(true),
      });
    },
    onRegisteredSW(_swUrl, registration) {
      // Periodic check every 5 min so long-open tabs pick up new deploys
      if (!registration) return;
      setInterval(() => {
        void registration.update();
      }, 5 * 60 * 1000);
    },
  });
}
