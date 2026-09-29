// Windows-only Stage 5 QA. The cross-path probe runs first and seeds a disposable
// populated Everia profile under the runner's Windows user.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const installer = path.resolve(
  "installer-output/Everia-v1.0-Setup-win-x64.exe",
);
const portable = path.resolve("release/Everia-win32-x64/Everia.exe");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "everia-installer-"));
const first = path.join(root, "Custom Everia", "App");
const second = path.join(root, "Moved Everia", "App");
const profile = path.join(process.env.APPDATA, "Everia");
const credentialFile = path.join(profile, "provider-credentials.v1.json");
const backupFile = path.join(profile, "backup-config.v1.json");
const port = 9800 + Math.floor(Math.random() * 400);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function run(file, args) {
  const result = spawnSync(file, args, { encoding: "utf8", timeout: 180000 });
  assert.equal(
    result.status,
    0,
    `${file} ${args[0]} failed: ${result.error || result.stderr || result.stdout}`,
  );
  return result.stdout;
}
function powershell(script) {
  return run("pwsh", ["-NoProfile", "-Command", script]).trim();
}
function registration() {
  const rows = powershell(
    `Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Everia 1.0.0' } | Select-Object DisplayName,DisplayVersion,UninstallString | ConvertTo-Json -Compress`,
  );
  return rows ? JSON.parse(rows) : null;
}
function shortcut(name) {
  const escaped = name.replace(/'/g, "''");
  const result = powershell(
    `$file='${escaped}'; if (Test-Path $file) { $s=(New-Object -ComObject WScript.Shell).CreateShortcut($file); $s.TargetPath }`,
  );
  return result || null;
}
function assertInstall(directory) {
  const exe = path.join(directory, "Everia.exe");
  assert(fs.existsSync(exe), `Installed executable missing at ${exe}`);
  const metadata = JSON.parse(
    powershell(
      `$v=(Get-Item '${exe.replace(/'/g, "''")}').VersionInfo; [ordered]@{ProductName=$v.ProductName;ProductVersion=$v.ProductVersion;FileDescription=$v.FileDescription} | ConvertTo-Json -Compress`,
    ),
  );
  assert.equal(metadata.ProductName, "Everia");
  assert(metadata.ProductVersion.startsWith("1.0.0"));
  assert.equal(registration()?.DisplayName, "Everia 1.0.0");
  assert.equal(registration()?.DisplayVersion, "1.0.0");
  const uninstall = path.join(directory, "Uninstall Everia.exe");
  assert(fs.existsSync(uninstall), "Installed uninstaller missing");
  assert(
    registration()
      .UninstallString?.toLowerCase()
      .includes(uninstall.toLowerCase()),
    `Installed Apps points to the wrong uninstaller: ${registration().UninstallString}`,
  );
  const menu = path.join(
    process.env.APPDATA,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Everia.lnk",
  );
  const desktop = path.join(os.homedir(), "Desktop", "Everia.lnk");
  const menuTarget = shortcut(menu);
  const desktopTarget = shortcut(desktop);
  assert(menuTarget, `Start Menu shortcut missing at ${menu}`);
  assert(desktopTarget, `Desktop shortcut missing at ${desktop}`);
  const canonical = (file) => fs.realpathSync.native(file).toLowerCase();
  assert.equal(canonical(menuTarget), canonical(exe), "Start Menu target");
  assert.equal(canonical(desktopTarget), canonical(exe), "Desktop target");
  return exe;
}

async function inspect(exe, seedSettings = false) {
  const child = spawn(exe, [`--remote-debugging-port=${port}`], {
    stdio: "ignore",
  });
  let socket;
  try {
    let target;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null)
        throw new Error("Everia exited during startup");
      try {
        const pages = await (
          await fetch(`http://127.0.0.1:${port}/json/list`)
        ).json();
        target = pages.find(
          (page) => page.type === "page" && page.url.startsWith("file:"),
        );
        if (target) break;
      } catch {}
      await delay(250);
    }
    assert(target, "Everia did not load a renderer");
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    const evaluate = (expression) =>
      new Promise((resolve, reject) => {
        const id = Math.floor(Math.random() * 1000000000);
        const timer = setTimeout(
          () => finish(new Error("CDP evaluation timed out")),
          10000,
        );
        const finish = (error, value) => {
          clearTimeout(timer);
          socket.removeEventListener("message", listener);
          socket.removeEventListener("close", closed);
          error ? reject(error) : resolve(value);
        };
        const closed = () =>
          finish(new Error("CDP target closed during evaluation"));
        const listener = (event) => {
          const response = JSON.parse(event.data);
          if (response.id !== id) return;
          response.error || response.result?.exceptionDetails
            ? finish(new Error(JSON.stringify(response)))
            : finish(null, response.result.result.value);
        };
        socket.addEventListener("message", listener);
        socket.addEventListener("close", closed);
        socket.send(
          JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: { expression, awaitPromise: true, returnByValue: true },
          }),
        );
      });
    for (let i = 0; i < 80; i++) {
      if (
        await evaluate(
          "!!document.documentElement && !!document.querySelector('.category-card')",
        )
      )
        break;
      await delay(100);
      if (i === 79) throw new Error("Everia renderer never became ready");
    }
    if (seedSettings) {
      await evaluate(
        `localStorage.setItem('everia.locale.v1', '"ar"'); localStorage.setItem('everia.interface-scale.v1', '1.25'); true`,
      );
      // The fixture uses the normal close path: a forced kill immediately after
      // localStorage.setItem can precede Chromium's durable storage flush.
      socket.send(
        JSON.stringify({
          id: 0,
          method: "Runtime.evaluate",
          params: { expression: "window.close()" },
        }),
      );
      for (let attempt = 0; attempt < 40 && child.exitCode === null; attempt++)
        await delay(100);
      assert.notEqual(
        child.exitCode,
        null,
        "Seeded portable app did not close normally",
      );
      return;
    }
    const snapshot = await evaluate(`(async () => {
      const keys = ['everia.items.v1','everia.theme.v1','everia.sort.v1','everia.views.v1','everia.locale.v1','everia.interface-scale.v1'];
      const values = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('everia-assets', 2);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const asset = (store, id) => new Promise((resolve, reject) => {
        const request = db.transaction(store).objectStore(store).get(id);
        request.onsuccess = async () => resolve(request.result ? Array.from(new Uint8Array(await request.result.arrayBuffer())) : null);
        request.onerror = () => reject(request.error);
      });
      const cover = await asset('covers', 'local-cover:origin');
      const wallpaper = await asset('wallpapers', 'local-wallpaper:origin');
      db.close();
      return { values, cover, wallpaper, lang: document.documentElement.lang, dir: document.documentElement.dir };
    })()`);
    assert.equal(JSON.parse(snapshot.values["everia.items.v1"]).length, 2);
    assert(
      snapshot.cover?.length && snapshot.wallpaper?.length,
      "Referenced artwork missing",
    );
    assert.equal(snapshot.lang, "ar");
    assert.equal(snapshot.dir, "rtl");
    return snapshot;
  } finally {
    socket?.close();
    if (child.exitCode === null) child.kill();
    await delay(1000);
  }
}

