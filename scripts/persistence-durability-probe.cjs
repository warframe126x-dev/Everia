const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "everia-durability-"));
const executable = path.resolve("release/Everia-win32-x64/Everia.exe");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let active, socket, port, sequence = 0;
const pending = new Map();
async function launch(profile) {
  console.log("Launching",path.basename(profile));
  port = 10400 + Math.floor(Math.random() * 1000);
  active = spawn(executable, [`--remote-debugging-port=${port}`], {
    env: {...process.env, APPDATA:profile}, stdio:"ignore",
  });
  active.on("error",(error)=>{ console.error("Packaged application launch failed",error); });
  for (let i=0;i<120;i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2000)})).json();
      const page = pages.find((entry)=>entry.type === "page" && entry.url.startsWith("file:"));
      if (!page) { await delay(250); continue; }
      socket = new WebSocket(page.webSocketDebuggerUrl);
      await Promise.race([
        new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});}),
        delay(5000).then(()=>{throw Error("CDP WebSocket connection timed out");}),
      ]);
      socket.addEventListener("message",(event)=>{
        const reply=JSON.parse(event.data), waiter=pending.get(reply.id);
        if (waiter) {pending.delete(reply.id); reply.error?waiter.reject(new Error(JSON.stringify(reply.error))):waiter.resolve(reply.result);}
      });
      return;
    } catch { await delay(250); }
  }
  throw new Error("Packaged Everia did not launch");
}
function command(method,params={}) {
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP ${method} timed out`));},10000);
    pending.set(id,{resolve:(result)=>{clearTimeout(timer);resolve(result);},reject:(error)=>{clearTimeout(timer);reject(error);}});
    socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression) {
  const result=await command("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function waitFor(expression) {
  for (let i=0;i<50;i++) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for the packaged UI: ${expression}`);
}
async function saveThroughUI(title) {
  console.log("Saving through the UI",title);
  await waitFor(`!!document.querySelector(".category-card")`);
  await evaluate(`document.querySelector(".category-card")?.click()`);
  await waitFor(`Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("Add item"))`);
  await evaluate(`Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Add item"))?.click()`);
  await waitFor(`Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("Manual entry"))`);
  await evaluate(`Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Manual entry"))?.click()`);
  await waitFor(`Array.from(document.querySelectorAll("label")).some(x=>x.textContent.trim()==="Title" && x.querySelector("input"))`);
  const state=await evaluate(`(() => {
    const label=Array.from(document.querySelectorAll("label")).find(x=>x.textContent.trim()==="Title");
    const input=label?.querySelector("input");
    if (!input) return "missing Title editor";
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${JSON.stringify(title)});
    input.dispatchEvent(new Event("input",{bubbles:true}));
    return input.value;
  })()`);
  assert.equal(state,title);
  await delay(100);
  await evaluate(`Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Save to library"))?.click()`);
  for (let i=0;i<30;i++) {
    const saved=await evaluate(`JSON.parse(localStorage.getItem("everia.items.v1") || "[]").some(x=>x.title===${JSON.stringify(title)})`);
    if (saved) { console.log("Save acknowledged",title); return; }
    await delay(100);
  }
  throw new Error("Actual Everia save callback did not acknowledge the item");
}
async function close(mode) {
  console.log("Closing",mode);
  if (mode === "renderer-crash") {
    try { await Promise.race([command("Page.crash"),delay(3000)]); } catch {}
    await delay(100);
  }
  if (socket) {try {socket.close();} catch {} socket=undefined;}
  for (const [,waiter] of pending) waiter.reject(new Error("Renderer closed"));
  pending.clear();
  if (mode === "normal" || mode === "immediate-normal") {
    const result=spawnSync("powershell",["-NoProfile","-Command",
      `$p=Get-Process -Id ${active.pid}; $p.CloseMainWindow() | Out-Null; if (-not $p.WaitForExit(15000)) { exit 2 }`],
      {encoding:"utf8",timeout:20000});
    assert.equal(result.status,0,`normal close failed: ${result.stderr}`);
  } else { active.kill(); await delay(600); }
  active=undefined;
}
(async()=>{
  try {
    for (const mode of ["normal","immediate-normal","renderer-crash","forced"]) {
      const profile=path.join(root,mode);
      fs.mkdirSync(profile);
      await launch(profile);
      const title=`Durability ${mode}`;
      await saveThroughUI(title);
      if (mode === "normal") await delay(2500);
      await close(mode);
      await launch(profile);
      const persisted=await evaluate(`JSON.parse(localStorage.getItem("everia.items.v1") || "[]").some(x=>x.title===${JSON.stringify(title)})`);
      console.log(JSON.stringify({mode,acknowledged:true,afterRestart:persisted}));
      if (mode === "normal" || mode === "immediate-normal")
        assert(persisted,`Acknowledged save lost after ${mode} close`);
      await close("normal");
    }
  } catch(error) { console.error(error); process.exitCode=1; }
  finally { if(active) {active.kill(); await delay(500);} fs.rmSync(root,{recursive:true,force:true}); }
})();
