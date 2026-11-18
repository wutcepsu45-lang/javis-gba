/* JV GBA bot — level grinding and Shiny / species hunting for Pokémon SoulGold (pokeemerald-expansion).
   It reads the game's memory from an mGBA save state (no core changes needed) and presses buttons
   through EmulatorJS's simulateInput. */
(() => {
  "use strict";
  // ---- where things live in this ROM (SoulGold TH v1.1.4); checked and searched again at start ----
  const MON = 96;                       // sizeof(struct Pokemon) in this build
  const DEF = { main: 0x030055C0, enemy: 0x02038DE4, party: 0x02039024 };
  const K = { B: 0, SELECT: 2, START: 3, U: 4, D: 5, L: 6, R: 7, A: 8 };

  let addr = { ...DEF }, st = null, dv = null, OFF = 16;
  let SPECIES = {}, MOVES = {};
  const gm = () => window.EJS_emulator && window.EJS_emulator.gameManager;

  // ---------- memory ----------
  function snap() {
    st = gm().getState();
    dv = new DataView(st.buffer, st.byteOffset, st.byteLength);
    // RetroArch state: "RASTATE" + version, then "MEM " + size, then the mGBA state
    OFF = (st[0] === 0x52 && st[8] === 0x4D) ? 16 : 0;
  }
  const at = a => a >= 0x03000000 ? OFF + 0x19000 + (a - 0x03000000) : OFF + 0x21000 + (a - 0x02000000);
  const u8 = a => st[at(a)], u16 = a => dv.getUint16(at(a), true), u32 = a => dv.getUint32(at(a), true);
  const isRom = v => v >= 0x08000000 && v < 0x0A000000;

  function mon(a) {
    const w0 = u32(a + 32), w3 = u32(a + 44), w4 = u32(a + 48), w5 = u32(a + 52), flags = u8(a + 21);
    const pid = u32(a), ot = u32(a + 4);
    const sv = (pid >>> 16) ^ (pid & 0xFFFF) ^ (ot >>> 16) ^ (ot & 0xFFFF);
    const mod = (u16(a + 30) >> 14) & 1;
    return {
      species: w0 & 0x7FF, level: u8(a + 80), hp: u16(a + 82), maxHP: u16(a + 84),
      has: !!(flags & 2), egg: !!(flags & 4), pid,
      moves: [w3 & 0x7FF, (w3 >>> 16) & 0x7FF, w4 & 0x7FF, (w4 >>> 11) & 0x7FF],
      pp: [w5 & 0x7F, (w5 >>> 8) & 0x7F, (w5 >>> 16) & 0x7F, (w5 >>> 24) & 0x7F],
      // shiny odds are 1/128 or 1/256 depending on a game setting: count either as shiny so none is missed
      shiny: !!(((sv < 256) ? 1 : 0) ^ mod) || !!(((sv < 512) ? 1 : 0) ^ mod),
    };
  }
  const valid = m => m.has && !m.egg && m.species > 0 && m.species < 1600 && m.level >= 1 && m.level <= 100 && m.maxHP > 0 && m.hp <= m.maxHP;
  const party = () => { const r = []; for (let i = 0; i < 6; i++) { const m = mon(addr.party + i * MON); if (m.has) r.push(m); } return r; };
  const lead = () => party().find(m => !m.egg && m.hp > 0) || party()[0];
  const enemy = () => mon(addr.enemy);
  const inBattle = () => !!(u8(addr.main + 0x439) & 2);

  // check the addresses; if this is a different build, search for them
  function locate() {
    snap();
    const mainOk = a => isRom(u32(a)) && isRom(u32(a + 4)) && u32(a + 0x20) > 0;
    if (!mainOk(addr.main)) {
      addr.main = 0;
      for (let a = 0x03000000; a < 0x03007C00 - 0x440; a += 4) if (mainOk(a) && isRom(u32(a + 12)) && u32(a + 0x24) < 1e7) { addr.main = a; }
      if (!addr.main) return "หาข้อมูลเกมไม่เจอ (gMain)";
    }
    if (!valid(mon(addr.party))) {
      addr.party = 0;
      for (let a = 0x02000000; a < 0x02040000 - MON * 7; a += 4) {
        if (!valid(mon(a))) continue;
        const e = a - MON * 6, prev = mon(e);
        let zero = true; for (let i = 0; i < MON; i += 4) if (u32(e + i)) { zero = false; break; }
        if (zero || valid(prev)) { addr.party = a; addr.enemy = e; break; }
      }
      if (!addr.party) return "หาทีมโปเกมอนไม่เจอ — ต้องมีโปเกมอนในทีมก่อน";
    }
    return null;
  }

  // ---------- input, timed by emulated frames so it works with fast-forward ----------
  const frame = () => gm().Module._get_current_frame_count();
  const waitF = n => new Promise(ok => { const t = frame() + n, t0 = Date.now(); const f = () => (!running || frame() >= t || Date.now() - t0 > 4000) ? ok() : setTimeout(f, 8); f(); });
  async function tap(k, hold = 4, gap = 6) { gm().simulateInput(0, K[k], 1); await waitF(hold); gm().simulateInput(0, K[k], 0); await waitF(gap); }
  async function hold(k, n) { gm().simulateInput(0, K[k], 1); await waitF(n); gm().simulateInput(0, K[k], 0); }
  function releaseAll() { try { for (const k in K) gm().simulateInput(0, K[k], 0); } catch (e) {} }

  // ---------- settings ----------
  const PREF = "jv-bot";
  const cfg = Object.assign({ mode: "grind", dir: "LR", steps: 2, slot: 0, hpStop: 35, lvStop: 0, targets: "", fast: true, stopLearn: true },
    (() => { try { return JSON.parse(localStorage.getItem(PREF)) || {}; } catch (e) { return {}; } })());
  const saveCfg = () => { try { localStorage.setItem(PREF, JSON.stringify(cfg)); } catch (e) {} };
  const nameOf = id => SPECIES[id] || ("#" + id);
  const moveName = id => id ? (MOVES[id] || ("ท่า #" + id)) : "—";
  function targetIds() {
    const want = cfg.targets.split(/[,\n]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    const ids = new Set();
    for (const [id, n] of Object.entries(SPECIES)) if (want.includes(n.toLowerCase())) ids.add(+id);
    return ids;
  }

  // ---------- the loop ----------
  let running = false, stats = { enc: 0, wins: 0, runs: 0, started: 0, last: "" };
  async function run() {
    const err = locate();
    if (err) { stop(err, true); return; }
    stats = { enc: 0, wins: 0, runs: 0, started: Date.now(), last: "" };
    const targets = targetIds();
    if (cfg.fast) { try { gm().Module._set_ff_ratio(3); gm().Module._toggle_fastforward(1); } catch (e) {} }
    let battle = null, lastEnc = Date.now(), flip = false;
    status();
    while (running) {
      snap();
      if (!inBattle()) {
        if (battle) {                                   // a battle just ended
          battle = null;
          const l = lead();
          if (cfg.mode === "grind" && cfg.lvStop && l && l.level >= cfg.lvStop) { stop(`${nameOf(l.species)} ถึงเลเวล ${l.level} แล้ว`); break; }
          if (cfg.mode === "grind" && l && l.hp * 100 < l.maxHP * cfg.hpStop) { stop(`HP ของ ${nameOf(l.species)} เหลือ ${l.hp}/${l.maxHP} — พาไปรักษาก่อน`); break; }
          await tap("B"); await tap("B");                // close leftover text (evolution etc. need A, see below)
        }
        if (Date.now() - lastEnc > 180000) { stop("3 นาทีแล้วยังไม่เจอโปเกมอน — ตรวจว่ายืนอยู่ในพงหญ้า"); break; }
        // walk back and forth inside the grass
        const d = cfg.dir === "LR" ? (flip ? "R" : "L") : (flip ? "D" : "U");
        flip = !flip;
        await hold(d, 16 * cfg.steps + 2);
        await tap("B", 2, 2);
        continue;
      }
      // ---- in battle ----
      if (!battle) {
        battle = { t: Date.now(), lv: (lead() || {}).level || 0 };
        lastEnc = Date.now(); stats.enc++;
        await waitF(30); snap();
        const e = enemy();
        stats.last = valid(e) ? `${nameOf(e.species)} Lv.${e.level}${e.shiny ? " ✨" : ""}` : "?";
        status();
        if (valid(e) && e.shiny) { stop(`✨ เจอ ${nameOf(e.species)} SHINY! บอทหยุดแล้ว — จับเองเลย`, false, true); break; }
        if (cfg.mode === "hunt" && valid(e) && targets.has(e.species)) { stop(`เจอ ${nameOf(e.species)} Lv.${e.level} แล้ว — บอทหยุด จับเองได้เลย`, false, true); break; }
      }
      if (Date.now() - battle.t > 90000) { stop("อยู่ในการต่อสู้นานผิดปกติ (อาจเป็นเทรนเนอร์ หรือมีหน้าต่างให้เลือก) — บอทหยุด"); break; }
      if (cfg.mode === "hunt") {
        // from any cursor position, Down then Right lands on "Run" (bottom-right); A also advances text
        await tap("D"); await tap("R"); await tap("A"); await waitF(10);
      } else {
        const l = lead();
        if (l) {
          if (l.hp * 100 < l.maxHP * cfg.hpStop) { stop(`HP ของ ${nameOf(l.species)} เหลือ ${l.hp}/${l.maxHP} — บอทหยุดกลางการต่อสู้`); break; }
          if (!l.moves[cfg.slot] || l.pp[cfg.slot] === 0) { stop(`ท่า ${moveName(l.moves[cfg.slot])} PP หมด — เปลี่ยนท่าหรือไปรักษา`); break; }
          if (cfg.stopLearn && l.level > battle.lv && l.moves.every(Boolean)) { stop(`${nameOf(l.species)} เลเวลอัปเป็น ${l.level} — ถ้ามีท่าใหม่ให้เลือกเอง แล้วกดเริ่มบอทอีกครั้ง`); break; }
        }
        // FIGHT (top-left), then the move: slot 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right
        await tap("U"); await tap("L"); await tap("A"); await waitF(8);
        await tap("U"); await tap("L");
        if (cfg.slot & 1) await tap("R");
        if (cfg.slot & 2) await tap("D");
        await tap("A"); await waitF(12);
      }
    }
  }
  function start() {
    if (running) return;
    if (!gm()) return;
    running = true; ui(); run().catch(e => stop("บอทหยุดเพราะเกิดข้อผิดพลาด: " + e.message, true));
  }
  function stop(msg, isErr, alert) {
    const was = running;
    running = false; releaseAll();
    try { if (cfg.fast) gm().Module._toggle_fastforward(0); } catch (e) {}
    ui();
    if (msg) show(msg, alert);
    if (alert && was) ding();
  }
  function ding() {
    try { navigator.vibrate && navigator.vibrate([400, 150, 400, 150, 400]); } catch (e) {}
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25, 0.5].forEach(t => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880 + t * 800; g.gain.value = 0.2; o.connect(g); g.connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.18); });
    } catch (e) {}
  }

  // ---------- UI ----------
  const css = `
  #botPill{position:absolute;top:calc(env(safe-area-inset-top) + 8px);right:8px;z-index:100001;background:#0008;color:#fff;border-radius:20px;
    padding:7px 14px;font-size:13px;backdrop-filter:blur(4px);border:0;font-family:inherit}
  #botPill.on{background:#5fd3b5;color:#10241f;font-weight:600}
  #botPanel{position:absolute;left:0;right:0;bottom:0;z-index:100002;background:#1d1a2b;color:#ece8f6;border-radius:18px 18px 0 0;
    padding:16px 16px calc(env(safe-area-inset-bottom) + 16px);max-height:78vh;overflow:auto;font-size:14px;box-shadow:0 -8px 30px #0008}
  #botPanel[hidden]{display:none}
  #botPanel h4{margin:0 0 10px;font-size:17px;display:flex;justify-content:space-between;align-items:center}
  #botPanel .x{background:none;border:0;color:#9b94b3;font-size:22px;padding:0 4px}
  #botPanel label.row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:10px 0}
  #botPanel .segb{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 10px}
  #botPanel .segb button{flex:1;min-width:0;padding:9px 6px;border-radius:10px;border:0;background:#2b2740;color:#ece8f6;font:inherit;font-size:13px}
  #botPanel .segb button.sel{background:#8c7cf0;color:#fff}
  #botPanel input[type=number]{width:70px;padding:7px;border-radius:8px;border:0;background:#2b2740;color:#fff;font:inherit;text-align:center}
  #botPanel textarea{width:100%;box-sizing:border-box;min-height:52px;padding:8px;border-radius:10px;border:0;background:#2b2740;color:#fff;font:inherit}
  #botPanel .note{color:#9b94b3;font-size:12px;line-height:1.5;margin:4px 0 8px}
  #botPanel .go{width:100%;padding:14px;border:0;border-radius:14px;background:#5fd3b5;color:#10241f;font:inherit;font-weight:700;font-size:16px;margin-top:8px}
  #botPanel .go.stop{background:#ef6b7b;color:#fff}
  #botMsg{position:absolute;left:12px;right:12px;bottom:calc(env(safe-area-inset-bottom) + 24px);z-index:100003;background:#1d1a2bf0;color:#ece8f6;
    border-radius:14px;padding:12px 14px;font-size:14px;line-height:1.5;box-shadow:0 6px 24px #0009}
  #botMsg.alert{background:#8c7cf0;color:#fff;font-weight:600}
  #botMsg[hidden]{display:none}`;
  let el = {};
  function mount() {
    if (document.getElementById("botPill")) return;
    const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s);
    const player = document.getElementById("player");
    player.insertAdjacentHTML("beforeend", `
      <button id="botPill">🤖 บอท</button>
      <div id="botMsg" hidden></div>
      <div id="botPanel" hidden>
        <h4>บอท <button class="x" id="botX">✕</button></h4>
        <div class="segb" id="botMode"><button data-v="grind">ฟาร์มเลเวล</button><button data-v="hunt">ล่า Shiny / ตามหาตัว</button></div>
        <div class="note">ยืนในพงหญ้าก่อนกดเริ่ม บอทจะเดินไปมา และ<b>หยุดทันทีเมื่อเจอ Shiny</b> ทุกโหมด</div>
        <div>เดินไปมา</div>
        <div class="segb" id="botDir"><button data-v="LR">ซ้าย ↔ ขวา</button><button data-v="UD">ขึ้น ↕ ลง</button></div>
        <label class="row">จำนวนก้าวต่อฝั่ง <input type="number" id="botSteps" min="1" max="6"></label>
        <div id="botGrind">
          <div>ใช้ท่า</div>
          <div class="segb" id="botSlot"></div>
          <label class="row">หยุดเมื่อ HP ต่ำกว่า (%) <input type="number" id="botHp" min="0" max="95"></label>
          <label class="row">หยุดเมื่อถึงเลเวล (0 = ไม่หยุด) <input type="number" id="botLv" min="0" max="100"></label>
          <label class="row">หยุดเมื่อเลเวลอัปตอนมีท่าครบ 4 <input type="checkbox" id="botLearn"></label>
          <div class="note">ตัวที่สู้คือตัวแรกในทีมที่ยังไม่หมดแรง บอทจะหยุดเองถ้า PP ของท่าที่เลือกหมด</div>
        </div>
        <div id="botHunt">
          <div>ตัวที่ตามหา (ชื่ออังกฤษ คั่นด้วย ,)</div>
          <textarea id="botTargets" placeholder="เช่น Larvitar, Marill" list="botNames"></textarea>
          <div class="note">ตัวอื่นบอทจะกดหนีให้ ไม่ต้องใส่ก็ได้ถ้าล่า Shiny อย่างเดียว</div>
        </div>
        <label class="row">เร่งความเร็ว ×3 ระหว่างบอททำงาน <input type="checkbox" id="botFast"></label>
        <div class="note" id="botStat"></div>
        <button class="go" id="botGo">▶ เริ่มบอท</button>
      </div>`);
    el = id => document.getElementById(id);
    const seg = (box, key, after) => {
      const b = el(box);
      const paint = () => [...b.children].forEach(x => x.classList.toggle("sel", String(cfg[key]) === x.dataset.v));
      b.onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v == null) return; cfg[key] = /^\d+$/.test(v) ? +v : v; saveCfg(); paint(); after && after(); };
      paint(); return paint;
    };
    seg("botMode", "mode", ui); seg("botDir", "dir");
    const num = (id, key, lo, hi) => { const i = el(id); i.value = cfg[key]; i.onchange = () => { cfg[key] = Math.max(lo, Math.min(hi, +i.value || 0)); i.value = cfg[key]; saveCfg(); }; };
    num("botSteps", "steps", 1, 6); num("botHp", "hpStop", 0, 95); num("botLv", "lvStop", 0, 100);
    const chk = (id, key) => { const i = el(id); i.checked = !!cfg[key]; i.onchange = () => { cfg[key] = i.checked; saveCfg(); }; };
    chk("botFast", "fast"); chk("botLearn", "stopLearn");
    el("botTargets").value = cfg.targets; el("botTargets").oninput = e => { cfg.targets = e.target.value; saveCfg(); };
    el("botPill").onclick = () => { el("botPanel").hidden = !el("botPanel").hidden; if (!el("botPanel").hidden) refreshMoves(); ui(); };
    el("botX").onclick = () => { el("botPanel").hidden = true; };
    el("botGo").onclick = () => { if (running) stop("หยุดบอทแล้ว"); else { el("botPanel").hidden = true; start(); } };
    el("botMsg").onclick = () => { el("botMsg").hidden = true; };
    ui();
  }
  function refreshMoves() {
    let ms = null;
    try { if (!locate()) { const l = lead(); ms = l ? l.moves.map((m, i) => `${moveName(m)}${m ? " (" + l.pp[i] + ")" : ""}`) : null; } } catch (e) {}
    const b = el("botSlot"); b.innerHTML = "";
    for (let i = 0; i < 4; i++) { const x = document.createElement("button"); x.dataset.v = i; x.textContent = ms ? ms[i] : "ช่อง " + (i + 1); b.appendChild(x); }
    const paint = () => [...b.children].forEach(x => x.classList.toggle("sel", +x.dataset.v === cfg.slot));
    b.onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v == null) return; cfg.slot = +v; saveCfg(); paint(); };
    paint();
  }
  function ui() {
    if (!el || typeof el !== "function") return;
    el("botGrind").hidden = cfg.mode !== "grind"; el("botHunt").hidden = cfg.mode !== "hunt";
    el("botGo").textContent = running ? "■ หยุดบอท" : "▶ เริ่มบอท";
    el("botGo").classList.toggle("stop", running);
    el("botPill").classList.toggle("on", running);
    status();
  }
  function status() {
    if (typeof el !== "function") return;
    const mins = stats.started ? Math.round((Date.now() - stats.started) / 60000) : 0;
    el("botPill").textContent = running ? `🤖 ${cfg.mode === "grind" ? "ฟาร์ม" : "ล่า"} · ${stats.enc}` : "🤖 บอท";
    el("botStat").textContent = stats.started ? `รอบล่าสุด: เจอ ${stats.enc} ตัว ใน ${mins} นาที${stats.last ? " · ตัวล่าสุด " + stats.last : ""}` : "";
  }
  let msgT;
  function show(msg, alert) {
    const m = el("botMsg"); m.textContent = msg; m.hidden = false; m.classList.toggle("alert", !!alert);
    clearTimeout(msgT); if (!alert) msgT = setTimeout(() => { m.hidden = true; }, 6000);
  }

  window.JVBot = {
    init(dataPath) {
      mount();
      const base = (dataPath || "").replace(/data\/?$/, "");
      fetch(base + "species.json").then(r => r.json()).then(j => {
        SPECIES = j;
        const dl = document.createElement("datalist"); dl.id = "botNames";
        dl.innerHTML = Object.values(j).map(n => `<option value="${n.replace(/"/g, "")}">`).join("");
        document.body.appendChild(dl);
      }).catch(() => {});
      fetch(base + "moves.json").then(r => r.json()).then(j => { MOVES = j; }).catch(() => {});
    },
    stop: () => stop(),
    get running() { return running; },
    _debug: { snap, locate, mon, enemy, lead, inBattle, get addr() { return addr; } },
  };
})();
