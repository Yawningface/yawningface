import {
  currentDomains,
  load,
  sessionRunning,
  todayKey,
  type Session,
} from "./engine";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let minutes = 60;

function humanMinutes(min: number): string {
  if (min < 60) return `${min} m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} m` : `${h} h`;
}

async function render(): Promise<void> {
  const { config, session, days } = await load();
  const running = sessionRunning(session);
  const { domains, reasons } = currentDomains(config, session);
  const blocking = domains.length > 0;

  $("emoji").textContent = blocking ? "😎" : "😴";

  if (running) {
    const until = session.until
      ? new Date(session.until).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
    $("state").textContent = `Blocking ${domains.length} sites`;
    $("detail").textContent = until ? `until ${until}` : "until you stop";
  } else if (blocking) {
    $("state").textContent = `${reasons.join(", ")} is on`;
    $("detail").textContent = `${domains.length} sites blocked`;
  } else {
    $("state").textContent = "Nothing blocked right now.";
    $("detail").textContent = "";
  }

  // The button is the switch: it says what will happen, not what is true.
  const toggle = $<HTMLButtonElement>("toggle");
  toggle.textContent = running ? "End session" : "Start working session";
  $("picker").style.display = running ? "none" : "flex";
  $("hint").style.display = running ? "none" : "block";

  const focused = Math.round((days[todayKey()] ?? 0) / 60);
  $("today").textContent = focused > 0 ? `${humanMinutes(focused)} focused today` : "";
}

async function apply(session: Session): Promise<void> {
  await chrome.storage.local.set({ session });
  await chrome.runtime.sendMessage({ type: "yf:apply" });
  await render();
}

$("picker").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn) return;
  minutes = Number(btn.dataset.min);
  for (const b of $("picker").querySelectorAll("button")) b.classList.remove("on");
  btn.classList.add("on");
});

$("toggle").addEventListener("click", async () => {
  const { session } = await load();
  if (sessionRunning(session)) {
    await apply({ active: false, until: null });
  } else {
    await apply({
      active: true,
      until: minutes > 0 ? Date.now() + minutes * 60_000 : null,
    });
  }
});

$("options").addEventListener("click", () => chrome.runtime.openOptionsPage());

void render();
