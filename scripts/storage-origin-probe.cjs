const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "everia-origin-"));
const profileBase = process.env.APPDATA;
const profile = path.join(profileBase, "Everia");
const packageDir = path.resolve("release/Everia-win32-x64");
const destinations = [
  ["original-portable", path.join(root, "original-portable")],
  ["second-portable", path.join(root, "second-portable")],
  ["default-installed", path.join(root, "Programs", "Everia")],
  ["custom-installed", path.join(root, "Custom", "Everia", "App")],
];
const port = 9400 + Math.floor(Math.random() * 500);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let active;
let socket;
let nextId = 0;
const pending = new Map();

async function connect() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((target) => target.type === "page" && target.url.startsWith("file:"));
      if (!page) { await delay(500); continue; }
      socket = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve, { once: true });
        socket.addEventListener("error", reject, { once: true });
      });
      socket.addEventListener("message", (event) => {
        const response = JSON.parse(event.data);
        const waiter = pending.get(response.id);
        if (waiter) {
          pending.delete(response.id);
          response.error ? waiter.reject(new Error(JSON.stringify(response.error))) : waiter.resolve(response.result);
        }
      });
      return page.url;
    } catch { await delay(500); }
  }
  throw new Error("Packaged app did not expose a file: renderer on CDP");
}
function command(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await command("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function launch(label, directory) {
  fs.cpSync(packageDir, directory, { recursive: true });
  active = spawn(path.join(directory, "Everia.exe"), [`--remote-debugging-port=${port}`], {
    env: { ...process.env }, stdio: "ignore",
  });
  const url = await connect();
  console.log(JSON.stringify({ path: label, url, pid: active.pid }));
}
async function stop() {
  socket?.close();
  socket = undefined;
  for (const [, waiter] of pending) waiter.reject(new Error("Window closed"));
  pending.clear();
  if (active) {
    active.kill();
    await delay(1800);
    active = undefined;
  }
}
const seed = `(async () => {
  const items = [
    { id:"origin-game", title:"Origin Game", category:"games", status:"In progress",
      rating:8, notes:"A note", favorite:true, dateAdded:"2026-09-24",
      coverUrl:"local-cover:origin", providerReference:{provider:"igdb",providerId:"123",importedAt:"2026-09-24"} },
    { id:"origin-manga", title:"Origin Manga", category:"manga", status:"Completed",
      rating:9, notes:"Another note", favorite:false, dateAdded:"2026-09-24",
      providerMetadata:{volumes:12, chapters:80} }
  ];
  localStorage.setItem("everia.items.v1", JSON.stringify(items));
  localStorage.setItem("everia.theme.v1", JSON.stringify({
    accent:"#00ff00",background:"#081016",text:"#edf3f7",backgroundMode:"custom",
    customWallpaperId:"local-wallpaper:origin",imageFit:"contain",backgroundDimming:35
  }));
  localStorage.setItem("everia.sort.v1", JSON.stringify({games:"rating",manga:"title"}));
  localStorage.setItem("everia.views.v1", JSON.stringify({games:"list",manga:"grid"}));
  const db = await new Promise((resolve,reject) => {
    const request = indexedDB.open("everia-assets",2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("covers")) request.result.createObjectStore("covers");
      if (!request.result.objectStoreNames.contains("wallpapers")) request.result.createObjectStore("wallpapers");
    };
    request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
  });
  async function put(store,id,bytes) {
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(store,"readwrite");
      tx.objectStore(store).put(new Blob([new Uint8Array(bytes)],{type:"image/png"}),id);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
  }
  await put("covers","local-cover:origin",[137,80,78,71,1,2,3,4]);
  await put("wallpapers","local-wallpaper:origin",[137,80,78,71,5,6,7,8]);
  db.close();
  return { items: items.length, origin: location.href };
})()`;
const read = `(async () => {
  const keys=["everia.items.v1","everia.theme.v1","everia.sort.v1","everia.views.v1"];
  const values=Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)]));
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open("everia-assets",2);
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  const get=(store,id)=>new Promise((resolve,reject)=>{
    const request=db.transaction(store).objectStore(store).get(id);
    request.onsuccess=async()=>resolve(request.result?Array.from(new Uint8Array(await request.result.arrayBuffer())):null);
    request.onerror=()=>reject(request.error);
  });
  const cover=await get("covers","local-cover:origin");
  const wallpaper=await get("wallpapers","local-wallpaper:origin");
  db.close();
  return { url:location.href,values,cover,wallpaper,renderedEntries:document.body.innerText.includes("Origin Game") };
})()`;
(async () => {
  try {
    const observations = [];
    let legacyUrl;
    for (let i = 0; i < destinations.length; i++) {
      const [label, directory] = destinations[i];
      await launch(label, directory);
      if (i === 0) {
        legacyUrl = (await evaluate("location.href"));
        console.log("seed", JSON.stringify(await evaluate(seed)));
        console.log("credential save response", JSON.stringify(await evaluate(`window.everiaProviders.saveCredentials({provider:"tmdb",credentials:{token:"fixture-secret"}})`)));
        // The credential save occurs before the network connection test.
        await delay(1000);
      }
      await command("Page.reload");
      await delay(1200);
      await evaluate(`document.querySelector(".category-card")?.click()`);
      await delay(200);
      const result = await evaluate(read);
      observations.push({ label, ...result });
      if (i > 0) {
        for (const securityOrigin of [legacyUrl, new URL(legacyUrl).origin, 'file://']) {
          try {
            const found = await command('DOMStorage.getDOMStorageItems', { storageId: { securityOrigin, isLocalStorage: true } });
            console.log('legacy CDP lookup', JSON.stringify({ label, securityOrigin, entries: found.entries }));
          } catch (error) { console.log('legacy CDP lookup error', JSON.stringify({ securityOrigin, error: String(error) })); }
        }
      }
      console.log("observation", JSON.stringify(observations.at(-1)));
      await stop();
      if (i === 0) {
        const recovery = spawnSync(require("electron"), [
          path.resolve("scripts/legacy-origin-recovery-probe.cjs"), legacyUrl
        ], { encoding: "utf8", timeout: 20000 });
        console.log("virtual recovery", JSON.stringify({
          status: recovery.status, stdout: recovery.stdout, stderr: recovery.stderr
        }));
        console.log("profile location", profile, "exists", fs.existsSync(profile));
        const credentials = fs.readFileSync(path.join(profile,"provider-credentials.v1.json"),"utf8");
        assert(!credentials.includes("fixture-secret"), "Plaintext credential leaked");
        fs.writeFileSync(path.join(profile,"window-state.v1.json"),
          JSON.stringify({version:1,displayId:"1",bounds:{x:100,y:100,width:1600,height:900},maximized:false}));
      }
    }
    const first=observations[0];
    for (const row of observations) {
      assert.deepEqual(row.values, first.values, `localStorage changed at ${row.label}`);
      assert.deepEqual(row.cover, first.cover, `cover lost at ${row.label}`);
      assert.deepEqual(row.wallpaper, first.wallpaper, `wallpaper lost at ${row.label}`);
      assert.equal(row.renderedEntries, true, `library did not render at ${row.label}`);
    }
    console.log("RESULT: all four paths preserve renderer library and IndexedDB assets");
  } catch (error) {
    console.error("RESULT: storage-origin compatibility failed",error);
    process.exitCode=1;
  } finally {
    await stop();
  }
})();
