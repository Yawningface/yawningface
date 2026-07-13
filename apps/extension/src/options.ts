import { validateConfig, type BlockConfig } from "@yawningface/schema";
import { DEFAULT_SESSION_DOMAINS, blocklistFromDomains, load } from "./engine";

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

let config: BlockConfig;

async function save(): Promise<void> {
  await chrome.storage.local.set({ config });
  await chrome.runtime.sendMessage({ type: "yf:apply" });
  render();
}

function summarize(days: string[]): string {
  if (days.length === 0 || days.length === 7) return "Every day";
  const work = ["mon", "tue", "wed", "thu", "fri"];
  if (days.length === 5 && work.every((d) => days.includes(d))) return "Weekdays";
  if (days.length === 2 && ["sat", "sun"].every((d) => days.includes(d))) {
    return "Weekends";
  }
  return days.map((d) => d[0].toUpperCase() + d.slice(1)).join(" ");
}

function render(): void {
  const lists = $("lists");
  lists.innerHTML = "";

  if (config.blocklists.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent =
      "No schedules yet. A routine that starts without you beats willpower every time.";
    lists.append(p);
  }

  config.blocklists.forEach((list, i) => {
    const period = list.metadata.timePeriods[0];
    const row = document.createElement("div");
    row.className = "list-row";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = list.metadata.enabled;
    check.addEventListener("change", () => {
      config.blocklists[i].metadata.enabled = check.checked;
      void save();
    });

    const name = document.createElement("span");
    name.className = "list-name";
    name.textContent = list.name;

    const when = document.createElement("span");
    when.className = "small-text";
    when.textContent = period
      ? `${summarize(period.schedule)} ${period.startTime}-${period.endTime} · ${list.targets.websites.length} sites`
      : "always on";

    const remove = document.createElement("button");
    remove.className = "link";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      config.blocklists.splice(i, 1);
      void save();
    });

    row.append(check, name, when, remove);
    lists.append(row);
  });

  $("defaults").textContent = DEFAULT_SESSION_DOMAINS.join(", ");
}

function openEditor(): void {
  const editor = $("editor");
  editor.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "editor";

  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "Name, e.g. Mornings";

  const days = document.createElement("div");
  days.className = "days";
  const chosen = new Set(["mon", "tue", "wed", "thu", "fri"]);
  DAYS.forEach((d, i) => {
    const b = document.createElement("button");
    b.className = `day ${chosen.has(d) ? "on" : ""}`;
    b.textContent = DAY_LABELS[i];
    b.addEventListener("click", () => {
      if (chosen.has(d)) chosen.delete(d);
      else chosen.add(d);
      b.classList.toggle("on");
    });
    days.append(b);
  });

  const range = document.createElement("div");
  range.className = "time-range";
  const start = document.createElement("input");
  start.type = "time";
  start.value = "09:00";
  const to = document.createElement("span");
  to.className = "muted";
  to.textContent = "to";
  const end = document.createElement("input");
  end.type = "time";
  end.value = "13:00";
  range.append(start, to, end);

  const sites = document.createElement("textarea");
  sites.rows = 5;
  sites.value = DEFAULT_SESSION_DOMAINS.join("\n");

  const actions = document.createElement("div");
  actions.className = "actions";
  const save_ = document.createElement("button");
  save_.className = "primary";
  save_.textContent = "Save schedule";
  const cancel = document.createElement("button");
  cancel.className = "ghost";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => (editor.innerHTML = ""));

  save_.addEventListener("click", () => {
    const domains = sites.value.split(/[\s,]+/).filter(Boolean);
    if (domains.length === 0) return;
    config.blocklists.push(
      blocklistFromDomains(
        name.value.trim() || "Scheduled session",
        domains,
        start.value,
        end.value,
        [...chosen],
      ),
    );
    editor.innerHTML = "";
    void save();
  });

  actions.append(save_, cancel);
  wrap.append(name, days, range, sites, actions);
  editor.append(wrap);
}

$("new").addEventListener("click", openEditor);

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(config, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "yawningface.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("import").addEventListener("click", () => $("file").click());

$("file").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    // Refuse anything that is not a valid contract document, rather than
    // silently importing a config that will never block anything.
    const problem = validateConfig(parsed);
    if (problem) {
      $("status").textContent = `That file is not a valid config: ${problem}`;
      return;
    }
    config = parsed as BlockConfig;
    await save();
    $("status").textContent = `Imported ${config.blocklists.length} blocklist(s).`;
  } catch (err) {
    $("status").textContent = `Could not read that file: ${String(err)}`;
  }
});

void (async () => {
  config = (await load()).config;
  render();
})();
