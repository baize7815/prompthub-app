import { useCallback, useEffect, useRef, useState } from "react";
import type { ExportFile } from "./store";

export type BackupFrequency = "daily" | "weekly";

export type AutoBackupSettings = {
  enabled: boolean;
  frequency: BackupFrequency;
  autoDownload: boolean;
  keepCount: number;
  lastBackupAt: number | null;
};

export type BackupSnapshot = {
  id: string;
  createdAt: number;
  promptCount: number;
  categoryCount: number;
  data: ExportFile;
};

const SETTINGS_KEY = "prompthub.autoBackup.settings";
const SNAPSHOTS_KEY = "prompthub.autoBackup.snapshots";
const CHECK_INTERVAL_MS = 60_000;
const MIN_KEEP = 1;
const MAX_KEEP = 20;

export const DEFAULT_AUTO_BACKUP_SETTINGS: AutoBackupSettings = {
  enabled: false,
  frequency: "daily",
  autoDownload: false,
  keepCount: 5,
  lastBackupAt: null,
};

export function frequencyMs(f: BackupFrequency): number {
  return f === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

export function frequencyLabel(f: BackupFrequency): string {
  return f === "weekly" ? "每周" : "每天";
}

function safeStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadAutoBackupSettings(): AutoBackupSettings {
  const ls = safeStorage();
  if (!ls) return { ...DEFAULT_AUTO_BACKUP_SETTINGS };
  try {
    const raw = ls.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_AUTO_BACKUP_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AutoBackupSettings>;
    return {
      enabled: Boolean(parsed.enabled),
      frequency: parsed.frequency === "weekly" ? "weekly" : "daily",
      autoDownload: Boolean(parsed.autoDownload),
      keepCount: clampKeep(parsed.keepCount),
      lastBackupAt:
        typeof parsed.lastBackupAt === "number" ? parsed.lastBackupAt : null,
    };
  } catch {
    return { ...DEFAULT_AUTO_BACKUP_SETTINGS };
  }
}

export function saveAutoBackupSettings(settings: AutoBackupSettings): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* quota or unavailable */
  }
}

export function loadSnapshots(): BackupSnapshot[] {
  const ls = safeStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(SNAPSHOTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BackupSnapshot[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s) =>
        s &&
        typeof s.id === "string" &&
        typeof s.createdAt === "number" &&
        s.data &&
        Array.isArray(s.data.prompts) &&
        Array.isArray(s.data.categories),
    );
  } catch {
    return [];
  }
}

function persistSnapshots(snapshots: BackupSnapshot[]): boolean {
  const ls = safeStorage();
  if (!ls) return false;
  try {
    ls.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
    return true;
  } catch {
    return false;
  }
}

function clampKeep(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 5;
  if (v < MIN_KEEP) return MIN_KEEP;
  if (v > MAX_KEEP) return MAX_KEEP;
  return v;
}

