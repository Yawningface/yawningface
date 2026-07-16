import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import packageInfo from "../package.json";
import Insights from "./Insights";
import {
  AndroidIcon,
  AppleIcon,
  BrowserIcon,
  ChromeIcon,
  TerminalIcon,
  WindowsIcon,
} from "./PlatformIcons";
import ScheduleCalendar, { describeSchedulePeriod } from "./ScheduleCalendar";
import { IS_DEV_BUILD } from "./build";
import type {
  Appearance,
  Blocklist,
  BrowserExtensionScan,
  BrowserExtensionStatus,
  DeviceCodeInfo,
  EngineStatus,
  FullState,
  LocalConfigInfo,
  Settings,
} from "./types";

type View = "focus" | "insights" | "schedules" | "devices" | "settings";

const NAV: { id: View; label: string }[] = [
  { id: "focus", label: "Focus" },
  { id: "schedules", label: "Schedules" },
  { id: "insights", label: "Insights" },
  { id: "devices", label: "Devices" },
  { id: "settings", label: "Settings" },
];

const DURATIONS: { label: string; minutes: number | null }[] = [
  { label: "30 min", minutes: 30 },
  { label: "1 h", minutes: 60 },
  { label: "2 h", minutes: 120 },
  { label: "No limit", minutes: null },
];

const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function applyAppearance(appearance: Appearance) {
  document.documentElement.dataset.theme = appearance;
  void getCurrentWindow()
    .setTheme(appearance === "system" ? null : appearance)
    .catch(() => {});
}

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

