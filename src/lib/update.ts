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

  let reg: ServiceWorkerRegistration | null = null;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      showUpdateToast({
        countdownSec: 4,
        onReload: () => void updateSW(true),
      });
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      reg = registration;
      setInterval(() => { void registration.update(); }, 5 * 60 * 1000);
    },
  });

  // Check for update whenever tab returns to foreground — users switching apps
  // on mobile should see fresh content on resume, not a stale cached copy.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && reg) {
      void reg.update();
    }
  });

  // When a new SW takes control, reload — ensures UI uses new JS immediately.
  let hasReloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hasReloaded) return;
    hasReloaded = true;
    location.reload();
  });
}

// Nuclear option — user-triggered hard reset when caches go sideways.
export async function hardReset(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* ignore */ }
  location.reload();
}
