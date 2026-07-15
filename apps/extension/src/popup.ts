import { applyDesktopAppearance, type DesktopState } from "./native";

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
    "desktopBridgeError",
  ]);
  const state = (stored.desktopState as DesktopState | undefined) ?? null;
  applyDesktopAppearance(state);
  const connected = stored.desktopConnected === true;

  if (!connected) {
    $("emoji").textContent = "!";
    $("state").textContent = "Desktop not connected";
    $("detail").textContent =
      "Open or update yawningface desktop, then refresh this companion.";
    $("today").textContent = "";
    $("sync-status").textContent = stored.desktopBridgeError
      ? `Connection error: ${String(stored.desktopBridgeError)}`
      : "Desktop connection unavailable.";
    $("sync-status").classList.add("error-text");
    return;
  }

  if (stored.desktopBridgeError) {
    $("sync-status").textContent = `Browser rule error: ${String(stored.desktopBridgeError)}`;
    $("sync-status").classList.add("error-text");
  } else {
    $("sync-status").classList.remove("error-text");
  }
  const updated = state?.updatedAt
    ? new Date(state.updatedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "just now";
  if (!stored.desktopBridgeError) {
    $("sync-status").textContent = `Connected to desktop / state updated ${updated}`;
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
  button.textContent = "Syncing...";
  try {
    const response = (await chrome.runtime.sendMessage({ type: "yf:refresh" })) as {
      ok?: boolean;
      connected?: boolean;
      error?: string | null;
    };
    await render();
    if (!response?.ok || !response.connected) {
      $("sync-status").textContent = response?.error ?? "Desktop did not reply.";
      $("sync-status").classList.add("error-text");
      button.textContent = "Try again";
      return;
    }
    $("sync-status").textContent = `Connected / synced ${new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}`;
    button.textContent = "Synced";
  } catch (error) {
    $("sync-status").textContent =
      error instanceof Error ? error.message : String(error);
    $("sync-status").classList.add("error-text");
    button.textContent = "Try again";
  } finally {
    button.disabled = false;
  }
});

$("options").addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

void render();
