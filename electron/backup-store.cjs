const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const MAX_FILE = 128 * 1024 * 1024;
const FILE_NAME = /^Everia-\d{8}T\d{6}Z-[0-9a-f-]{36}\.everiabackup$/;
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
function verify(file) {
  if (typeof file !== "string" || Buffer.byteLength(file) > MAX_FILE) throw new Error("Backup exceeds the size limit.");
  let parsed;
  try { parsed = JSON.parse(file); } catch { throw new Error("Backup is corrupt or truncated."); }
  const { manifest, data, assets } = parsed ?? {};
  if (!parsed || Object.keys(parsed).sort().join() !== "assets,data,manifest" ||
      !manifest || manifest.format !== "EveriaBackup" || manifest.schema !== 1 ||
      typeof manifest.createdAt !== "string" || Number.isNaN(Date.parse(manifest.createdAt)) ||
      typeof manifest.appVersion !== "string" || manifest.appVersion.length > 40 ||
      !data || !Array.isArray(data.items) || !Array.isArray(assets) ||
      assets.length > 2000 || data.items.length > 10000 ||
      manifest.recordCount !== data.items.length || manifest.assetCount !== assets.length ||
      !Array.isArray(manifest.assets) || manifest.assets.length !== assets.length ||
      manifest.payloadSha256 !== digest(JSON.stringify({ data, assets })))
    throw new Error("Backup manifest or integrity is invalid.");
  const seen = new Set();
  let size = 0;
  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    if (!asset || !["covers", "wallpapers"].includes(asset.store) ||
        typeof asset.id !== "string" || !/^local-(cover|wallpaper):[A-Za-z0-9_-]+$/.test(asset.id) ||
        !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 ||
        asset.bytes > (asset.store === "covers" ? 10 : 30) * 1024 * 1024 ||
        seen.has(`${asset.store}/${asset.id}`)) throw new Error("Invalid or duplicate backup asset.");
    seen.add(`${asset.store}/${asset.id}`);
    size += asset.bytes;
    if (size > 96 * 1024 * 1024 || typeof asset.base64 !== "string" ||
        asset.base64.length > Math.ceil(asset.bytes / 3) * 4 + 4) throw new Error("Backup assets exceed size limit.");
    const bytes = Buffer.from(asset.base64, "base64");
    if (bytes.length !== asset.bytes || bytes.toString("base64") !== asset.base64 ||
        asset.sha256 !== digest(bytes) ||
        JSON.stringify(manifest.assets[i]) !== JSON.stringify({store: asset.store, id: asset.id, bytes: asset.bytes, sha256: asset.sha256}))
      throw new Error("Backup asset integrity mismatch.");
  }
  return parsed;
}
function writeAtomic(file, contents) {
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, contents, { flag: "wx", mode: 0o600 });
    const descriptor = fs.openSync(temp, "r");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(temp, file);
  } finally { try { fs.unlinkSync(temp); } catch {} }
}
function readBounded(file) {
  if (fs.statSync(file).size > MAX_FILE) throw new Error("Backup exceeds the size limit.");
  return fs.readFileSync(file, "utf8");
}
function readConfig(file, defaultDestination) {
  if (!fs.existsSync(file)) return { version: 1, enabled: true, destination: defaultDestination, destinationSelected: false, lastSuccess: null, lastFailure: null };
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (value.version !== 1 || typeof value.enabled !== "boolean" ||
      typeof value.destination !== "string" || !path.isAbsolute(value.destination) ||
      typeof value.destinationSelected !== "boolean" ||
      (value.lastSuccess !== null && (typeof value.lastSuccess !== "string" || Number.isNaN(Date.parse(value.lastSuccess)))) ||
      (value.lastFailure !== undefined && value.lastFailure !== null &&
       (typeof value.lastFailure.at !== "string" || typeof value.lastFailure.message !== "string")))
    throw new Error("Backup configuration is damaged; it was not overwritten.");
  return value;
}
function bucket(date, type) {
  const day = date.toISOString().slice(0, 10);
  if (type === "daily") return day;
  if (type === "monthly") return day.slice(0, 7);
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
  const year = thursday.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 1));
  return `${year}-${Math.ceil(((thursday - first) / 86400000 + 1) / 7)}`;
}
function retention(files) {
  const sorted = [...files].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const keep = new Set(sorted[0] ? [sorted[0].path] : []);
  for (const [type, limit] of [["daily", 7], ["weekly", 4], ["monthly", 6]]) {
    const used = new Set();
    for (const file of sorted) {
      const key = bucket(new Date(file.createdAt), type);
      if (!used.has(key) && used.size < limit) { used.add(key); keep.add(file.path); }
    }
  }
  return keep;
}
function createBackupStore(userData, defaultDestination = path.join(os.homedir(), "Documents", "Everia Backups")) {
  const configPath = path.join(userData, "backup-config.v1.json");
  const journalPath = path.join(userData, "restore-journal.v1.json");
  const config = () => readConfig(configPath, defaultDestination);
  function setConfig(next) {
    const current = config();
    if (next.destination !== undefined && (typeof next.destination !== "string" || !path.isAbsolute(next.destination)))
      throw new Error("Choose an absolute backup folder.");
    if (next.enabled !== undefined && typeof next.enabled !== "boolean") throw new Error("Invalid backup setting.");
    const value = { ...current, ...next, destinationSelected: next.destination !== undefined ? true : current.destinationSelected };
    writeAtomic(configPath, JSON.stringify(value));
    return value;
  }
  function listManaged(destination) {
    return fs.readdirSync(destination).filter((name) => FILE_NAME.test(name)).flatMap((name) => {
      const file = path.join(destination, name);
      try {
        if (!fs.statSync(file).isFile()) return [];
        const doc = verify(readBounded(file));
        return [{ path: file, createdAt: doc.manifest.createdAt }];
      } catch { return []; } // Never delete a file we cannot positively validate.
    });
  }
  function writeUnchecked(file) {
    const parsed = verify(file);
    const current = config();
    const destination = current.destination;
    if (!current.destinationSelected && destination === defaultDestination)
      fs.mkdirSync(destination, { recursive: true });
    // A selected external drive that is missing must not trigger a fallback or mkdir.
    if (!fs.existsSync(destination) || !fs.statSync(destination).isDirectory())
      throw new Error("Backup destination is unavailable.");
    const stamp = new Date(parsed.manifest.createdAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const filename = `Everia-${stamp}-${crypto.randomUUID()}.everiabackup`;
    const final = path.join(destination, filename);
    const stage = `${final}.staging`;
    try {
      fs.writeFileSync(stage, file, { flag: "wx", mode: 0o600 });
      const fd = fs.openSync(stage, "r");
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      verify(readBounded(stage));
      fs.renameSync(stage, final);
      verify(readBounded(final));
      setConfig({ lastSuccess: new Date().toISOString(), lastFailure: null });
      const managed = listManaged(destination);
      const keep = retention(managed);
      for (const old of managed) if (!keep.has(old.path)) {
        try { fs.unlinkSync(old.path); } catch {} // A cleanup failure cannot invalidate the backup.
      }
      return final;
    } finally { try { fs.unlinkSync(stage); } catch {} }
  }
  function write(file) {
    try { return writeUnchecked(file); }
    catch (error) {
      try { setConfig({ lastFailure: { at: new Date().toISOString(), message: error instanceof Error ? error.message : "Backup failed." } }); }
      catch {} // The original failure remains the cause; never rewrite a damaged configuration.
      throw error;
    }
  }
  function beginRestore(pending) {
    if (fs.existsSync(journalPath)) throw new Error("An interrupted restore must be recovered first.");
    verify(pending?.backup);
    if (!Array.isArray(pending.raw) || pending.raw.length !== 4 ||
        !pending.raw.every((v) => v === null || typeof v === "string") ||
        Buffer.byteLength(JSON.stringify(pending.raw)) > MAX_FILE) throw new Error("Invalid recovery snapshot.");
    writeAtomic(journalPath, JSON.stringify(pending));
    return true;
  }
  return {
    config, setConfig, write, retention, listManaged,
    isDue: () => { const value = config(); return value.enabled &&
      (!value.lastSuccess || Date.now() - Date.parse(value.lastSuccess) >= 24 * 3600 * 1000); },
    read: (file) => { const contents = readBounded(file); verify(contents); return contents; },
    beginRestore,
    pendingRestore: () => fs.existsSync(journalPath) ? JSON.parse(readBounded(journalPath)) : null,
    finishRestore: () => fs.unlinkSync(journalPath),
  };
}
module.exports = { createBackupStore, verify, retention, writeAtomic };
