import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import Onboarding from "./Onboarding";
import type {
  Blocklist,
  DeviceCodeInfo,
  EngineStatus,
  FullState,
  LocalConfigInfo,
  Settings,
} from "./types";

type View = "focus" | "schedules" | "connect" | "settings";

const NAV: { id: View; label: string }[] = [
  { id: "focus", label: "Focus" },
  { id: "schedules", label: "Schedules" },
  { id: "connect", label: "Connect" },
  { id: "settings", label: "Settings" },
];

const DURATIONS: { label: string; minutes: number | null }[] = [
  { label: "30 min", minutes: 30 },
  { label: "1 h", minutes: 60 },
  { label: "2 h", minutes: 120 },
  { label: "No limit", minutes: null },
];

/** iOS-style segmented control with a sliding thumb, in brand yellow.
    The thumb width in styles.css assumes DURATIONS.length === 4. */
function DurationPicker({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (minutes: number | null) => void;
}) {
  const index = DURATIONS.findIndex((d) => d.minutes === value);
  return (
    <div className="segmented">
      <span
        className="segmented-thumb"
        style={{
          transform: `translateX(${index * 100}%)`,
          visibility: index < 0 ? "hidden" : "visible",
        }}
      />
      {DURATIONS.map((d) => (
        <button
          key={d.label}
          className={`segmented-option ${d.minutes === value ? "selected" : ""}`}
          onClick={() => onChange(d.minutes)}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [view, setView] = useState<View>("focus");

  const [localCfg, setLocalCfg] = useState<LocalConfigInfo | null>(null);

  const refresh = useCallback(async () => {
    const state = await invoke<FullState>("get_state");
    setSettings(state.settings);
    setStatus(state.status);
    setLocalCfg(await invoke<LocalConfigInfo>("get_local_config"));
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = listen<EngineStatus>("yf://status", (e) => setStatus(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  if (!settings || !status) return <div className="shell" />;

  // First run: the setup screen owns the whole window.
  if (!settings.onboarded) {
    return (
      <div className="shell">
        <Onboarding status={status} onDone={refresh} />
      </div>
    );
  }

  const schedulesOn = status.activeLists.filter(
    (l) => l !== "Working session",
  ).length;

  return (
    <div className="shell">
      {/* A desktop app, not a phone: navigation on the left, one job per page. */}
      <nav className="sidebar">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${view === item.id ? "active" : ""}`}
            onClick={() => setView(item.id)}
          >
            {item.label}
            {item.id === "schedules" && schedulesOn > 0 && (
              <span className="nav-dot" aria-label="a schedule is on" />
            )}
          </button>
        ))}
        <div className="sidebar-foot small-text">
          Closing the window keeps blocking active in the{" "}
          {IS_MAC ? "menu bar" : "system tray"}.
        </div>
      </nav>

      <div className="content">
        {view === "focus" && (
          <FocusView status={status} onChanged={refresh} />
        )}
        {view === "schedules" && (
          <section className="page">
            <h2>Schedules</h2>
            <p className="page-note">
              Sessions that start without you: weekday mornings, every evening,
              whatever keeps you honest.
            </p>
            {localCfg && (
              <ScheduledSessionsCard info={localCfg} onChanged={refresh} />
            )}
          </section>
        )}
        {view === "connect" && (
          <section className="page">
            <h2>Connect</h2>
            <p className="page-note">
              The same blocklist, everywhere you work.
            </p>
            <SyncCard status={status} onChanged={refresh} />
            {localCfg && <CompanionsCard configPath={localCfg.path} />}
          </section>
        )}
        {view === "settings" && (
          <SettingsView
            settings={settings}
            onSaved={async () => {
              await refresh();
              setView("focus");
            }}
          />
        )}
      </div>
    </div>
  );
}

function SessionCard({
  status,
  onChanged,
}: {
  status: EngineStatus;
  onChanged: (s: EngineStatus) => void;
}) {
  const [minutes, setMinutes] = useState<number | null>(60);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      onChanged(await invoke<EngineStatus>("start_session", { minutes }));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      onChanged(await invoke<EngineStatus>("stop_session"));
    } finally {
      setBusy(false);
    }
  };

  if (status.sessionActive) {
    return (
      <section className="session-card">
        <div className="session-title">Working session</div>
        <button className="ghost pill" disabled={busy} onClick={stop}>
          End session
        </button>
        <p className="small-text">
          Blocks apply to new connections. Tabs you already had open can limp
          along for a couple of minutes until their caches expire.
        </p>
      </section>
    );
  }

  return (
    <section className="session-card">
      <div className="session-title">Ready to focus?</div>
      <DurationPicker value={minutes} onChange={setMinutes} />
      <button className="primary big" disabled={busy} onClick={start}>
        {busy ? "Starting…" : "Start working session"}
      </button>
      <p className="small-text">
        Feeds off in every browser - X, Instagram, TikTok, YouTube, Reddit and
        friends. No account needed.
      </p>
    </section>
  );
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

/** Same list the working session uses; a new schedule starts from it. */
const DEFAULT_WEBSITES = [
  "linkedin.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "reddit.com",
  "youtube.com",
  "twitch.tv",
];

function summarizeDays(schedule: string[]): string {
  const set = schedule.map((d) => d.slice(0, 3).toLowerCase());
  const workweek = ["mon", "tue", "wed", "thu", "fri"];
  if (set.length === 7 || set.length === 0) return "Every day";
  if (set.length === 5 && workweek.every((d) => set.includes(d))) {
    return "Weekdays";
  }
  if (set.length === 2 && ["sat", "sun"].every((d) => set.includes(d))) {
    return "Weekends";
  }
  return set.map((d) => d[0].toUpperCase() + d.slice(1)).join(" ");
}

function ScheduleEditor({
  onSave,
  onCancel,
}: {
  onSave: (list: Blocklist) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [days, setDays] = useState<string[]>(["mon", "tue", "wed", "thu", "fri"]);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("13:00");
  const [websites, setWebsites] = useState(DEFAULT_WEBSITES.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: string) =>
    setDays((cur) =>
      cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d],
    );

  const save = async () => {
    const sites = websites
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sites.length === 0) {
      setError("Add at least one website.");
      return;
    }
    const title = name.trim() || "Scheduled session";
    setBusy(true);
    setError(null);
    try {
      await onSave({
        id: `local-${Date.now().toString(36)}`,
        name: title,
        metadata: {
          enabled: true,
          devices: ["desktop"],
          timePeriods: [{ startTime: start, endTime: end, schedule: days }],
        },
        targets: { websites: sites, apps: [] },
      });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="schedule-editor">
      <input
        placeholder="Name, e.g. Mornings"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <div className="day-picker">
        {DAYS.map((d, i) => (
          <button
            key={d}
            className={`day ${days.includes(d) ? "on" : ""}`}
            onClick={() => toggleDay(d)}
          >
            {DAY_LABELS[i]}
          </button>
        ))}
      </div>
      <div className="time-range">
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        <span className="muted">to</span>
        <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      <details>
        <summary className="muted">Websites ({websites.split(/[\n,\s]+/).filter(Boolean).length})</summary>
        <textarea
          rows={5}
          value={websites}
          onChange={(e) => setWebsites(e.target.value)}
        />
      </details>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="primary" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save schedule"}
        </button>
        <button className="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function ScheduledSessionsCard({
  info,
  onChanged,
}: {
  info: LocalConfigInfo;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const lists = info.config.blocklists ?? [];

  const saveConfig = async (blocklists: Blocklist[]) => {
    await invoke("save_local_config", {
      config: { ...info.config, version: info.config.version ?? 1, blocklists },
    });
    onChanged();
  };

  const add = async (list: Blocklist) => {
    await saveConfig([...lists, list]);
    setAdding(false);
  };

  const toggle = (i: number) =>
    saveConfig(
      lists.map((l, j) =>
        j === i
          ? { ...l, metadata: { ...l.metadata, enabled: !l.metadata?.enabled } }
          : l,
      ),
    );

  const remove = (i: number) => saveConfig(lists.filter((_, j) => j !== i));

  return (
    <section className="card">
      <div className="row">
        <b>Scheduled sessions</b>
        {!adding && (
          <button className="ghost small" onClick={() => setAdding(true)}>
            + New
          </button>
        )}
      </div>
      {lists.length === 0 && !adding && (
        <p className="muted">
          A routine that starts without you: weekday mornings, every evening,
          whatever keeps you honest.
        </p>
      )}
      {lists.map((l, i) => {
        const period = l.metadata?.timePeriods?.[0];
        return (
          <div className="schedule-row" key={l.id ?? i}>
            <label className="checkbox schedule-main">
              <input
                type="checkbox"
                checked={!!l.metadata?.enabled}
                onChange={() => toggle(i)}
              />
              <span className="schedule-name">{l.name}</span>
              <span className="small-text">
                {period
                  ? `${summarizeDays(period.schedule ?? [])} ${period.startTime}-${period.endTime}`
                  : "always on"}
              </span>
            </label>
            <button className="ghost small" onClick={() => remove(i)}>
              Remove
            </button>
          </div>
        );
      })}
      {adding && <ScheduleEditor onSave={add} onCancel={() => setAdding(false)} />}
    </section>
  );
}

const IS_MAC = navigator.userAgent.includes("Mac");
const EXTENSION_URL =
  "https://chromewebstore.google.com/detail/block/kfnhibndbkdjcplihjhbhdhclpbiocen";

function CompanionsCard({ configPath }: { configPath: string }) {
  const [copied, setCopied] = useState(false);

  const cliCommand = IS_MAC
    ? `npm install -g @yawningface/cli\nexport YF_CONFIG="${configPath}"`
    : `npm install -g @yawningface/cli\nsetx YF_CONFIG "${configPath}"`;

  const copy = async () => {
    await navigator.clipboard.writeText(cliCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section className="card">
      <b>Works better together</b>
      <div className="row companion">
        <div>
          <span>Chrome extension</span>
          <p className="small-text">
            Blocks inside the browser too, even on machines without this app.
          </p>
        </div>
        <button className="ghost pill" onClick={() => openUrl(EXTENSION_URL)}>
          Get it
        </button>
      </div>
      <div className="row companion">
        <div>
          <span>yf, the command line</span>
          <p className="small-text">
            Your schedules are one JSON file you own. yf edits the same file
            this app enforces: inspect it, validate it, reshape it by
            conversation.
          </p>
        </div>
        <button className="ghost pill" onClick={copy}>
          {copied ? "Copied" : "Copy setup"}
        </button>
      </div>
    </section>
  );
}

function Hero({ status }: { status: EngineStatus }) {
  const blocking = status.sessionActive || status.blockedDomains > 0;
  const schedules = status.activeLists.filter((l) => l !== "Working session");

  let line: ReactNode = "Nothing blocked right now.";
  if (status.sessionActive) {
    line = (
      <>
        Blocking <b>{status.blockedDomains}</b> sites
        {status.sessionUntil
          ? ` until ${new Date(status.sessionUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : " until you stop"}
      </>
    );
  } else if (blocking && schedules.length > 0) {
    line = (
      <>
        <b>{schedules.join(", ")}</b> is on · {status.blockedDomains} sites
        blocked
      </>
    );
  }

  return (
    <div className="hero">
      <div className="hero-emoji" key={blocking ? "on" : "off"}>
        {blocking ? "😎" : "😴"}
      </div>
      <p className="hero-line">{line}</p>
    </div>
  );
}

/** The whole first page: what is happening, and the one button that changes
    it. Everything else lives behind the sidebar. */
function FocusView({
  status,
  onChanged,
}: {
  status: EngineStatus;
  onChanged: () => void;
}) {
  const [helperBusy, setHelperBusy] = useState(false);
  const [helperError, setHelperError] = useState<string | null>(null);

  const installHelper = async () => {
    setHelperBusy(true);
    setHelperError(null);
    try {
      await invoke("setup_hosts_helper");
    } catch (e) {
      setHelperError(String(e));
    } finally {
      setHelperBusy(false);
      onChanged();
    }
  };

  return (
    <main className="focus-page">
      <Hero status={status} />

      {!status.hostsHelperInstalled && (
        <section className="card warn">
          <b>One-time setup</b>
          <p className="muted">
            Approve once. From then on, blocking works system-wide, silently.
          </p>
          <button
            className="cta-dark"
            disabled={helperBusy}
            onClick={installHelper}
          >
            {helperBusy ? "Installing…" : "Enable website blocking"}
          </button>
          {helperError && <p className="error">{helperError}</p>}
        </section>
      )}

      <SessionCard status={status} onChanged={() => onChanged()} />
    </main>
  );
}

function SyncCard({
  status,
  onChanged,
}: {
  status: EngineStatus;
  onChanged: () => void;
}) {
  const [login, setLogin] = useState<DeviceCodeInfo | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const connect = async () => {
    setLoginBusy(true);
    setLoginError(null);
    try {
      const i = await invoke<DeviceCodeInfo>("login_start");
      setLogin(i);
      await openUrl(i.verificationUriComplete);
      await invoke("login_poll", { info: i });
      setLogin(null);
      onChanged();
    } catch (e) {
      setLoginError(String(e));
      setLogin(null);
    } finally {
      setLoginBusy(false);
    }
  };

  if (status.authenticated) {
    return (
      <section className="card">
        <div className="row">
          <span className="muted">Account</span>
          <span>{status.userName ?? status.userEmail ?? "connected"}</span>
        </div>
        {status.lastSyncError && <p className="error">{status.lastSyncError}</p>}
        <button
          className="ghost small"
          onClick={async () => {
            await invoke("logout");
            onChanged();
          }}
        >
          Sign out
        </button>
      </section>
    );
  }

  if (!status.configured) {
    return (
      <section className="card">
        <div className="row">
          <b>Your phone</b>
          <span className="small-text">coming soon</span>
        </div>
        <p className="muted small-text">
          Sessions here work forever without an account, and without a server.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <b>Your phone</b>
      <p className="muted">
        Optional: one schedule shared between this computer and your phone.
      </p>
      {login ? (
        <>
          <div className="code small-code">{login.userCode}</div>
          <p className="muted">Confirm the code in your browser…</p>
        </>
      ) : (
        <button className="ghost pill" disabled={loginBusy} onClick={connect}>
          {loginBusy ? "Waiting…" : "Connect account"}
        </button>
      )}
      {loginError && <p className="error">{loginError}</p>}
    </section>
  );
}

function SettingsView({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Settings>(settings);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: keyof Settings, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("save_settings", { settings: form });
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <h2>Settings</h2>
      <label>
        Device name
        <input
          value={form.deviceName}
          onChange={(e) => set("deviceName", e.target.value)}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={form.launchAtLogin}
          onChange={(e) => set("launchAtLogin", e.target.checked)}
        />
        Launch at login
      </label>

      <details>
        <summary className="muted">Advanced - self-hosted server</summary>
        <div className="advanced">
          <label>
            Server URL
            <input
              value={form.apiBaseUrl}
              placeholder="https://block-cloud.vercel.app"
              onChange={(e) => set("apiBaseUrl", e.target.value)}
            />
          </label>
          <label>
            Auth0 domain
            <input
              value={form.auth0Domain}
              placeholder="your-tenant.eu.auth0.com"
              onChange={(e) => set("auth0Domain", e.target.value)}
            />
          </label>
          <label>
            Auth0 client ID
            <input
              value={form.auth0ClientId}
              onChange={(e) => set("auth0ClientId", e.target.value)}
            />
          </label>
          <label>
            Auth0 audience
            <input
              value={form.auth0Audience}
              placeholder="https://block-api"
              onChange={(e) => set("auth0Audience", e.target.value)}
            />
          </label>
        </div>
      </details>

      <div className="actions">
        <button className="primary big" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
