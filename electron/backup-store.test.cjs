const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createBackupStore, verify, retention } = require("./backup-store.cjs");
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
function fixture(createdAt = new Date().toISOString()) {
  const data = {items: [], settings: {theme: {accent:"#ffffff",background:"#000000",text:"#eeeeee",backgroundMode:"default",imageFit:"cover",backgroundDimming:0},sorts:{},views:{}}};
  const assets = [];
  return JSON.stringify({manifest: {format:"EveriaBackup",schema:1,appVersion:"1.0.0",createdAt,recordCount:0,assetCount:0,
    payloadSha256:digest(JSON.stringify({data,assets})),assets:[]},data,assets});
}
function setup(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "everia-backup-test-"));
  const destination = path.join(root, "destination");
  fs.mkdirSync(destination);
  try { return fn(createBackupStore(root, destination), root, destination); }
  finally { fs.rmSync(root, {recursive:true, force:true}); }
}
test("backup format, integrity, truncation, duplicate and unsafe asset entries", () => {
  const original = fixture();
  assert.equal(verify(original).manifest.schema, 1);
  assert.throws(() => verify(original.slice(0,-1)));
  const doc = JSON.parse(original);
  doc.manifest.schema = 2;
  assert.throws(() => verify(JSON.stringify(doc)));
  doc.manifest.schema = 1;
  doc.data.items.push({id:"bad"});
  assert.throws(() => verify(JSON.stringify(doc)));
  doc.data.items.pop();
  const bytes = Buffer.from("image");
  const asset = {store:"covers",id:"local-cover:safe",mime:"image/png",bytes:bytes.length,sha256:digest(bytes),base64:bytes.toString("base64")};
  doc.assets = [asset,asset];
  doc.manifest.assets = doc.assets.map(({store,id,bytes,sha256})=>({store,id,bytes,sha256}));
  doc.manifest.assetCount = 2;
  doc.manifest.payloadSha256 = digest(JSON.stringify({data:doc.data,assets:doc.assets}));
  assert.throws(() => verify(JSON.stringify(doc)), /duplicate/);
  doc.assets[1] = {...asset,id:"../provider-credentials.v1.json"};
  doc.manifest.assets[1].id = doc.assets[1].id;
  doc.manifest.payloadSha256 = digest(JSON.stringify({data:doc.data,assets:doc.assets}));
  assert.throws(() => verify(JSON.stringify(doc)), /Invalid or duplicate/);
});
test("atomic write validates final file, unavailable destination preserves last success", () => setup((store,root,destination) => {
  const first = store.write(fixture());
  assert.equal(fs.readFileSync(first,"utf8"), fixture(JSON.parse(fs.readFileSync(first,"utf8")).manifest.createdAt));
  const saved = store.config().lastSuccess;
  store.setConfig({ destination }); // Explicitly selected removable destination, even if path matches default.
  fs.renameSync(destination, `${destination}-removed`);
  assert.throws(() => store.write(fixture()), /unavailable/);
  assert.equal(store.config().lastSuccess, saved);
  assert.match(store.config().lastFailure.message, /unavailable/);
  assert(fs.existsSync(path.join(`${destination}-removed`,path.basename(first))));
  assert.equal(fs.readdirSync(root).some((name)=>name.endsWith(".tmp")),false);
}));
test("failed replacement cannot delete last good backup or unrelated files", () => setup((store,root,destination) => {
  const first = store.write(fixture());
  fs.writeFileSync(path.join(destination,"personal.txt"),"private");
  assert.throws(()=>store.write("not JSON"));
  assert(fs.existsSync(first));
  assert(fs.existsSync(path.join(destination,"personal.txt")));
}));
test("daily weekly monthly retention selects generations and one snapshot can satisfy tiers", () => {
  const files = Array.from({length:65},(_,i)=>({path:`snapshot-${i}`,createdAt:new Date(Date.UTC(2026,5,1+i)).toISOString()}));
  const kept = retention(files);
  assert(kept.has("snapshot-64"));
  assert(kept.size <= 17);
  assert(kept.size >= 7);
});
test("restore journal persists and cannot silently replace an interrupted operation", () => setup((store,root) => {
  const old = fixture();
  store.beginRestore({backup:old,raw:[null,null,null,null]});
  assert.equal(store.pendingRestore().backup, old);
  assert.throws(()=>store.beginRestore({backup:old,raw:[null,null,null,null]}), /interrupted/);
  const another = createBackupStore(root);
  assert.equal(another.pendingRestore().backup,old);
  another.finishRestore();
  assert.equal(store.pendingRestore(),null);
}));
