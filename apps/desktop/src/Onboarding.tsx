import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { EngineStatus, SetupEvent, SetupStepState } from "./types";

/// The three things setup actually does. Nothing here is theatre: each one
/// flips when the backend says it did.
const STEPS: { id: string; title: string; idle: string }[] = [
  {
    id: "approve",
    title: "Approve once",
    idle: "Windows asks for permission a single time.",
  },
  {
    id: "helper",
    title: "Install the blocking helper",
    idle: "A small system task that edits the hosts file for you.",
  },
  {
    id: "apply",
    title: "Apply the blocklist",
    idle: "Feeds go dark in every browser on this computer.",
  },
];

type StepMap = Record<string, { state: SetupStepState; detail: string }>;

function StepRow({
  title,
  state,
  detail,
}: {
  title: string;
  state: SetupStepState;
  detail: string;
}) {
  return (
    <li className={`step ${state}`}>
      <span className="step-mark" aria-hidden="true">
        {state === "done" ? "✓" : state === "failed" ? "!" : ""}
      </span>
      <div className="step-body">
        <span className="step-title">{title}</span>
        <span className="step-detail">{detail}</span>
      </div>
    </li>
  );
}

export default function Onboarding({
  status,
  onDone,
}: {
  status: EngineStatus;
  onDone: () => void;
}) {
  // Blocking already set up (a reinstall, or setup done from the home card):
  // skip straight to the last screen instead of asking for permission again.
  const [page, setPage] = useState<"welcome" | "setup" | "done">(
    status.hostsHelperInstalled ? "done" : "welcome",
  );
  const [steps, setSteps] = useState<StepMap>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const unlisten = listen<SetupEvent>("yf://setup", (e) => {
      const { step, state, detail } = e.payload;
      setSteps((s) => ({ ...s, [step]: { state, detail } }));
      setLog((l) => [...l, detail].slice(-12));
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  const runSetup = useCallback(async () => {
    setBusy(true);
    setError(null);
    setLog([]);
    setSteps({});
    try {
      await invoke("setup_hosts_helper");
      setPage("done");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const finish = async () => {
    await invoke("finish_onboarding");
    onDone();
  };

  const doneCount = STEPS.filter((s) => steps[s.id]?.state === "done").length;

  if (page === "welcome") {
    return (
      <main className="onboarding">
        <div className="onboarding-body">
          <h1 className="wordmark">yawningface</h1>
          <p className="lede">
            The sites that eat your day, gone. One click in the tray, feeds off
            in every browser on this computer.
          </p>
          <p className="small-text">
            No account. Nothing leaves this machine. Setup takes about a minute
            and asks for your permission once.
          </p>
        </div>
        <div className="onboarding-actions">
          <button
            className="primary big"
            onClick={() => {
              setPage("setup");
              runSetup();
            }}
          >
            Set up blocking
          </button>
          <button className="ghost" onClick={finish}>
            Skip for now
          </button>
        </div>
      </main>
    );
  }

  if (page === "setup") {
    return (
      <main className="onboarding">
        <div className="setup-head">
          <h2>Setting up</h2>
          <span className="small-text">
            {doneCount} of {STEPS.length} steps
          </span>
        </div>
        <div className="progress-track">
          <span
            className="progress-fill"
            style={{ width: `${(doneCount / STEPS.length) * 100}%` }}
          />
        </div>

        <ul className="steps">
          {STEPS.map((s) => {
            const live = steps[s.id];
            return (
              <StepRow
                key={s.id}
                title={s.title}
                state={live?.state ?? "idle"}
                detail={live?.detail ?? s.idle}
              />
            );
          })}
        </ul>

        {log.length > 0 && (
          <div className="live-output" ref={logRef}>
            {log.map((line, i) => (
              <div key={i} className="live-line">
                {line}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="setup-error">
            <p className="error">{error}</p>
            <button className="ghost pill" disabled={busy} onClick={runSetup}>
              Try again
            </button>
            <button className="ghost small" onClick={finish}>
              Continue without blocking
            </button>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="onboarding">
      <div className="onboarding-body">
        <div className="done-emoji">😎</div>
        <h2>You're set</h2>
        <p className="lede">
          Click the yawningface icon in your system tray to block for an hour.
          Click it again to stop. It goes yellow while it is blocking.
        </p>
        <p className="small-text">
          Scheduled sessions, your own site list, and the browser extension all
          live inside the app.
        </p>
      </div>
      <div className="onboarding-actions">
        <button className="primary big" onClick={finish}>
          Open yawningface
        </button>
      </div>
    </main>
  );
}
