import type { DesktopState } from "./native";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function humanDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min focused today`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h${rest ? ` ${rest} min` : ""} focused today`;
}

async function render(): Promise<void> {
  const stored = await chrome.storage.local.get([
    "desktopState",
    "desktopConnected",
  ]);
  const state = (stored.desktopState as DesktopState | undefined) ?? null;
  const connected = stored.desktopConnected === true;

  if (!connected) {
    $("emoji").textContent = "!";
    $("state").textContent = "Desktop not connected";
    $("detail").textContent =
      "Open or update yawningface desktop, then refresh this companion.";
    $("today").textContent = "";
    return;
  }

  $("today").textContent = humanDuration(state?.focusedTodaySeconds ?? 0);
  if (!state || state.domains.length === 0) {
    $("emoji").textContent = "\u{1F634}";
    $("state").textContent = "Nothing blocked right now";
    $("detail").textContent = "Sessions and schedules live in the desktop app.";
    return;
  }

  $("emoji").textContent = "\u{1F60E}";
  $("state").textContent = `Blocking ${state.domains.length} ${
    state.domains.length === 1 ? "site" : "sites"
  }`;
  const source = state.reasons.length ? state.reasons.join(", ") : "desktop";
  const until = state.sessionUntil
    ? ` until ${new Date(state.sessionUntil).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "";
  $("detail").textContent = `${source}${until}`;
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
    button.textContent = "Refresh from desktop";
  }
});

$("options").addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

void render();