function makeId(): string {
  return `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function fmtTs(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function downloadSnapshotFile(snapshot: BackupSnapshot): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const filename = `prompthub-autobackup-${fmtTs(new Date(snapshot.createdAt))}.json`;
  const blob = new Blob([JSON.stringify(snapshot.data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSnapshot(snapshot: BackupSnapshot): void {
  downloadSnapshotFile(snapshot);
}

type CreateSnapshotOptions = {
  data: ExportFile;
  keepCount: number;
  autoDownload?: boolean;
};

export type CreateSnapshotResult = {
  snapshot: BackupSnapshot | null;
  snapshots: BackupSnapshot[];
  truncated: boolean;
  error: string | null;
};

export function createSnapshot(
  options: CreateSnapshotOptions,
): CreateSnapshotResult {
  const { data, autoDownload } = options;
  const keepCount = clampKeep(options.keepCount);
  if (
    !data ||
    (data.prompts.length === 0 && data.categories.length === 0)
  ) {
    return {
      snapshot: null,
      snapshots: loadSnapshots(),
      truncated: false,
      error: "提示词库为空，已跳过本次备份",
    };
  }

  const snapshot: BackupSnapshot = {
    id: makeId(),
    createdAt: Date.now(),
    promptCount: data.prompts.length,
    categoryCount: data.categories.length,
    data,
  };

  const existing = loadSnapshots();
  let next = [snapshot, ...existing];
  let truncated = false;
  if (next.length > keepCount) {
    truncated = true;
    next = next.slice(0, keepCount);
  }

  let saved = persistSnapshots(next);
  // If quota exceeded, drop oldest snapshots and retry until it fits or only
  // the newest remains.
  while (!saved && next.length > 1) {
    next = next.slice(0, next.length - 1);
    truncated = true;
    saved = persistSnapshots(next);
  }
  if (!saved) {
    return {
      snapshot: null,
      snapshots: existing,
      truncated: false,
      error: "浏览器存储已满，无法保存备份",
    };
  }

  if (autoDownload) {
    try {
      downloadSnapshotFile(snapshot);
    } catch {
      /* ignore download failures */
    }
  }

  return { snapshot, snapshots: next, truncated, error: null };
}

export function deleteSnapshot(id: string): BackupSnapshot[] {
  const next = loadSnapshots().filter((s) => s.id !== id);
  persistSnapshots(next);
  return next;
}

export function clearSnapshots(): void {
  persistSnapshots([]);
}

type AutoBackupApi = {
  settings: AutoBackupSettings;
  snapshots: BackupSnapshot[];
  updateSettings: (patch: Partial<AutoBackupSettings>) => void;
  refreshSnapshots: () => void;
  runBackupNow: () => CreateSnapshotResult;
  removeSnapshot: (id: string) => void;
  clearAllSnapshots: () => void;
};

type UseAutoBackupOptions = {
  isLoaded: boolean;
  exportLibrary: () => ExportFile;
  onBackupCreated?: (result: CreateSnapshotResult) => void;
};

export function useAutoBackup({
  isLoaded,
  exportLibrary,
  onBackupCreated,
}: UseAutoBackupOptions): AutoBackupApi {
  const [settings, setSettings] = useState<AutoBackupSettings>(() =>
    loadAutoBackupSettings(),
  );
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>(() =>
    loadSnapshots(),
  );

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const exportRef = useRef(exportLibrary);
  exportRef.current = exportLibrary;
  const onBackupCreatedRef = useRef(onBackupCreated);
  onBackupCreatedRef.current = onBackupCreated;

  const persistSettings = useCallback((next: AutoBackupSettings) => {
    saveAutoBackupSettings(next);
    setSettings(next);
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<AutoBackupSettings>) => {
      const prev = settingsRef.current;
      const next: AutoBackupSettings = {
        ...prev,
        ...patch,
        keepCount:
          patch.keepCount !== undefined
            ? clampKeep(patch.keepCount)
            : prev.keepCount,
      };
      persistSettings(next);
      // If the retention cap was lowered, prune existing snapshots
      // immediately so the list reflects the new limit predictably.
      if (next.keepCount < prev.keepCount) {
        const current = loadSnapshots();
        if (current.length > next.keepCount) {
          const trimmed = current.slice(0, next.keepCount);
          persistSnapshots(trimmed);
          setSnapshots(trimmed);
        }
      }
    },
    [persistSettings],
  );

  const refreshSnapshots = useCallback(() => {
    setSnapshots(loadSnapshots());
  }, []);

  const runBackupNow = useCallback((): CreateSnapshotResult => {
    const data = exportRef.current();
    const result = createSnapshot({
      data,
      keepCount: settingsRef.current.keepCount,
      autoDownload: settingsRef.current.autoDownload,
    });
    if (result.snapshot) {
      const next: AutoBackupSettings = {
        ...settingsRef.current,
        lastBackupAt: result.snapshot.createdAt,
      };
      persistSettings(next);
      setSnapshots(result.snapshots);
    }
    onBackupCreatedRef.current?.(result);
    return result;
  }, [persistSettings]);

  const removeSnapshot = useCallback((id: string) => {
    setSnapshots(deleteSnapshot(id));
  }, []);

  const clearAllSnapshots = useCallback(() => {
    clearSnapshots();
    setSnapshots([]);
  }, []);

  // Sync settings/snapshots across tabs.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_KEY) {
        setSettings(loadAutoBackupSettings());
      } else if (e.key === SNAPSHOTS_KEY) {
        setSnapshots(loadSnapshots());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Scheduler: check on load, on focus, and on a polling interval.
  useEffect(() => {
    if (!isLoaded) return;

    const tick = () => {
      const s = settingsRef.current;
      if (!s.enabled) return;
      const now = Date.now();
      const due =
        !s.lastBackupAt || now - s.lastBackupAt >= frequencyMs(s.frequency);
      if (!due) return;
      const data = exportRef.current();
      if (data.prompts.length === 0 && data.categories.length === 0) {
        // Nothing to back up yet. Do NOT advance lastBackupAt — otherwise a
        // user who enables auto-backup before adding any prompts would have
        // to wait a full frequency window before the first scheduled
        // snapshot. Re-check on the next tick / focus instead.
        return;
      }
      const result = createSnapshot({
        data,
        keepCount: s.keepCount,
        autoDownload: s.autoDownload,
      });
      if (result.snapshot) {
        persistSettings({ ...s, lastBackupAt: result.snapshot.createdAt });
        setSnapshots(result.snapshots);
        onBackupCreatedRef.current?.(result);
      }
    };

    // Run once shortly after load to catch overdue backups.
    const initial = window.setTimeout(tick, 1500);
    const interval = window.setInterval(tick, CHECK_INTERVAL_MS);
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [isLoaded, persistSettings]);

  return {
    settings,
    snapshots,
    updateSettings,
    refreshSnapshots,
    runBackupNow,
    removeSnapshot,
    clearAllSnapshots,
  };
}
