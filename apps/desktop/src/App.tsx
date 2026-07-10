import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { DeviceCodeInfo, EngineStatus, FullState, Settings } from "./types";

type View = "home" | "settings";

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

function GearIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [view, setView] = useState<View>("home");

  const refresh = useCallback(async () => {
    const state = await invoke<FullState>("get_state");
    setSettings(state.settings);
    setStatus(state.status);
  }, []);

  useEffect(() => {
    refresh();
    const unlisten = listen<EngineStatus>("yf://status", (e) => setStatus(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refresh]);

  if (!settings || !status) return <div className="shell" />;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" /> YawningFace <b>Block</b>
        </div>
        <button
          className={view === "home" ? "ghost gear" : "ghost small"}
          onClick={() => setView(view === "home" ? "settings" : "home")}
        >
          {view === "home" ? <GearIcon /> : "← Back"}
        </button>
      </header>

      {view === "settings" ? (
        <SettingsView
          settings={settings}
          onSaved={async () => {
            await refresh();
            setView("home");
          }}
        />
      ) : (
        <HomeView status={status} onChanged={refresh} />
      )}
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
        Feeds off in every browser — X, Instagram, TikTok, YouTube, Reddit and
        friends. No account needed.
      </p>
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

function HomeView({
  status,
  onChanged,
}: {
  status: EngineStatus;
  onChanged: () => void;
}) {
  const [helperBusy, setHelperBusy] = useState(false);
  const [helperError, setHelperError] = useState<string | null>(null);
  const [login, setLogin] = useState<DeviceCodeInfo | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

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
    <main className="panel">
      <Hero status={status} />

      {!status.hostsHelperInstalled && (
        <section className="card warn">
          <b>One-time setup</b>
          <p className="muted">
            Approve once with your password. From then on, blocking works
            system-wide, silently.
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

      {status.authenticated ? (
        <section className="card">
          <div className="row">
            <span className="muted">Account</span>
            <span>{status.userName ?? status.userEmail ?? "connected"}</span>
          </div>
          <div className="row">
            <span className="muted">Synced schedules</span>
            <span>
              {status.activeLists.filter((l) => l !== "Working session").length >
              0
                ? status.activeLists.filter((l) => l !== "Working session").join(", ")
                : "none active now"}
            </span>
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
      ) : status.configured ? (
        <section className="card">
          <b>Sync across devices</b>
          <p className="muted">
            Optional: one schedule shared between this computer, your phone and
            your friends' leaderboard.
          </p>
          {login ? (
            <>
              <div className="code small-code">{login.userCode}</div>
              <p className="muted">Confirm the code in your browser…</p>
            </>
          ) : (
            <button className="ghost" disabled={loginBusy} onClick={connect}>
              {loginBusy ? "Waiting…" : "Connect account"}
            </button>
          )}
          {loginError && <p className="error">{loginError}</p>}
        </section>
      ) : (
        <section className="card">
          <div className="row">
            <b>Sync across devices</b>
            <span className="small-text">coming soon</span>
          </div>
          <p className="muted small-text">
            Offline sessions work forever, no account, no server.
          </p>
        </section>
      )}

      <p className="hint muted">
        Closing this window keeps blocking active in the{" "}
        {navigator.userAgent.includes("Mac") ? "menu bar" : "system tray"}.
      </p>
    </main>
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
    <main className="panel">
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
        <summary className="muted">Advanced — self-hosted server</summary>
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
