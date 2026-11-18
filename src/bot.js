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
      // same test as GetMonData(MON_DATA_IS_SHINY) with the release odds (256/65536) this ROM uses
      shiny: !!(((sv < 256) ? 1 : 0) ^ mod),
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
  const cfg = Object.assign({ dest: "", navFight: false, mode: "grind", dir: "LR", steps: 2, slot: 0, hpStop: 35, lvStop: 0, targets: "", fast: true, stopLearn: true },
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

  // ---------- player position and NPCs (navigation) ----------
  const SB1PTR = 0x030040C4, OBJ0 = 0x02003314, OBJSZ = 0x24;
  const s16 = a => dv.getInt16(at(a), true);
  function where() {
    const sb = u32(SB1PTR);
    if (sb < 0x02000000 || sb >= 0x02040000) return null;
    const o = OBJ0;   // object 0 is the player (localId 255); its coordinates update as a step starts
    const okObj = u8(o + 8) === 255 && (u32(o) & 1);
    return { g: u8(sb + 4), m: u8(sb + 5), x: okObj ? s16(o + 0x10) - 7 : s16(sb), y: okObj ? s16(o + 0x12) - 7 : s16(sb + 2), z: okObj ? (u8(o + 0x0B) & 15) : 0 };
  }
  function npcs() {
    const r = [];
    for (let i = 0; i < 16; i++) {
      const o = OBJ0 + i * OBJSZ, id = u8(o + 8);
      if (!(u32(o) & 1) || id === 255 || id === 254) continue;   // inactive, player, follower
      r.push([s16(o + 0x10) - 7, s16(o + 0x12) - 7]);
    }
    return r;
  }

  // ---------- map data + path finding ----------
  let MAPS = null, MAPIDX = null, mapsLoading = null, BASE = "";
  const T_WALK = 0, T_WALL = 1, T_WATER = 2, T_JS = 3, T_JN = 4, T_JE = 5, T_JW = 6, T_ICE = 12;
  function loadMaps() {
    if (MAPS) return Promise.resolve(MAPS);
    if (!mapsLoading) mapsLoading = fetch(BASE + "maps.json").then(r => r.json()).then(j => {
      MAPIDX = {};
      j.forEach((m, i) => { if (!m) return; MAPIDX[m.g * 256 + m.m] = i; m.tiles = Uint8Array.from(atob(m.t), c => c.charCodeAt(0)); delete m.t; m.oset = new Set(m.o.map(([x, y]) => x * 1024 + y)); });
      MAPS = j; return j;
    });
    return mapsLoading;
  }
  const DIRS = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
  const pretty = n => n.replace(/_/g, " · ").replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/Pokemon/g, "Pokémon").replace(/ 1 F/g, " 1F");
  function arrival(mi, wi) {
    const m = MAPS[mi]; if (!m || !m.wp[wi]) return null;
    let [x, y] = m.wp[wi];
    const t = m.tiles[y * m.w + x];
    if (t === undefined || (t & 15) === T_WALL) y += 1;        // a door: you come out one step below it
    return [mi, x, y, 0];
  }
  // breadth-first search over (map, x, y, elevation), crossing map edges and warps
  function findPath(from, goal, blocked, useStatic = true) {
    const key = (mi, x, y, z) => ((mi * 256 + (y & 255)) * 256 + (x & 255)) * 16 + z;
    const start = [MAPIDX[from.g * 256 + from.m], from.x, from.y, from.z];
    if (start[0] === undefined) return null;
    const live = new Set(npcs().map(([x, y]) => start[0] + ":" + x + ":" + y));
    const prev = new Map([[key(...start), null]]);
    let q = [start], n = 0;
    while (q.length) {
      const nq = [];
      for (const s of q) {
        const [mi, x, y, z] = s, m = MAPS[mi];
        if (goal(mi)) {
          const path = []; let k = key(...s), cur = s;
          while (cur) { const p = prev.get(k); path.push({ s: cur, d: p && p.d, how: p && p.how }); if (!p) break; cur = p.s; k = key(...cur); }
          return path.reverse();
        }
        if (++n > 400000) return null;
        const wpHere = m.wp.findIndex(w => w[0] === x && w[1] === y);
        for (const d of ["U", "D", "L", "R"]) {
          let nx = x + DIRS[d][0], ny = y + DIRS[d][1], next = null, how = "walk";
          // standing on a mat / stair warp and pressing its direction
          if (wpHere >= 0 && m.wp[wpHere][4] === "a" + d && m.wp[wpHere][2] >= 0) { next = arrival(m.wp[wpHere][2], m.wp[wpHere][3]); how = "warp"; }
          else if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) {
            const c = m.c.find(c => c[0] === { U: "u", D: "d", L: "l", R: "r" }[d]);
            if (!c || !MAPS[c[2]]) continue;
            const t = MAPS[c[2]];
            const tx = d === "R" ? 0 : d === "L" ? t.w - 1 : x - c[1];
            const ty = d === "D" ? 0 : d === "U" ? t.h - 1 : y - c[1];
            if (tx < 0 || ty < 0 || tx >= t.w || ty >= t.h) continue;
            const tc = t.tiles[ty * t.w + tx] & 15;
            if (tc === T_WALL || tc === T_WATER) continue;
            next = [c[2], tx, ty, z]; how = "edge";
          } else {
            const w = m.wp.find(w => w[0] === nx && w[1] === ny);
            const tile = m.tiles[ny * m.w + nx], tc = tile & 15, el = tile >> 4;
            if (w && w[4] === "d" && w[2] >= 0) { next = arrival(w[2], w[3]); how = "warp"; }
            else {
              if (blocked.has(mi + ":" + nx + ":" + ny) || (mi === start[0] && live.has(mi + ":" + nx + ":" + ny))) continue;
              // people, trees and rocks from the map data; near the player the live object list is used instead
              if (useStatic && m.oset.has(nx * 1024 + ny) && !(mi === start[0] && Math.abs(nx - from.x) <= 8 && Math.abs(ny - from.y) <= 6)) continue;
              if (tc === T_WALL || tc === T_WATER) continue;
              if (tc >= T_JS && tc <= T_JW) {               // ledges: only jump down them
                if ({ [T_JS]: "D", [T_JN]: "U", [T_JE]: "R", [T_JW]: "L" }[tc] !== d) continue;
                nx += DIRS[d][0]; ny += DIRS[d][1];
                if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || (m.tiles[ny * m.w + nx] & 15) === T_WALL) continue;
                next = [mi, nx, ny, z]; how = "jump";
              } else {
                if (z && el && el !== 15 && el !== z) continue;   // different floor level (bridges)
                if (w && w[4] === "s" && w[2] >= 0) { next = arrival(w[2], w[3]); how = "warp"; }
                else next = [mi, nx, ny, el === 15 ? z : el];
              }
            }
          }
          if (!next) continue;
          const k = key(...next);
          if (prev.has(k)) continue;
          prev.set(k, { s, d, how });
          nq.push(next);
        }
      }
      q = nq;
    }
    return null;
  }

  // ---------- battles (shared by every mode) ----------
  // returns a stop message, or null to carry on
  async function battleTick(battle, fight) {
    if (Date.now() - battle.t > 120000) return "อยู่ในการต่อสู้นานผิดปกติ (อาจมีหน้าต่างให้เลือก) — บอทหยุด";
    if (!fight) {
      // from any cursor position, Down then Right lands on "Run" (bottom-right); A also advances text
      await tap("D"); await tap("R"); await tap("A"); await waitF(10);
      return null;
    }
    const l = lead();
    if (l) {
      if (l.hp * 100 < l.maxHP * cfg.hpStop) return `HP ของ ${nameOf(l.species)} เหลือ ${l.hp}/${l.maxHP} — บอทหยุดกลางการต่อสู้`;
      if (!l.moves[cfg.slot] || l.pp[cfg.slot] === 0) return `ท่า ${moveName(l.moves[cfg.slot])} PP หมด — เปลี่ยนท่าหรือไปรักษา`;
      if (cfg.stopLearn && l.level > battle.lv && l.moves.every(Boolean)) return `${nameOf(l.species)} เลเวลอัปเป็น ${l.level} — ถ้ามีท่าใหม่ให้เลือกเอง แล้วกดเริ่มบอทอีกครั้ง`;
    }
    // FIGHT (top-left), then the move: slot 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right
    await tap("U"); await tap("L"); await tap("A"); await waitF(8);
    await tap("U"); await tap("L");
    if (cfg.slot & 1) await tap("R");
    if (cfg.slot & 2) await tap("D");
    await tap("A"); await waitF(12);
    return null;
  }
  async function battleStart(battle, targets) {
    stats.enc++;
    await waitF(30); snap();
    const e = enemy();
    stats.last = valid(e) ? `${nameOf(e.species)} Lv.${e.level}${e.shiny ? " ✨" : ""}` : "?";
    status();
    if (valid(e) && e.shiny) return { msg: `✨ เจอ ${nameOf(e.species)} SHINY! บอทหยุดแล้ว — จับเองเลย`, alert: true };
    if (cfg.mode === "hunt" && valid(e) && targets.has(e.species)) return { msg: `เจอ ${nameOf(e.species)} Lv.${e.level} แล้ว — บอทหยุด จับเองได้เลย`, alert: true };
    return null;
  }

  // ---------- the loop ----------
  let running = false, stats = { enc: 0, wins: 0, runs: 0, started: 0, last: "" };
  async function run() {
    const err = locate();
    if (err) { stop(err, true); return; }
    if (cfg.mode === "nav") return runNav();
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
          await tap("B"); await tap("B");
        }
        if (Date.now() - lastEnc > 180000) { stop("3 นาทีแล้วยังไม่เจอโปเกมอน — ตรวจว่ายืนอยู่ในพงหญ้า"); break; }
        // walk back and forth inside the grass
        const d = cfg.dir === "LR" ? (flip ? "R" : "L") : (flip ? "D" : "U");
        flip = !flip;
        await hold(d, 16 * cfg.steps + 2);
        await tap("B", 2, 2);
        continue;
      }
      if (!battle) {
        battle = { t: Date.now(), lv: (lead() || {}).level || 0 };
        lastEnc = Date.now();
        const r = await battleStart(battle, targets);
        if (r) { stop(r.msg, false, r.alert); break; }
      }
      const m = await battleTick(battle, cfg.mode === "grind");
      if (m) { stop(m); break; }
    }
  }

  async function runNav() {
    stats = { enc: 0, wins: 0, runs: 0, started: Date.now(), last: "" };
    show("กำลังโหลดแผนที่…");
    await loadMaps();
    const goalIdx = MAPS.findIndex(m => m && m.n === cfg.dest);
    if (goalIdx < 0) { stop("ยังไม่ได้เลือกปลายทาง หรือหาปลายทางไม่เจอ"); return; }
    const goal = mi => mi === goalIdx;
    if (cfg.fast) { try { gm().Module._set_ff_ratio(3); gm().Module._toggle_fastforward(1); } catch (e) {} }
    const blocked = new Set(), blockedAt = new Map();
    let path = null, i = 0, battle = null, fails = 0, noPath = 0, lastMove = Date.now(), best = 1e9, bestAt = Date.now();
    status();
    while (running) {
      snap();
      if (inBattle()) {
        if (!battle) {
          battle = { t: Date.now(), lv: (lead() || {}).level || 0 };
          const r = await battleStart(battle, new Set());
          if (r) { stop(r.msg, false, r.alert); break; }
        }
        // wild: run or fight as set; if running keeps failing (a trainer), fight
        const fight = cfg.navFight || Date.now() - battle.t > 15000;
        const m = await battleTick(battle, fight);
        if (m) { stop(m); break; }
        continue;
      }
      if (battle) {
        battle = null; path = null;
        const l = lead();
        if (l && l.hp * 100 < l.maxHP * cfg.hpStop) { stop(`HP ของ ${nameOf(l.species)} เหลือ ${l.hp}/${l.maxHP} — แวะรักษาก่อน แล้วกดเริ่มอีกครั้ง`); break; }
        await tap("B"); await tap("B");
        continue;
      }
      const p = where();
      const mi = p && MAPIDX[p.g * 256 + p.m], pm = mi !== undefined && MAPS[mi];
      // during screen transitions (battle intro, warps) the numbers can be half-updated: wait for them to settle
      if (!pm || p.x < 0 || p.y < 0 || p.x >= pm.w || p.y >= pm.h || (pm.tiles[p.y * pm.w + p.x] & 15) === T_WALL) { await waitF(10); continue; }
      if (goal(mi)) { stop(`ถึง ${pretty(cfg.dest)} แล้ว ✓`, false, true); break; }
      if (Date.now() - lastMove > 60000) { stop("เดินไม่ไปไหนมา 1 นาที — อาจติดเหตุการณ์ในเนื้อเรื่อง บอทหยุด"); break; }
      // no step closer to the goal for a while: something in the story or a tree/rock blocks every way
      if (path && path.length - 1 - i < best) { best = path.length - 1 - i; bestAt = Date.now(); }
      if (Date.now() - bestAt > 45000) {
        const where_ = pretty(pm.n);
        stop(`ไปต่อไม่ได้ที่ ${where_} (${p.x},${p.y}) — ทางถูกขวางด้วยคน ต้นไม้ (Cut) หรือก้อนหิน ต้องทำเนื้อเรื่อง/ใช้ HM ก่อน`);
        break;
      }
      // are we where the plan expects?
      if (path && i < path.length) {
        const s = path[i].s;
        if (s[0] !== mi || s[1] !== p.x || s[2] !== p.y) {
          const j = path.findIndex(q => q.s[0] === mi && q.s[1] === p.x && q.s[2] === p.y);
          if (j > i) i = j; else path = null;
        }
      }
      if (!path) {
        for (const [k, t] of blockedAt) if (Date.now() - t > 20000) { blocked.delete(k); blockedAt.delete(k); }   // people move on
        path = findPath(p, goal, blocked) || findPath(p, goal, blocked, false); i = 0;
        if (!path && blocked.size) { blocked.clear(); blockedAt.clear(); path = findPath(p, goal, blocked) || findPath(p, goal, blocked, false); }
        if (!path && ++noPath < 3) { await waitF(30); continue; }
        if (!path) { window.__navDbg = { p, blocked: [...blocked], npcs: npcs() }; console.warn('NAVFAIL ' + JSON.stringify(window.__navDbg)); stop(`หาทางไป ${pretty(cfg.dest)} ไม่เจอ (อาจต้องใช้ Surf/Cut หรือยังผ่านไม่ได้ในเนื้อเรื่อง)`); break; }
        noPath = 0; stats.last = `อีก ${path.length - 1} ก้าว`; status();
      }
      const step = path[i + 1];
      if (!step) { path = null; continue; }
      const before = JSON.stringify([mi, p.x, p.y]);
      // hold the direction until the player moves (a step is 16 frames; warps take longer)
      gm().simulateInput(0, K[step.d], 1);
      const lim = step.how === "warp" ? 70 : step.how === "jump" ? 40 : 22;
      let moved = false;
      for (let f = 0; f < lim && running; f += 4) {
        await waitF(4); snap();
        const q = where();
        if (inBattle() || (q && JSON.stringify([MAPIDX[q.g * 256 + q.m], q.x, q.y]) !== before)) { moved = true; break; }
      }
      gm().simulateInput(0, K[step.d], 0);
      if (moved) {
        fails = 0; lastMove = Date.now(); i++;
        if (step.how === "warp" || step.how === "edge") { await waitF(step.how === "warp" ? 40 : 4); path = null; best = 1e9; bestAt = Date.now(); }
        stats.last = `อีก ${Math.max(0, path ? path.length - 1 - i : 0)} ก้าว`; status();
      } else {
        // something in the way: a text box (story event, sign), a person, or the map differs from the data
        fails++;
        for (let k = 0; k < 3; k++) await tap("B", 4, 14);
        if (fails >= 4) {
          // treat that tile as blocked for a while and look for another way
          const s = step.s; if (window.__navTrace) console.warn('NAVBLOCK ' + JSON.stringify({ at: [mi, p.x, p.y, p.z], step: s, d: step.d, how: step.how })); blocked.add(s[0] + ":" + s[1] + ":" + s[2]); blockedAt.set(s[0] + ":" + s[1] + ":" + s[2], Date.now());
          path = null; fails = 0;
        }
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
        <div class="segb" id="botMode"><button data-v="grind">ฟาร์มเลเวล</button><button data-v="hunt">ล่า Shiny</button><button data-v="nav">นำทาง</button></div>
        <div id="botWalk">
          <div class="note">ยืนในพงหญ้าก่อนกดเริ่ม บอทจะเดินไปมา และ<b>หยุดทันทีเมื่อเจอ Shiny</b> ทุกโหมด</div>
          <div>เดินไปมา</div>
          <div class="segb" id="botDir"><button data-v="LR">ซ้าย ↔ ขวา</button><button data-v="UD">ขึ้น ↕ ลง</button></div>
          <label class="row">จำนวนก้าวต่อฝั่ง <input type="number" id="botSteps" min="1" max="6"></label>
        </div>
        <div id="botNav">
          <div>ไปที่</div>
          <input id="botDest" list="botPlaces" placeholder="พิมพ์ชื่อ เช่น Cherrygrove, Violet Gym, Pokémon Center" style="width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:0;background:#2b2740;color:#fff;font:inherit;margin:6px 0">
          <datalist id="botPlaces"></datalist>
          <div class="note" id="botDestNote"></div>
          <div>เจอโปเกมอนป่าระหว่างทาง</div>
          <div class="segb" id="botNavFight"><button data-v="0">หนี</button><button data-v="1">สู้ด้วยท่าที่เลือก</button></div>
          <div class="note">เทรนเนอร์หนีไม่ได้ บอทจะสู้ด้วยท่าที่เลือกด้านล่าง ถ้าเจอเหตุการณ์ในเนื้อเรื่องหรือทางที่ต้องใช้ Surf/Cut บอทจะหยุดให้คุณเล่นต่อ</div>
        </div>
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
    seg("botMode", "mode", () => { ui(); if (cfg.mode === "nav") fillPlaces(); }); seg("botDir", "dir");
    const nf = el("botNavFight"), paintNf = () => [...nf.children].forEach(x => x.classList.toggle("sel", (cfg.navFight ? "1" : "0") === x.dataset.v));
    nf.onclick = e => { const v = e.target.dataset && e.target.dataset.v; if (v == null) return; cfg.navFight = v === "1"; saveCfg(); paintNf(); }; paintNf();
    el("botDest").value = cfg.dest ? pretty(cfg.dest) : "";
    el("botDest").oninput = e => {
      const v = e.target.value.trim().toLowerCase();
      const hit = MAPS && MAPS.find(m => m && (pretty(m.n).toLowerCase() === v || m.n.toLowerCase() === v));
      if (hit) { cfg.dest = hit.n; saveCfg(); }
      el("botDestNote").textContent = hit ? "✓ " + pretty(hit.n) : (v ? "เลือกจากรายการที่ขึ้นมา" : "");
    };
    const num = (id, key, lo, hi) => { const i = el(id); i.value = cfg[key]; i.onchange = () => { cfg[key] = Math.max(lo, Math.min(hi, +i.value || 0)); i.value = cfg[key]; saveCfg(); }; };
    num("botSteps", "steps", 1, 6); num("botHp", "hpStop", 0, 95); num("botLv", "lvStop", 0, 100);
    const chk = (id, key) => { const i = el(id); i.checked = !!cfg[key]; i.onchange = () => { cfg[key] = i.checked; saveCfg(); }; };
    chk("botFast", "fast"); chk("botLearn", "stopLearn");
    el("botTargets").value = cfg.targets; el("botTargets").oninput = e => { cfg.targets = e.target.value; saveCfg(); };
    el("botPill").onclick = () => { el("botPanel").hidden = !el("botPanel").hidden; if (!el("botPanel").hidden) { refreshMoves(); if (cfg.mode === "nav") fillPlaces(); } ui(); };
    el("botX").onclick = () => { el("botPanel").hidden = true; };
    el("botGo").onclick = () => { if (running) stop("หยุดบอทแล้ว"); else { el("botPanel").hidden = true; start(); } };
    el("botMsg").onclick = () => { el("botMsg").hidden = true; };
    ui();
  }
  function fillPlaces() {
    loadMaps().then(() => {
      const dl = el("botPlaces"); if (dl.children.length) return;
      // towns, routes, caves and the main buildings (skip houses and back rooms to keep the list short)
      const skip = /House|Room|Backroom|Underwater|Frlg|_B\dF_|Unused|Test|Debug|Elevator/;
      dl.innerHTML = MAPS.filter(m => m && !skip.test(m.n)).map(m => `<option value="${pretty(m.n)}">`).join("");
      el("botDest").dispatchEvent(new Event("input"));
    }).catch(() => {});
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
    el("botGrind").hidden = cfg.mode === "hunt"; el("botHunt").hidden = cfg.mode !== "hunt";
    el("botNav").hidden = cfg.mode !== "nav"; el("botWalk").hidden = cfg.mode === "nav";
    el("botGo").textContent = running ? "■ หยุดบอท" : "▶ เริ่มบอท";
    el("botGo").classList.toggle("stop", running);
    el("botPill").classList.toggle("on", running);
    status();
  }
  function status() {
    if (typeof el !== "function") return;
    const mins = stats.started ? Math.round((Date.now() - stats.started) / 60000) : 0;
    el("botPill").textContent = running ? (cfg.mode === "nav" ? `🧭 ${stats.last || "นำทาง"}` : `🤖 ${cfg.mode === "grind" ? "ฟาร์ม" : "ล่า"} · ${stats.enc}`) : "🤖 บอท";
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
      const base = BASE = (dataPath || "").replace(/data\/?$/, "");
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
    _debug: { snap, locate, mon, enemy, lead, inBattle, where, npcs, loadMaps, findPath, get MAPS() { return MAPS; }, get MAPIDX() { return MAPIDX; }, get addr() { return addr; } },
  };
})();
