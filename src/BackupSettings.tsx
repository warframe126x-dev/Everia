import { HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { backUpNow, backupMessageKey } from "./backup";
import { useLocalization } from "./localization/Localization";
import type { StringKey } from "./localization/format";
import type { SettingsDraft } from "./settingsDraft";

type BackupStatus = {
  destination: string;
  lastSuccess: string | null;
  lastFailure: { at: string; message: string } | null;
};

export function BackupSettings({
  draft,
  onChange,
  committed,
  systemDrive,
  onRestore,
  restoreError,
}: {
  draft: SettingsDraft;
  onChange: (next: SettingsDraft) => void;
  committed: BackupStatus | null;
  systemDrive: string;
  onRestore: () => void;
  restoreError: StringKey | "";
}) {
  const { t, date } = useLocalization();
  const [status, setStatus] = useState<BackupStatus | null>(committed);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ key: StringKey; path?: string }>();
  useEffect(() => setStatus(committed), [committed]);
  const root = (path: string) =>
    /^[A-Za-z]:[\\/]/.test(path) ? path.slice(0, 2).toLowerCase() : "";
  const sameDrive = Boolean(
    draft.backupDestination &&
    systemDrive &&
    root(draft.backupDestination) &&
    root(draft.backupDestination) === root(systemDrive),
  );
  const chooseDestination = async () => {
    try {
      const selected = await window.everiaBackup?.chooseDestination();
      if (selected) onChange({ ...draft, backupDestination: selected });
    } catch {
      setNotice({ key: "backup.failure" });
    }
  };
  const create = async () => {
    setBusy(true);
    setNotice(undefined);
    try {
      const path = await backUpNow();
      setNotice({ key: "backup.success", path });
      const refreshed = await window.everiaBackup?.config();
      if (refreshed) setStatus(refreshed);
    } catch (error) {
      setNotice({ key: backupMessageKey(error) });
    } finally {
      setBusy(false);
    }
  };
  const last = status?.lastSuccess ? new Date(status.lastSuccess) : null;
  const next = last ? new Date(last.getTime() + 24 * 60 * 60 * 1000) : null;
  return (
    <section className="settings-card" id="backup-restore">
      <div className="settings-icon">
        <HardDrive />
      </div>
      <div className="settings-content">
        <h2>{t("backup.heading")}</h2>
        <p>{t("backup.description")}</p>
        <label className="backup-toggle">
          <input
            type="checkbox"
            checked={draft.backupEnabled ?? false}
            disabled={draft.backupEnabled === null}
            onChange={(event) =>
              onChange({ ...draft, backupEnabled: event.target.checked })
            }
          />
          {t("backup.automatic")}
        </label>
        <p>
          {t("backup.frequency")}: {t("backup.daily")}
        </p>
        <div className="backup-location">
          <span>{t("backup.location")}</span>
          <code dir="ltr">
            {draft.backupDestination ?? t("backup.unavailable")}
          </code>
          <button
            className="secondary"
            onClick={() => void chooseDestination()}
            disabled={!window.everiaBackup}
          >
            {t("backup.chooseLocation")}
          </button>
        </div>
        {sameDrive && (
          <p className="backup-drive-warning" role="note">
            {t("backup.sameDriveWarning")}
          </p>
        )}
        <p>
          {t("backup.lastSuccess")}:{" "}
          {last
            ? date(last, { dateStyle: "medium", timeStyle: "short" })
            : t("backup.never")}
        </p>
        <p>
          {t("backup.nextEligible")}:{" "}
          {next
            ? t("backup.onUseAfter", {
                date: date(next, { dateStyle: "medium", timeStyle: "short" }),
              })
            : t("backup.onNextUse")}
        </p>
        {status?.lastFailure && (
          <p>
            {t("backup.lastFailure")}:{" "}
            {date(new Date(status.lastFailure.at), {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        )}
        <p>{t("backup.retention")}</p>
        {draft.backupDestination !== status?.destination && (
          <p>{t("backup.usesCommittedLocation")}</p>
        )}
        <div className="backup-actions">
          <button
            className="secondary"
            disabled={busy || !window.everiaBackup}
            onClick={() => void create()}
          >
            {busy ? t("backup.creating") : t("backup.backUpNow")}
          </button>
          <button
            className="secondary"
            disabled={busy || !window.everiaBackup}
            onClick={onRestore}
          >
            {t("backup.restore")}
          </button>
        </div>
        {notice && (
          <p role="status">
            {t(notice.key)}{" "}
            {notice.path && <code dir="ltr">{notice.path}</code>}
          </p>
        )}
        {restoreError && <p role="alert">{t(restoreError)}</p>}
        <p>{t("backup.credentialsExcluded")}</p>
      </div>
    </section>
  );
}
