import type { DesktopState } from "./native";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

async function render(): Promise<void> {
  const stored = await chrome.storage.local.get([
    "desktopState",
    "desktopConnected",
  ]);
  const state = (stored.desktopState as DesktopState | undefined) ?? null;
  const connected = stored.desktopConnected === true;
  $("connection-dot").classList.toggle("connected", connected);

  if (!connected) {
    $("connection-title").textContent = "Desktop not connected";
    $("connection-detail").textContent =
      "Open or update yawningface desktop. The extension never starts a block on its own.";
    $("active-summary").textContent = "No live desktop state available.";
    $("domains").replaceChildren();
  } else {
    $("connection-title").textContent = "Connected to yawningface desktop";
    const updated = state?.updatedAt
      ? new Date(state.updatedAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : "just now";
    $("connection-detail").textContent = `Last desktop state: ${updated}.`;

    const domains = state?.domains ?? [];
    $("active-summary").textContent = domains.length
      ? `${domains.length} ${domains.length === 1 ? "website is" : "websites are"} being redirected before DNS.`
      : "Desktop is connected and no websites are blocked right now.";

    const list = $("domains");
    list.replaceChildren();
    for (const domain of domains) {
      const item = document.createElement("span");
      item.className = "domain-chip";
      item.textContent = domain;
      list.append(item);
    }
  }

  $("version").textContent = `Companion v${chrome.runtime.getManifest().version} / ${chrome.runtime.id}`;
}

$("refresh").addEventListener("click", async () => {
  const button = $("refresh") as HTMLButtonElement;
  button.disabled = true;
  button.textContent = "Refreshing...";
  try {
    await chrome.runtime.sendMessage({ type: "yf:refresh" });
    await render();
  } finally {
    button.disabled = false;
    button.textContent = "Refresh";
  }
});

void render();
