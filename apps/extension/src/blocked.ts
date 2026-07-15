import { applyDesktopAppearance, type DesktopState } from "./native";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function humanMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} m` : `${hours} h`;
}

async function render(): Promise<void> {
  const domain = new URLSearchParams(location.search).get("d") ?? "";
  const stored = await chrome.storage.local.get(["desktopState", "attempts"]);
  const state = (stored.desktopState as DesktopState | undefined) ?? null;
  applyDesktopAppearance(state);
  const attempts =
    (stored.attempts as Record<string, number> | undefined) ?? {};

  if (domain) $("domain").textContent = domain;
  const attemptResponse = domain
    ? ((await chrome.runtime.sendMessage({ type: "yf:attempt", domain })) as {
        ok?: boolean;
        attempts?: number;
      })
    : {};

  $("block-reason").textContent = state?.reasons.length
    ? `by ${state.reasons.join(", ")}`
    : "by the desktop app";

  if (state?.sessionUntil) {
    const until = new Date(state.sessionUntil).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    $("until").textContent = `The session ends at ${until}. It will still be here.`;
  } else {
    $("until").textContent = "It will still be here later.";
  }

  $("focused").textContent = humanMinutes(
    Math.round((state?.focusedTodaySeconds ?? 0) / 60),
  );
  $("attempts").textContent = String(
    attemptResponse.attempts ?? attempts[domain] ?? 0,
  );

  if (attemptResponse.ok === false) {
    $("block-reason").textContent = "by a session that has just ended";
    $("until").textContent =
      "Refresh the original tab. Desktop is no longer blocking this website.";
    $("unblock").setAttribute("hidden", "");
  }
  $("unblocks").textContent = String(state?.unblocksToday ?? 0);

  $("keep").addEventListener("click", () => {
    location.href = "about:blank";
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
    $("unblocks").textContent = String((state?.unblocksToday ?? 0) + 1);

    // Desktop waits for its privileged hosts helper before acknowledging the
    // exception; this short beat lets Chrome discard the old DNS failure too.
    setTimeout(() => {
      location.href = `https://${domain}`;
    }, 1_200);
  });
}

void render();
