export interface Settings {
  apiBaseUrl: string;
  auth0Domain: string;
  auth0ClientId: string;
  auth0Audience: string;
  deviceId: string | null;
  deviceName: string;
  launchAtLogin: boolean;
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
