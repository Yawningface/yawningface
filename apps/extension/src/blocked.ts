import { applyDesktopAppearance, type DesktopState } from "./native";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function describeBlock(reasons: string[]): {
  text: string;
  source: "schedule" | "working" | "desktop";
} {
  const schedule = reasons.find(
    (reason) => reason.trim().toLowerCase() !== "working session",
  );
  if (schedule) {
    return { text: `by blocking schedule "${schedule}"`, source: "schedule" };
  }
  if (reasons.some((reason) => reason.trim().toLowerCase() === "working session")) {
    return { text: "by your working session", source: "working" };
  }
  return { text: "by the desktop app", source: "desktop" };
}

async function render(): Promise<void> {
  const domain = new URLSearchParams(location.search).get("d") ?? "";
  const stored = await chrome.storage.local.get("desktopState");
  const state = (stored.desktopState as DesktopState | undefined) ?? null;
  applyDesktopAppearance(state);
  let blockingEnded = false;

  if (domain) $("domain").textContent = domain;
  const attemptResponse = domain
    ? ((await chrome.runtime.sendMessage({ type: "yf:attempt", domain })) as {
        ok?: boolean;
      })
    : {};

  const description = describeBlock(state?.reasons ?? []);
  $("block-reason").textContent = description.text;

  if (description.source === "schedule") {
    $("until").textContent = "This schedule is active right now.";
  } else if (description.source === "working" && state?.sessionUntil) {
    const until = new Date(state.sessionUntil).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    $("until").textContent = `Your working session ends at ${until}.`;
  } else if (description.source === "working") {
    $("until").textContent = "Your working session is active right now.";
  } else {
    $("until").textContent = "It will still be here later.";
  }

  if (attemptResponse.ok === false) {
    blockingEnded = true;
    $("block-reason").textContent = "by a session that has just ended";
    $("until").textContent = "Desktop is no longer blocking this website.";
    $("close-tab").textContent = `Continue to ${domain}`;
    $("unblock").setAttribute("hidden", "");
  }

  $("close-tab").addEventListener("click", async () => {
    if (blockingEnded && domain) {
      location.href = `https://${domain}`;
      return;
    }
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) {
      await chrome.tabs.remove(tab.id);
    }
  });

  const form = $("unblock-reason") as HTMLFormElement;
  const excuse = $("excuse") as HTMLTextAreaElement;
  const submit = $("submit-unblock") as HTMLButtonElement;
  const error = $("unblock-error");

  $("unblock").addEventListener("click", () => {
    if (!domain) return;
    form.hidden = false;
    $("unblock").setAttribute("hidden", "");
    excuse.focus();
  });

  $("cancel-unblock").addEventListener("click", () => {
    form.hidden = true;
    $("unblock").removeAttribute("hidden");
    excuse.value = "";
    error.hidden = true;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!domain || !excuse.reportValidity()) return;

    submit.disabled = true;
    submit.textContent = "Asking desktop...";
    error.hidden = true;
    const response = (await chrome.runtime.sendMessage({
      type: "yf:unblock",
      domain,
      reason: excuse.value,
    })) as { ok: boolean; minutes?: number; error?: string };
    submit.disabled = false;
    submit.textContent = "Unblock for 10 minutes";

    if (!response.ok || !response.minutes) {
      error.textContent = response.error ?? "Desktop could not create the exception.";
      error.hidden = false;
      return;
    }

    form.hidden = true;
    const note = $("unblocked-note");
    note.hidden = false;
    note.textContent = `Letting ${domain} through for ${response.minutes} minutes. Your reason is in Insights.`;

    // Desktop waits for its privileged hosts helper before acknowledging the
    // exception; this short beat lets Chrome discard the old DNS failure too.
    setTimeout(() => {
      location.href = `https://${domain}`;
    }, 1_200);
  });
}

void render();