(async () => {
  assert(fs.existsSync(installer));
  assert(fs.existsSync(portable));
  assert(
    fs.existsSync(credentialFile),
    "Seeded same-user credential file missing",
  );
  const credentialHash = hash(credentialFile);
  const destination = path.join(root, "Backups on second drive fixture");
  fs.mkdirSync(destination);
  const config = {
    version: 1,
    enabled: true,
    destination,
    destinationSelected: true,
    lastSuccess: new Date().toISOString(),
    lastFailure: null,
  };
  fs.writeFileSync(backupFile, JSON.stringify(config));
  const backupHash = hash(backupFile);
  await inspect(portable, true);
  const seed = await inspect(portable);
  assert.equal(seed.values["everia.locale.v1"], '"ar"');
  assert.equal(seed.values["everia.interface-scale.v1"], "1.25");
  run(installer, ["/S", "/currentuser", `/D=${first}`]);
  const installed = assertInstall(first);
  assert.deepEqual(
    await inspect(installed),
    seed,
    "Installed app did not see portable profile",
  );
  run(installer, ["/S", "/currentuser", `/D=${first}`]);
  assert.deepEqual(
    await inspect(assertInstall(first)),
    seed,
    "Installer rerun lost personal state",
  );
  run(installer, ["/S", "/currentuser", `/D=${second}`]);
  assert.deepEqual(
    await inspect(assertInstall(second)),
    seed,
    "Install-location change lost personal state",
  );
  assert.equal(
    hash(credentialFile),
    credentialHash,
    "Credentials changed during installation",
  );
  run(require("electron"), [path.resolve("scripts/profile-verification.cjs")]);
  assert.equal(
    hash(backupFile),
    backupHash,
    "Backup configuration changed during installation",
  );
  run(path.join(second, "Uninstall Everia.exe"), ["/S", "/currentuser"]);
  assert(
    !fs.existsSync(path.join(second, "Everia.exe")),
    "Uninstall retained executable",
  );
  assert.equal(registration(), null, "Uninstall registration remained");
  assert.equal(
    shortcut(
      path.join(
        process.env.APPDATA,
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "Everia.lnk",
      ),
    ),
    null,
    "Uninstall retained Start Menu shortcut",
  );
  assert.equal(
    shortcut(path.join(os.homedir(), "Desktop", "Everia.lnk")),
    null,
    "Uninstall retained Desktop shortcut",
  );
  assert(fs.existsSync(profile), "Uninstall removed the personal profile");
  assert.equal(hash(credentialFile), credentialHash);
  run(require("electron"), [path.resolve("scripts/profile-verification.cjs")]);
  assert.equal(hash(backupFile), backupHash);
  run(installer, ["/S", "/currentuser", `/D=${first}`]);
  assert.deepEqual(
    await inspect(assertInstall(first)),
    seed,
    "Reinstall lost personal state",
  );
  assert.deepEqual(
    await inspect(portable),
    seed,
    "Portable coexistence lost shared profile",
  );
  assert.equal(hash(credentialFile), credentialHash);
  assert.equal(hash(backupFile), backupHash);
  const result = {
    sourceCommit: process.env.SOURCE_SHA,
    installerSha256: hash(installer),
    installerBytes: fs.statSync(installer).size,
    installedExeSha256: hash(path.join(first, "Everia.exe")),
    customLocation: first,
    changedLocation: second,
    profile,
    profilePreserved: true,
    credentialsPreserved: true,
    backupConfigurationPreserved: true,
    startMenuShortcut: true,
    desktopShortcut: true,
  };
  fs.mkdirSync("verification", { recursive: true });
  fs.writeFileSync(
    "verification/installer-lifecycle.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
