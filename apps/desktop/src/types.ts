export interface Settings {
  apiBaseUrl: string;
  auth0Domain: string;
  auth0ClientId: string;
  auth0Audience: string;
  deviceId: string | null;
  deviceName: string;
  launchAtLogin: boolean;
  onboarded: boolean;
}

export interface DayStat {
  focusSeconds: number;
  sessions: number;
  appsBlocked: number;
  cancellations: number;
}

export interface ActivitySpan {
  start: string;
  end: string;
  working: boolean;
  scheduled: boolean;
}

export interface Cancellation {
  occurredAt: string;
  source: "working" | "scheduled" | string;
}

/** On-device history. Written by the engine, never uploaded. */
export interface Stats {
  days: Record<string, DayStat>;
  blockedApps: Record<string, number>;
  longestFocusSeconds: number;
  currentFocusSeconds: number;
  activity: ActivitySpan[];
  cancellations: Cancellation[];
}

export type SetupStepState = "idle" | "running" | "done" | "failed";

export interface SetupEvent {
  step: string;
  state: SetupStepState;
  detail: string;
}

export interface EngineStatus {
  configured: boolean;
  authenticated: boolean;
  userName: string | null;
  userEmail: string | null;
  deviceName: string;
  lastSync: string | null;
  lastSyncError: string | null;
  activeLists: string[];
  blockedDomains: number;
  blockedApps: number;
  hostsHelperInstalled: boolean;
  hostsInSync: boolean;
  sessionActive: boolean;
  sessionUntil: string | null;
}

export interface TimePeriod {
  startTime: string;
  endTime: string;
  schedule: string[];
}

export interface Blocklist {
  id: string;
  name: string;
  metadata: {
    enabled: boolean;
    devices?: string[];
    timePeriods: TimePeriod[];
  };
  targets: {
    websites: string[];
    apps: string[];
  };
}

/** Canonical config document (shared with the yf CLI). Extra fields written
    by other tools are preserved verbatim. */
export interface LocalConfig {
  version: number;
  blocklists: Blocklist[];
  [key: string]: unknown;
}

export interface LocalConfigInfo {
  path: string;
  config: LocalConfig;
}

export interface FullState {
  settings: Settings;
  status: EngineStatus;
}

export interface DeviceCodeInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}
