import {
  currentDomains,
  load,
  sessionRunning,
  todayKey,
  unblocksToday,
} from "./engine";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function humanMinutes(min: number): string {
  if (min < 60) return `${min} m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} m` : `${h} h`;
}

async function render(): Promise<void> {
  const domain = new URLSearchParams(location.search).get("d") ?? "";
  const { config, cloudConfig, session, days, attempts, unblocks } = await load();

  if (domain) {
    $("domain").textContent = domain;
    // Count the attempt, so the number below is real rather than decorative.
    await chrome.runtime.sendMessage({ type: "yf:attempt", domain });
  }

  const { reasons } = currentDomains(
    config,
    session,
    unblocks,
    new Date(),
    cloudConfig,
  );
  const running = sessionRunning(session);

  $("reason").textContent = running
    ? "during your working session"
    : reasons.length > 0
      ? `by ${reasons.join(", ")}`
      : "right now";

  if (running && session.until) {
    const until = new Date(session.until).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    $("until").textContent = `The session ends at ${until}. It will still be here.`;
  } else {
    $("until").textContent = "It will still be here later.";
  }

  $("focused").textContent = humanMinutes(
    Math.round((days[todayKey()] ?? 0) / 60),
  );
  $("attempts").textContent = String((attempts[domain] ?? 0) + 1);
  $("unblocks").textContent = String(unblocksToday(unblocks));

  // "Keep me out" is the loud one; the way out is quiet but never hidden.
  $("keep").addEventListener("click", () => {
    // Nowhere sensible to go but away from here.
    location.href = "about:blank";
  });

  const reasonForm = $("unblock-reason") as HTMLFormElement;
  const reasonInput = $("reason") as HTMLTextAreaElement;

  $("unblock").addEventListener("click", () => {
    if (!domain) return;
    reasonForm.hidden = false;
    $("unblock").setAttribute("hidden", "");
    reasonInput.focus();
  });

  $("cancel-unblock").addEventListener("click", () => {
    reasonForm.hidden = true;
    $("unblock").removeAttribute("hidden");
    reasonInput.value = "";
  });

  reasonForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!domain || !reasonInput.reportValidity()) return;
    const response = (await chrome.runtime.sendMessage({
      type: "yf:unblock",
      domain,
      reason: reasonInput.value,
    })) as { ok: boolean; minutes?: number; error?: string };
    if (!response.ok || !response.minutes) {
      reasonInput.setCustomValidity(response.error ?? "Could not unblock this site.");
      reasonInput.reportValidity();
      return;
    }

    const minutes = response.minutes;
    reasonForm.hidden = true;
    reasonInput.value = "";

    const note = $("unblocked-note");
    note.hidden = false;
    note.textContent = `Letting ${domain} through for ${minutes} minutes. Your reason is written down.`;

    // Give the rules a moment to update, then go where you were going.
    setTimeout(() => {
      location.href = `https://${domain}`;
    }, 900);
  });

  reasonInput.addEventListener("input", () => reasonInput.setCustomValidity(""));
}

void render();
