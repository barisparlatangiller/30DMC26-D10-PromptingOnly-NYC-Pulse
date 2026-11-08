// ~15 s LinkedIn video (1080×1350): 24 hours of New York in one sweep, rendered frame by frame from the live simulation.
// The camera follows the app's cinematic path; the hearts beat at the real pace of the replay.
//   node pipeline/video.mjs   → media/day10_nyc_pulse.mp4, cover.png, thumb_full.jpg
import { chromium } from "playwright";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import http from "node:http";
import path from "node:path";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".geojson": "application/geo+json" };
http.createServer((req, res) => {                                   // static server with HTTP Range (PMTiles)
  const u = decodeURIComponent(new globalThis.URL(req.url, "http://x").pathname);
  const f = path.join("docs", u.endsWith("/") ? u + "index.html" : u);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const size = fs.statSync(f).size, type = TYPES[path.extname(f)] || "application/octet-stream";
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
  if (m) { const a = +m[1], b = m[2] ? Math.min(+m[2], size - 1) : size - 1;
    res.writeHead(206, { "Content-Type": type, "Content-Length": b - a + 1, "Content-Range": `bytes ${a}-${b}/${size}`, "Accept-Ranges": "bytes" });
    fs.createReadStream(f, { start: a, end: b }).pipe(res);
  } else { res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" }); fs.createReadStream(f).pipe(res); }
}).listen(8000);

const URL = "http://localhost:8000/", OUT = "media", FR = "media/frames", FPS = 15;
fs.mkdirSync(FR, { recursive: true });
const ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"];
const ready = p => p.waitForFunction(() => window.S && S.ready && S.map.getLayer("bld"), null, { timeout: 180000 });
const settle = p => p.evaluate(() => new Promise(r => { let done = false; const fin = () => { if (!done) { done = true; setTimeout(r, 30); } };
  S.map.once("idle", fin); S.map.triggerRepaint(); setTimeout(fin, 6000); }));

// hub thumbnail: the desktop page at 18:10
let br = await chromium.launch({ args: ARGS });
{
  const p = await br.newPage({ viewport: { width: 1440, height: 900 } });
  p.on("console", m => m.type() === "error" && console.log("console:", m.text()));
  await p.goto(URL, { waitUntil: "networkidle" }); await ready(p);
  await p.evaluate(() => { S.manual = true; S.t = 1090; S.phase = 0.3; S.map.jumpTo({ center: [-73.984, 40.748], zoom: 12.3, pitch: 62, bearing: -30 }); S.render(); });
  await settle(p); await p.evaluate(() => S.render()); await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/thumb_full.jpg`, type: "jpeg", quality: 90 });
  console.log("thumbnail", new Date().toISOString());
  await p.close();
}

const CSS = `
  .card, .ctl, .legend, .time, .zone, .about, .fact, .maplibregl-ctrl-bottom-left, .maplibregl-ctrl-bottom-right { display: none !important; }
  .v { position: absolute; z-index: 6; left: 46px; right: 46px; font-family: Inter; color: #eef1f8; }
  .v.top { top: 44px; }
  .v .eb { font-size: 18px; letter-spacing: .16em; text-transform: uppercase; color: #8790a8; font-weight: 600; }
  .v h1 { font-size: 92px; font-weight: 800; letter-spacing: -.04em; margin: 6px 0 0; line-height: .95; background: linear-gradient(90deg, #fff 30%, var(--hc)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .v .q { font-size: 28px; color: #b9c1d6; margin-top: 10px; }
  .v.clock { top: 255px; display: flex; align-items: baseline; gap: 18px; }
  .v.clock b { font-family: "JetBrains Mono"; font-size: 84px; font-weight: 700; color: var(--hc); text-shadow: 0 0 34px var(--hc); }
  .v.clock span { font-size: 24px; color: #b9c1d6; line-height: 1.3; }
  .v.bot { bottom: 46px; background: rgba(9,13,24,.74); border: 1px solid rgba(255,255,255,.09); border-radius: 20px; padding: 22px 26px; backdrop-filter: blur(14px); }
  .v .row { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .v .row b { display: block; font-size: 42px; font-weight: 800; font-variant-numeric: tabular-nums; } .v .row span { font-size: 19px; color: #8790a8; }
  .v .ramp { height: 10px; border-radius: 5px; margin-top: 18px; position: relative; }
  .v .ramp i { position: absolute; top: -7px; width: 4px; height: 24px; border-radius: 2px; background: #fff; box-shadow: 0 0 12px #fff; }
  .v .hz { font-size: 20px; color: #b9c1d6; margin-top: 14px; } .v .hz b { color: #fff; }
  .card2 { position: absolute; z-index: 7; left: 60px; right: 60px; top: 330px; background: rgba(8,11,20,.86); border: 1px solid rgba(255,255,255,.1); border-radius: 26px; padding: 40px 44px; backdrop-filter: blur(16px); font-family: Inter; color: #eef1f8; opacity: 0; transition: none; }
  .card2 h2 { font-size: 54px; margin: 0 0 18px; letter-spacing: -.03em; line-height: 1.02; }
  .card2 li { font-size: 25px; line-height: 1.4; color: #c9d0e2; margin: 0 0 12px; }
  .card2 .url { margin-top: 22px; font-size: 24px; font-weight: 700; color: var(--hc); }
  .card2 .att { margin-top: 8px; font-size: 15px; color: #7c869e; }
`;
async function openPage() {
  const page = await br.newPage({ viewport: { width: 1080, height: 1350 } });
  page.on("console", m => m.type() === "error" && console.log("console:", m.text()));
  await page.goto(URL, { waitUntil: "networkidle" }); await ready(page);
  await page.addStyleTag({ content: CSS });
  await page.evaluate(() => {
    S.manual = true;
    const st = S.stats, f = st.facts, pick = s => (f.find(x => s.test(x[1])) || [0, ""])[1];
    const tot = Object.values(st.trips).reduce((a, b) => a + b, 0);
    document.body.insertAdjacentHTML("beforeend", `<div class="v top"><div class="eb">#30DayMapChallenge · Day 10 · Prompting only</div>
      <h1>NYC Pulse</h1><div class="q">Where does New York's heart beat? One Tuesday, 24 hours.</div></div>
      <div class="v clock"><b id="vc">00:00</b><span>Tue 16 June 2026<br><span id="vp">night</span></span></div>
      <div class="v bot"><div class="row"><div><b id="vt">0</b><span>car trips starting / hour</span></div><div><b id="vs">0</b><span>subway entries / hour</span></div></div>
      <div class="ramp" id="vr"><i id="vi"></i></div><div class="hz" id="vh"></div></div>
      <div class="card2" id="c2"><h2>Where the heart beats</h2><ul>
        <li>${tot.toLocaleString("en-US")} car trips and ${st.subway_entries.toLocaleString("en-US")} subway entries in one day.</li>
        <li>${pick(/Uber and Lyft/)}</li><li>${pick(/city heart stays/)}</li><li>${pick(/busiest 10 minutes/)}</li></ul>
        <div class="url">Play the day yourself · barisparlatangiller.github.io</div>
        <div class="att">NYC TLC trip records · MTA Subway Hourly Ridership · NYC OpenData buildings · © CARTO, © OpenStreetMap · made only by prompting Claude</div></div>`);
    document.getElementById("vr").style.background = document.getElementById("ramp").style.background;
    S.map.resize();
  });
  return page;
}
let page = await openPage();

const SWEEP = 186, CARD = 42, plan = [];
for (let i = 0; i < SWEEP; i++) { const k = i / (SWEEP - 1); plan.push({ t: 1439.5 * k, phase: i / FPS }); }
for (let i = 0; i < CARD; i++) plan.push({ t: 1439.5, phase: (SWEEP + i) / FPS, card: Math.min(1, i / 8) });

let n = 0;
for (const fr of plan) {
  if (n > 0 && n % 45 === 0) { await br.close(); br = await chromium.launch({ args: ARGS }); page = await openPage(); }
  await page.evaluate(fr => {
    S.t = fr.t; S.phase = fr.phase;
    const c = cam(fr.t); c.zoom = Math.max(11.02, c.zoom - 0.12);
    S.map.jumpTo(c);
    const st = S.render(), mm = Math.floor(fr.t);
    document.getElementById("vc").textContent = `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
    document.getElementById("vp").textContent = mm < 300 ? "night" : mm < 600 ? "morning" : mm < 960 ? "day" : mm < 1200 ? "evening" : "night";
    document.getElementById("vt").textContent = Math.round(st.rate * 60).toLocaleString("en-US");
    document.getElementById("vs").textContent = Math.round(st.sv.reduce((a, b) => a + b, 0) * 6).toLocaleString("en-US");
    document.getElementById("vi").style.left = `calc(${(fr.t / 1440 * 100).toFixed(2)}% - 2px)`;
    document.getElementById("vh").innerHTML = document.getElementById("heartTxt").innerHTML;
    if (fr.card != null) { document.getElementById("c2").style.opacity = fr.card; document.querySelector(".v.bot").style.opacity = 1 - fr.card; document.querySelector(".v.clock").style.opacity = 1 - fr.card; }
  }, fr);
  await page.evaluate(() => new Promise(r => { S.map.once("idle", () => setTimeout(r, 20)); S.map.triggerRepaint(); setTimeout(r, 2500); }));
  await page.screenshot({ path: `${FR}/f${String(n).padStart(4, "0")}.png` }); n++;
  if (n % 30 === 0) console.log("frame", n, new Date().toISOString());
}
fs.copyFileSync(`${FR}/f${String(Math.round(SWEEP * 0.76)).padStart(4, "0")}.png`, `${OUT}/cover.png`);
await br.close();
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", `${FR}/f%04d.png`,
  "-vf", "minterpolate=fps=30:mi_mode=blend", "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart", `${OUT}/day10_nyc_pulse.mp4`]);
console.log(`${n} frames, ${(n / FPS).toFixed(1)} s, ${(fs.statSync(`${OUT}/day10_nyc_pulse.mp4`).size / 1e6).toFixed(2)} MB`);
fs.rmSync(FR, { recursive: true });
process.exit(0);