/** Only ever visible under `tauri dev`. A shipped installer never renders it. */
function DevBadge() {
  if (!IS_DEV_BUILD) return null;
  return (
    <div className="dev-badge" aria-label="Development build">
      DEV BUILD
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

  useEffect(() => {
    applyAppearance(settings?.appearance ?? "system");
  }, [settings?.appearance]);

  if (!settings || !status) return <div className="shell" />;

  const schedulesOn = status.activeLists.filter(
    (l) => l !== "Working session",
  ).length;

  return (
    <div className="shell">
      <DevBadge />
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
        {view === "insights" && <Insights />}
        {view === "schedules" && (
          <section className="page schedules-page">
            <h2>Schedules</h2>
            <p className="page-note">
              See what will be blocked over the next seven days, then adjust the
              routines that make it happen.
            </p>
            {localCfg && (
              <>
                <ScheduledSessionsCard info={localCfg} onChanged={refresh} />
                <ScheduleCalendar lists={localCfg.config.blocklists ?? []} />
              </>
            )}
          </section>
        )}
        {view === "devices" && (
          <section className="page devices-page">
            <h2>Devices</h2>
            <p className="page-note">
              Yawningface wherever you work.
            </p>
            <CompanionsCard status={status} />
            <SyncCard status={status} onChanged={refresh} />
            <AgentAccessCard />
          </section>
        )}
        {view === "settings" && (
          <SettingsView
            settings={settings}
            onSettingsChanged={setSettings}
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
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!status.sessionActive || !status.sessionUntil) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [status.sessionActive, status.sessionUntil]);

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

  const startAt = status.sessionStartedAt
    ? Date.parse(status.sessionStartedAt)
    : Number.NaN;
  const endAt = status.sessionUntil
    ? Date.parse(status.sessionUntil)
    : Number.NaN;
  const totalMs = endAt - startAt;
  const remainingMs = Math.max(0, endAt - clock);
  const progress = Number.isFinite(totalMs) && totalMs > 0
    ? Math.min(100, Math.max(0, ((clock - startAt) / totalMs) * 100))
    : null;

  if (status.sessionActive) {
    return (
      <section className="session-card">
        <div className="session-title">Working session</div>
        {status.sessionUntil && (
          <div className="session-progress">
            <div className="session-progress-label">
              <b>{formatTimeRemaining(remainingMs)} left</b>
              <span>
                ends {new Date(status.sessionUntil).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <div
              className={progress === null ? "session-progress-track starting" : "session-progress-track"}
              role="progressbar"
              aria-label="Working session progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress === null ? undefined : Math.round(progress)}
              aria-valuetext={formatTimeRemaining(remainingMs) + " remaining"}
            >
              <span style={{ width: progress === null ? "0%" : progress.toString() + "%" }} />
            </div>
          </div>
        )}
        {!status.sessionUntil && (
          <p className="session-no-limit">No time limit</p>
        )}
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

const TOUGH_DURATIONS: { label: string; minutes: number }[] = [
  { label: "1 h", minutes: 60 },
  { label: "2 h", minutes: 120 },
  { label: "4 h", minutes: 240 },
  { label: "8 h", minutes: 480 },
];

/** Tough Mode: a root-enforced lock with no early exit. macOS only. */
function ToughModeCard({
  status,
  onChanged,
}: {
  status: EngineStatus;
  onChanged: () => void;
}) {
  const [minutes, setMinutes] = useState(60);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!IS_MAC) return null;

  if (status.toughLockActive) {
    return (
      <section className="card tough on">
        <div className="tough-title">TOUGH MODE</div>
        <p className="muted">
          Websites locked until{" "}
          {status.toughLockUntil
            ? new Date(status.toughLockUntil).toLocaleString([], {
                weekday: "short",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "the timer ends"}
          . There is no way to stop website blocking early — not from here,
          not by quitting, not by deleting the app. App blocking still requires
          yawningface to stay running.
        </p>
      </section>
    );
  }

  const arm = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await invoke("start_tough_mode", { minutes });
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const label =
    TOUGH_DURATIONS.find((d) => d.minutes === minutes)?.label ??
    `${minutes} min`;

  return (
    <section className="card tough">
      <b>Tough Mode</b>
      <p className="muted">
        Lock websites at the system level. No pause, no unlock, no uninstall
        trick — website blocking outlives the app until the timer runs out.
        App blocking still requires yawningface to stay running.
      </p>
      <div className="tough-durations">
        {TOUGH_DURATIONS.map((d) => (
          <button
            key={d.label}
            className={`tough-chip ${minutes === d.minutes ? "selected" : ""}`}
            onClick={() => setMinutes(d.minutes)}
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="actions">
        <button
          className={confirming ? "tough-arm" : "ghost pill"}
          disabled={busy || !status.hostsHelperInstalled}
          onClick={arm}
        >
          {busy
            ? "Locking…"
            : confirming
              ? `Yes, lock me out for ${label} — no way back`
              : "Lock in Tough Mode"}
        </button>
        {confirming && !busy && (
          <button className="ghost" onClick={() => setConfirming(false)}>
            Never mind
          </button>
        )}
      </div>
      {!status.hostsHelperInstalled && (
        <p className="small-text">
          Finish the one-time website-blocking setup first.
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function formatTimeRemaining(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  if (seconds < 60) return seconds + " sec";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return minutes + " min";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? hours + " h " + remainder + " min" : hours + " h";
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
  initial,
  onSave,
  onCancel,
}: {
  initial?: Blocklist;
  onSave: (list: Blocklist) => Promise<void>;
  onCancel: () => void;
}) {
  const initialPeriod = initial?.metadata?.timePeriods?.[0];
  const [name, setName] = useState(initial?.name ?? "");
  const [days, setDays] = useState<string[]>(
    initialPeriod?.schedule ?? ["mon", "tue", "wed", "thu", "fri"],
  );
  const [start, setStart] = useState(initialPeriod?.startTime ?? "09:00");
  const [end, setEnd] = useState(initialPeriod?.endTime ?? "13:00");
  const [websites, setWebsites] = useState(
    (initial?.targets?.websites ?? DEFAULT_WEBSITES).join("\n"),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timing = describeSchedulePeriod({ startTime: start, endTime: end });

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
        ...initial,
        id: initial?.id ?? `local-${Date.now().toString(36)}`,
        name: title,
        metadata: {
          ...initial?.metadata,
          enabled: initial?.metadata?.enabled ?? true,
          devices: initial?.metadata?.devices ?? ["desktop"],
          timePeriods: [
            { ...initialPeriod, startTime: start, endTime: end, schedule: days },
            ...(initial?.metadata?.timePeriods?.slice(1) ?? []),
          ],
        },
        targets: {
          ...initial?.targets,
          websites: sites,
          apps: initial?.targets?.apps ?? [],
        },
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
        <label className="time-field">
          <span>Starts</span>
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <span className="muted time-arrow">→</span>
        <label className="time-field">
          <span>Ends</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <div className={`schedule-timing-preview ${timing.durationMinutes > 16 * 60 ? "long" : ""}`} aria-live="polite">
        <b>{timing.range}</b>
        <span>{timing.detail}</span>
        {timing.durationMinutes > 16 * 60 && (
          <em>This blocks for most of the day. Check AM/PM.</em>
        )}
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
          {busy ? "Saving…" : initial ? "Save changes" : "Save schedule"}
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
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const lists = info.config.blocklists ?? [];
  const enabledCount = lists.filter((list) => list.metadata?.enabled).length;

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

  const update = async (index: number, list: Blocklist) => {
    await saveConfig(lists.map((current, i) => (i === index ? list : current)));
    setEditingIndex(null);
  };

  const toggle = (i: number) =>
    saveConfig(
      lists.map((l, j) =>
        j === i
          ? { ...l, metadata: { ...l.metadata, enabled: !l.metadata?.enabled } }
          : l,
      ),
    );

  const remove = async (i: number) => {
    await saveConfig(lists.filter((_, j) => j !== i));
    setEditingIndex((current) => {
      if (current === null || current < i) return current;
      return current === i ? null : current - 1;
    });
  };

  return (
    <details className="card schedule-manager">
      <summary className="schedule-manager-summary">
        <span className="schedule-manager-title">
          <i aria-hidden="true">›</i>
          <b>Scheduled sessions</b>
        </span>
        <span className="small-text">
          {lists.length === 0
            ? "None yet"
            : `${lists.length} ${lists.length === 1 ? "schedule" : "schedules"} · ${enabledCount} on`}
        </span>
      </summary>
      <div className="schedule-manager-body">
        <div className="schedule-manager-actions">
          {!adding && editingIndex === null && (
            <button
              className="ghost small"
              onClick={() => {
                setEditingIndex(null);
                setAdding(true);
              }}
            >
              + New schedule
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
          const timing = period ? describeSchedulePeriod(period) : null;
          const duration = timing?.detail.split(" · ").pop();
          return (
            <div className="schedule-list-item" key={l.id ?? i}>
              <div className="schedule-row">
                <label className="checkbox schedule-main">
                  <input
                    type="checkbox"
                    checked={!!l.metadata?.enabled}
                    onChange={() => toggle(i)}
                  />
                  <span className="schedule-name">{l.name}</span>
                  <span className="small-text">
                    {period
                      ? `${summarizeDays(period.schedule ?? [])} · ${timing?.range} · ${duration}`
                      : "always on"}
                  </span>
                </label>
                <div className="schedule-row-actions">
                  <button
                    className="ghost small"
                    onClick={() => {
                      setAdding(false);
                      setEditingIndex(editingIndex === i ? null : i);
                    }}
                  >
                    {editingIndex === i ? "Cancel" : "Edit"}
                  </button>
                  <button className="ghost small" onClick={() => remove(i)}>
                    Remove
                  </button>
                </div>
              </div>
              {editingIndex === i && (
                <ScheduleEditor
                  initial={l}
                  onSave={(updated) => update(i, updated)}
                  onCancel={() => setEditingIndex(null)}
                />
              )}
            </div>
          );
        })}
        {adding && <ScheduleEditor onSave={add} onCancel={() => setAdding(false)} />}
      </div>
    </details>
  );
}

const IS_MAC = navigator.userAgent.includes("Mac");
const EXTENSION_URL =
  "https://github.com/Yawningface/yawningface/releases/tag/extension-v0.1.12";

function CompanionsCard({ status }: { status: EngineStatus }) {
  const [extensionScan, setExtensionScan] = useState<BrowserExtensionScan | null>(null);
  const [checkingExtensions, setCheckingExtensions] = useState(true);
  const [extensionScanError, setExtensionScanError] = useState(false);

  const checkExtensions = useCallback(async () => {
    setCheckingExtensions(true);
    setExtensionScanError(false);
    try {
      setExtensionScan(await invoke<BrowserExtensionScan>("get_browser_extensions"));
    } catch {
      setExtensionScanError(true);
    } finally {
      setCheckingExtensions(false);
    }
  }, []);

  useEffect(() => {
    void checkExtensions();
  }, [checkExtensions]);

  return (
    <section className="card device-card">
      <div className="device-card-head">
        <div className="device-heading">
          {IS_MAC ? <AppleIcon /> : <WindowsIcon />}
          <div className="device-title">
            <b>This computer</b>
            <span className="small-text">{status.deviceName}</span>
          </div>
        </div>
        <span className="device-state connected">Installed</span>
      </div>
      <div className="device-browser-section">
        <div className="device-section-head">
          <span className="device-heading compact">
            <ChromeIcon />
            <b>Browser protection</b>
          </span>
          <button className="ghost small" disabled={checkingExtensions} onClick={checkExtensions}>
            {checkingExtensions ? "Checking…" : "Check again"}
          </button>
        </div>
        {extensionScanError && (
          <p className="error small-text">Could not check browser extensions.</p>
        )}
        {!extensionScanError && extensionScan && extensionScan.browsers.length === 0 && (
          <p className="small-text muted">No supported browser found.</p>
        )}
        {extensionScan?.browsers.map((browser) => (
          <BrowserExtensionRow key={browser.id} browser={browser} />
        ))}
      </div>
    </section>
  );
}

function BrowserExtensionRow({ browser }: { browser: BrowserExtensionStatus }) {
  const fullyEnabled = browser.profiles > 0 && browser.enabledProfiles === browser.profiles;
  const partiallyEnabled = browser.enabledProfiles > 0 && !fullyEnabled;
  const installedButDisabled = browser.installedProfiles > 0 && browser.enabledProfiles === 0;

  let status = "Not installed";
  const checkedProfiles = Math.max(1, browser.profiles);
  let detail = `${checkedProfiles} browser profile${checkedProfiles === 1 ? "" : "s"} checked`;
  if (fullyEnabled) {
    status = "Installed";
    detail = browser.profiles === 1 ? "Enabled in this profile" : `Enabled in all ${browser.profiles} profiles`;
  } else if (partiallyEnabled) {
    status = "Some profiles";
    detail = `Enabled in ${browser.enabledProfiles} of ${browser.profiles} profiles`;
  } else if (installedButDisabled) {
    status = "Disabled";
    detail = "Installed, but currently disabled";
  }

  return (
    <div className="browser-extension">
      <div className="browser-row-main">
        {browser.id === "chrome" ? <ChromeIcon /> : <BrowserIcon />}
        <div>
          <span>{browser.name}</span>
          <p className="small-text">{detail}</p>
        </div>
      </div>
      {fullyEnabled ? (
        <span className="extension-state installed">{status}</span>
      ) : (
        <button className="ghost pill" onClick={() => openUrl(EXTENSION_URL)}>
          {status === "Not installed" ? "Install" : "Fix"}
        </button>
      )}
    </div>
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
      {blocking && (
        <div className="protection-live" role="status">
          <span className="protection-dot" aria-hidden="true" />
          Protection active
        </div>
      )}
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
  const blocking =
    status.sessionActive || status.blockedDomains > 0 || status.blockedApps > 0;

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
    <main className={`focus-page ${blocking ? "blocking-active" : ""}`}>
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

      <ToughModeCard status={status} onChanged={onChanged} />
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

  return (
    <section className="card device-card">
      <div className="device-card-head">
        <span className="device-heading">
          <span className="device-platform-marks">
            <AppleIcon />
            <AndroidIcon />
          </span>
          <b>Your phone</b>
        </span>
        <span className={`device-state ${status.authenticated ? "connected" : ""}`}>
          {status.authenticated ? "Connected" : status.configured ? "Not connected" : "Coming soon"}
        </span>
      </div>
      <div className="device-platform-list" aria-label="Phone availability">
        <span><AppleIcon />iPhone <em>soon</em></span>
        <span><AndroidIcon />Android <em>soon</em></span>
      </div>
      {status.authenticated ? (
        <div className="device-account-row">
          <span className="small-text">{status.userName ?? status.userEmail ?? "Account connected"}</span>
          <button
            className="ghost small"
            onClick={async () => {
              await invoke("logout");
              onChanged();
            }}
          >
            Sign out
          </button>
        </div>
      ) : status.configured && login ? (
        <>
          <div className="code small-code">{login.userCode}</div>
          <p className="muted">Confirm the code in your browser…</p>
        </>
      ) : status.configured ? (
        <button className="ghost pill" disabled={loginBusy} onClick={connect}>
          {loginBusy ? "Waiting…" : "Connect account"}
        </button>
      ) : null}
      {status.lastSyncError && <p className="error">{status.lastSyncError}</p>}
      {loginError && <p className="error">{loginError}</p>}
    </section>
  );
}

function AgentAccessCard() {
  return (
    <section className="card device-card">
      <div className="device-card-head">
        <span className="device-heading">
          <TerminalIcon />
          <b>Agents + yf CLI</b>
        </span>
        <span className="device-state">Coming soon</span>
      </div>
      <p className="muted agent-copy">
        The best way to give agents complete control of yawningface is through the <code>yf</code> CLI.
      </p>
    </section>
  );
}

function SettingsView({
  settings,
  onSettingsChanged,
  onSaved,
}: {
  settings: Settings;
  onSettingsChanged: (settings: Settings) => void;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<Settings>(settings);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [appearanceBusy, setAppearanceBusy] = useState(false);

  useEffect(() => {
    applyAppearance(form.appearance);
  }, [form.appearance]);

  const set = (key: keyof Settings, value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  const saveAppearance = async (appearance: Appearance) => {
    const previous = settings.appearance;
    setForm((current) => ({ ...current, appearance }));
    setAppearanceBusy(true);
    setError(null);
    try {
      // Appearance is immediate and has a narrow native command so unfinished
      // edits elsewhere in this form cannot overwrite fresher desktop state.
      const persisted = await invoke<Settings>("save_appearance", { appearance });
      onSettingsChanged(persisted);
    } catch (e) {
      setForm((current) => ({ ...current, appearance: previous }));
      applyAppearance(previous);
      setError(String(e));
    } finally {
      setAppearanceBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("save_settings", { settings: form });
      onSettingsChanged(form);
      await onSaved();
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

      <label>
        Appearance
        <select
          value={form.appearance}
          disabled={appearanceBusy}
          onChange={(e) => void saveAppearance(e.target.value as Appearance)}
        >
          {APPEARANCES.map((appearance) => (
            <option key={appearance.value} value={appearance.value}>
              {appearance.label}
            </option>
          ))}
        </select>
        <span className="small-text">
          System follows your computer’s light or dark appearance.
        </span>
      </label>

      <section className="card settings-about">
        <b>About</b>
        <div className="about-row">
          <span className="muted">Version</span>
          <code>{packageInfo.version}</code>
        </div>
        <div className="about-row">
          <span className="muted">Source</span>
          <button
            className="about-link"
            onClick={() => openUrl("https://github.com/Yawningface/yawningface")}
          >
            github.com/Yawningface/yawningface ↗
          </button>
        </div>
        <div className="about-row">
          <span className="muted">Updates</span>
          <button
            className="about-link"
            onClick={() =>
              openUrl("https://github.com/Yawningface/yawningface/releases/latest")
            }
          >
            Latest release ↗
          </button>
        </div>
        <div className="about-row">
          <span className="muted">License</span>
          <span>MIT</span>
        </div>
      </section>

      <div className="actions">
        <button className="primary big" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
