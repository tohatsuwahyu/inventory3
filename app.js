
/* =========================================================
 * app.js — Inventory (GAS backend)
 * =======================================================*/
(function () {
  "use strict";

  // Helpers
  const $  = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const fmt = (n) => new Intl.NumberFormat("ja-JP").format(Number(n || 0));
  const isMobile = () => /Android|iPhone|iPad/i.test(navigator.userAgent);
  function toast(msg) { alert(msg); }
  function ensure(x, msg) { if (!x) throw new Error(msg || "Assertion failed"); return x; }

  // Escape
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));
  }
  function escapeAttr(s){ return escapeHtml(s); }

  // CSV helper: paksa Excel baca UTF-8 + JP header OK
  function downloadCSV_JP(filename, csv){
    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    // bebaskan memori
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // File helpers
  function sanitizeFilename(name){ return String(name || "").replace(/[\\/:*?"<>|]/g, "_"); }
  function normalizeCodeDash(s){ return String(s || "").replace(/[\u2212\u2010-\u2015\uFF0D]/g, "-").trim(); }
  function safeId(s){ return String(s||"").replace(/[^a-zA-Z0-9_-]/g, "_"); }

  // Global caches
  let _ITEMS_CACHE = [];

  function setLoading(show, text) {
    const el = $("#global-loading"); if (!el) return;
    if (show) { el.classList.remove("d-none"); $("#loading-text").textContent = text || "読み込み中…"; }
    else el.classList.add("d-none");
  }

 /* === API helper (timeout + retry + pesan error jelas) === */
 async function api(action, opts = {}) {
   // timeout & retry agak longgar di jaringan seluler
   const { method = 'GET', body = null, silent = false, timeout = 20000, retry = 2 } = opts;
  if (!window.CONFIG || !CONFIG.BASE_URL) throw new Error('config.js BASE_URL belum di-set');

  const apikey = encodeURIComponent(CONFIG.API_KEY || '');
  const url = `${CONFIG.BASE_URL}?action=${encodeURIComponent(action)}&apikey=${apikey}&_=${Date.now()}`;
  if (!silent) setLoading(true);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort('timeout'), timeout);

  try {
    const init = (method === 'GET')
      ? { mode: 'cors', cache: 'no-cache', signal: ctrl.signal, headers: { 'Accept': 'application/json' } }
      : {
          method: 'POST', mode: 'cors', signal: ctrl.signal,
                 // Pakai text/plain supaya tidak preflight (OPTIONS) → menghindari "Failed to fetch" di HP
         headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Accept': 'application/json' },
         body: JSON.stringify({ ...(body || {}), apikey: CONFIG.API_KEY })
        };

    const res = await fetch(url, init);
    const ctype = res.headers.get('content-type') || '';

    // jika status bukan 2xx → lempar error dengan detail
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`[${res.status}] ${res.statusText}${txt ? ' — ' + txt.slice(0, 160) : ''}`);
    }

    // parse aman
    if (ctype.includes('application/json')) {
      return await res.json();
    } else {
      const txt = await res.text();
      // Apps Script kadang kirim 'OK' sederhana → kembalikan bentuk seragam
      if (txt.trim().toUpperCase() === 'OK') return { ok: true };
      throw new Error(`Unexpected response (non‑JSON): ${txt.slice(0, 160)}`);
    }
  } catch (e) {
    const offline   = !navigator.onLine;
   const looksLikeCors = /Failed to fetch|NetworkError|TypeError/i.test(String(e && (e.message || e)));
    const isTimeout = e?.name === 'AbortError' || e === 'timeout' || /time(out)?/i.test(e?.message||'');
    const pretty = offline
      ? 'オフラインです。通信状況をご確認ください。'
    : (isTimeout ? 'タイムアウトしました。電波を確認してください。'
                  : (looksLikeCors ? '通信に失敗しました（ネットワーク／CORS）。電波やWi‑Fiを確認の上、再実行してください。'
                                   : (e?.message || 'Failed to fetch')));

    if (retry > 0) {
      await new Promise(r => setTimeout(r, 800));
      return api(action, { ...opts, retry: retry - 1 });
    }
    throw new Error(pretty);
  } finally {
    clearTimeout(t);
    if (!silent) setLoading(false);
  }
}


  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if ([...document.scripts].some(s => s.src === src || s.src.endsWith(src))) return resolve();
      const s = document.createElement("script");
      s.src = src; s.async = true; s.crossOrigin = "anonymous";
      s.onload = () => resolve(); s.onerror = () => reject(new Error("Gagal memuat: " + src));
      document.head.appendChild(s);
    });
  }

  async function ensureQRCode() {
    if (window.QRCode) return;
    const locals = ["./qrlib.js", "./qrcode.min.js", "./vendor/qrcode.min.js"];
    for (const p of locals) { try { await loadScriptOnce(p); if (window.QRCode) return; } catch (e) {} }
    const cdns = [
      "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js",
      "https://unpkg.com/qrcodejs@1.0.0/qrcode.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"
    ];
    for (const u of cdns) { try { await loadScriptOnce(u); if (window.QRCode) return; } catch (e) {} }
    throw new Error("QRCode library tidak tersedia (qrlib.js)");
  }

  async function ensureHtml5Qrcode() {
    if (window.Html5Qrcode) return;
    const locals = ["./html5-qrcode.min.js", "./vendor/html5-qrcode.min.js"];
    for (const p of locals) { try { await loadScriptOnce(p); if (window.Html5Qrcode) return; } catch (e) {} }
    const cdns = [
      "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/minified/html5-qrcode.min.js",
      "https://unpkg.com/html5-qrcode@2.3.8/minified/html5-qrcode.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/minified/html5-qrcode.min.js"
    ];
    for (const u of cdns) { try { await loadScriptOnce(u); if (window.Html5Qrcode) return; } catch (e) {} }
    throw new Error("html5-qrcode tidak tersedia");
  }

  function getCurrentUser() { try { return JSON.parse(localStorage.getItem("currentUser") || "null"); } catch (e) { return null; } }
  function setCurrentUser(u) { localStorage.setItem("currentUser", JSON.stringify(u || null)); }
  function logout() { setCurrentUser(null); location.href = "index.html"; }
  function isAdmin() { return (getCurrentUser()?.role || "user").toLowerCase() === "admin"; }

  // --- User hydrator & sync ---
  function readCookie(name){
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g,'\\$1') + '=([^;]*)'));
    try { return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; }
  }
  function hydrateCurrentUser(){
    const keys = ["currentUser","authUser","user","loggedInUser","me"];
    for (const k of keys){
      const v = localStorage.getItem(k);
      if (v){ try { const o = JSON.parse(v); if (o && o.id){ setCurrentUser(o); return o; } } catch (e) {} }
    }
    for (const k of keys){
      const v = sessionStorage.getItem(k);
      if (v){ try { const o = JSON.parse(v); if (o && o.id){ setCurrentUser(o); return o; } } catch (e) {} }
    }
    const ck = readCookie("currentUser");
    if (ck){ try { const o = JSON.parse(ck); if (o && o.id){ setCurrentUser(o); return o; } } catch (e) {} }
    if (window.CURRENT_USER && window.CURRENT_USER.id){ setCurrentUser(window.CURRENT_USER); return window.CURRENT_USER; }
    if (window.CONFIG && CONFIG.DEFAULT_USER && CONFIG.DEFAULT_USER.id){
      setCurrentUser(CONFIG.DEFAULT_USER);
      return CONFIG.DEFAULT_USER;
    }
    return null;
  }
  window.addEventListener("storage", (e) => {
    if (e.key === "currentUser") { updateWelcomeBanner(); }
  });

  // === PATCH: print semua label (A4 panjang, 1 label per "halaman") ===
  function bindPrintAllLabels(){
    const btn =
      document.getElementById('btn-items-print-all') ||
      document.getElementById('btn-print-all-labels') ||
      document.querySelector('[data-action="print-all-labels"]') ||
      Array.from(document.querySelectorAll('#view-items .items-toolbar button, #view-items .items-toolbar .btn'))
           .find(b => /全件ラベルを印刷/.test((b.textContent||'').trim()));
    if (!btn) return;

   btn.addEventListener('click', async ()=>{
      try{
        btn.disabled = true;
        const orig = btn.textContent;
        btn.textContent = '生成中...';

        if (!_ITEMS_CACHE.length) {
          const listAll = await api('items', { method:'GET' });
          _ITEMS_CACHE = Array.isArray(listAll) ? listAll : (listAll?.data || []);
        }

        const w = window.open('', '_blank', 'width=1024,height=700');
        if (!w) { alert('ポップアップがブロックされました。'); btn.disabled=false; btn.textContent=orig; return; }

        w.document.write('<meta charset="utf-8">');
        w.document.write('<title>全件ラベル</title>');
        w.document.write('<style>body{font-family:sans-serif;padding:8mm;} img{width:100%;max-width:100%;display:block;margin:6mm auto;} @media print{img{page-break-inside:avoid;}}</style>');
        w.document.write('<h3>全件ラベル</h3>');

        for (let i = 0; i < _ITEMS_CACHE.length; i++) {
          const it = _ITEMS_CACHE[i];
          const url = await makeItemLabelDataURL(it);
          w.document.write(`<img src="${url}" alt="${(it.code||'')}" />`);
          if (i % 20 === 0) { // kecilkan tekanan main thread
            await new Promise(r => requestAnimationFrame(r));
          }
        }
        w.document.close();
        w.focus();
        setTimeout(()=>{ try{ w.print(); }catch(e){} }, 600);

        btn.textContent = orig;
        btn.disabled = false;
      }catch(e){
        alert('印刷用ラベルの生成に失敗しました。');
        try{ btn.disabled=false; }catch(_){}
      }
    });
  }

  /* -------------------- Sidebar + Router -------------------- */
 
// --- Helper: ambil array baris dari berbagai bentuk respons API
function pickRows(raw) {
  if (Array.isArray(raw)) return raw;

  // Langsung cek properti umum
  for (const k of [
    'rows', 'history', 'data', 'logs', 'list',
    'items', 'values', 'users', 'series' ]) {
    const v = raw?.[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && Array.isArray(v.rows)) return v.rows; // bentuk nested: {data:{rows:[]}}
  }

  // Beberapa backend mengirim {ok:true, result:[...]} / {ok:true, result:{rows:[...]}}
  const r = raw?.result || raw?.payload || raw?.body;
  if (Array.isArray(r)) return r;
  if (r && typeof r === 'object' && Array.isArray(r.rows)) return r.rows;

  return [];
}
function setTextSafe(selector, value) {
  const el = document.querySelector(selector);
  if (!el) return;          // kalau tidak ada, jangan bikin error
  el.textContent = value;
}

  /* -------------------- Dashboard -------------------- */
  // Palet warna untuk chart (IN / OUT)
  const CHART_COLORS = {
    in: {
      border: "rgba(59,130,246,1)",   // biru
      fill:   "rgba(59,130,246,0.16)"
    },
    out: {
      border: "rgba(244,63,94,1)",    // merah
      fill:   "rgba(244,63,94,0.20)"
    }
  };

  let chartLine = null, chartPie = null;
  async function renderDashboard() {
    const who = getCurrentUser();
    if (who) {
      setTextSafe("#who", `${who.name || who.id || "user"} (${who.id} | ${who.role || "user"})`);
    }

    try {
      const [itemsRaw, usersRaw, seriesRaw, historyRaw] = await Promise.all([
        api("items",             { method: "GET", silent: true }).catch(() => []),
        api("users",             { method: "GET", silent: true }).catch(() => []),
        api("statsMonthlySeries",{ method: "GET", silent: true }).catch(() => []),
        api("history",           { method: "GET", silent: true }).catch(() => [])
      ]);

      // ==== NORMALISASI RESPON PERSIS SEPERTI renderItems() ====
      const norm = (raw, key) => {
        if (Array.isArray(raw)) return raw;
        if (Array.isArray(raw?.data))  return raw.data;
        if (key && Array.isArray(raw?.[key])) return raw[key];
        const rows = pickRows(raw);
        return Array.isArray(rows) ? rows : [];
      };

      const items   = norm(itemsRaw);        // pakai aturan yg sama dg renderItems
      const users   = norm(usersRaw, "users");
      const series  = norm(seriesRaw, "series");
      const history = norm(historyRaw, "history");

      // isi cache kalau kosong
      if (items.length && !_ITEMS_CACHE.length) {
        _ITEMS_CACHE = items.slice();
      }

      // ==== METRIK KARTU ATAS ====
      const totalItems = items.length;

      let low = 0;
      for (const it of items) {
        const stock = Number(it.stock || 0);
        const min   = Number(it.min   || 0);
        if (stock <= min) low++;
      }

      const userCount = users.length;

      setTextSafe("#metric-items", fmt(totalItems));   // アイテム数
setTextSafe("#metric-below", fmt(low));         // 最小在庫以下
setTextSafe("#metric-users", fmt(userCount));   // ini sudah benar, biarkan
      // ==== 直近30日 取引件数 ====
      const now   = new Date();
      const limit = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      let count30 = 0;
      for (const h of history) {
        const raw = h.timestamp || h.date || h.datetime || "";
        if (!raw) continue;
        let dt = raw instanceof Date ? raw : new Date(String(raw).replace(" ", "T"));
        if (isNaN(dt)) continue;
        if (dt >= limit && dt <= now) count30++;
      }
     
setTextSafe("#metric-trx", fmt(count30));   // isi angka besar di kartu

const days = 30;
const avg  = days ? (count30 / days) : 0;
setTextSafe("#metric-trx-badge", `平均 ${avg.toFixed(1)}件/日`);  // isi badge kecil

            // ==== CHART SUBTITLES (リングサマリ) ====
      // Line chart → pakai data bulan terbaru
      const latest = series.length ? series[series.length - 1] : null;
      if (latest) {
        const inLast  = Number(latest.in  || 0);
        const outLast = Number(latest.out || 0);
        const label   = latest.month || "";
        setTextSafe(
          "#chart-monthly-sub",
          `${label}：IN ${fmt(inLast)}件 ／ OUT ${fmt(outLast)}件`
        );
      } else {
        setTextSafe("#chart-monthly-sub", "データがありません");
      }

      // Pie chart → juga pakai bulan terbaru (当月比率)
      const lastForPie = series.length ? series[series.length - 1] : null;
      if (lastForPie) {
        const inCur  = Number(lastForPie.in  || 0);
        const outCur = Number(lastForPie.out || 0);
        const sumCur = inCur + outCur;

        if (sumCur > 0) {
          const pIn  = Math.round((inCur  * 100) / sumCur);
          const pOut = 100 - pIn;
          setTextSafe(
            "#chart-pie-sub",
            `IN ${fmt(inCur)}件 (${pIn}%) ／ OUT ${fmt(outCur)}件 (${pOut}%)`
          );
        } else {
          setTextSafe("#chart-pie-sub", "当月のデータがありません");
        }
      } else {
        setTextSafe("#chart-pie-sub", "当月のデータがありません");
      }

      // ==== LINE CHART ====
      // (kode line chart lama kamu tetap, tidak perlu diubah)

      // ==== LINE CHART ====
          // ==== LINE CHART (月次 IN / OUT) ====
      const ctx1 = $("#chart-monthly");
      if (ctx1 && window.Chart) {
        chartLine?.destroy();

        const labels = series.map(s => s.month || "");
        const dataIn  = series.map(s => Number(s.in  || 0));
        const dataOut = series.map(s => Number(s.out || 0));

        chartLine = new Chart(ctx1, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                label: "IN",
                data: dataIn,
                borderColor: CHART_COLORS.in.border,
                backgroundColor: CHART_COLORS.in.fill,
                borderWidth: 2,
                fill: true,
                tension: 0.35,
                pointRadius: 3,
                pointHoverRadius: 5,
              },
              {
                label: "OUT",
                data: dataOut,
                borderColor: CHART_COLORS.out.border,
                backgroundColor: CHART_COLORS.out.fill,
                borderWidth: 2,
                fill: true,
                tension: 0.35,
                pointRadius: 3,
                pointHoverRadius: 5,
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
              mode: "index",
              intersect: false
            },
            plugins: {
              legend: {
                position: "top",
              },
              tooltip: {
                callbacks: {
                  label(ctx) {
                    const v = ctx.parsed.y || 0;
                    return `${ctx.dataset.label}: ${fmt(v)} 件`;
                  }
                }
              }
            },
            scales: {
              x: {
                grid: {
                  display: false
                }
              },
              y: {
                beginAtZero: true,
                grid: {
                  color: "rgba(148,163,184,0.25)"
                },
                ticks: {
                  callback(value) { return fmt(value); }
                }
              }
            }
          }
        });
      }


      // ==== PIE CHART ====
           // ==== PIE CHART (当月 IN vs OUT) ====
      const ctx2 = $("#chart-pie");
      if (ctx2 && window.Chart) {
        chartPie?.destroy();

        const last = series.length ? series[series.length - 1] : { in: 0, out: 0 };
        const totalIn  = Number(last.in  || 0);
        const totalOut = Number(last.out || 0);
        const sum = totalIn + totalOut || 1;

        chartPie = new Chart(ctx2, {
          type: "pie",
          data: {
            labels: ["IN", "OUT"],
            datasets: [{
              data: [totalIn, totalOut],
              backgroundColor: [CHART_COLORS.in.fill, CHART_COLORS.out.fill],
              borderColor: [CHART_COLORS.in.border, CHART_COLORS.out.border],
              borderWidth: 2,
              hoverOffset: 8
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: "right",
              },
              tooltip: {
                callbacks: {
                  label(ctx) {
                    const v = ctx.parsed || 0;
                    const pct = ((v * 100) / sum).toFixed(1);
                    return `${ctx.label}: ${fmt(v)} 件 (${pct}%)`;
                  }
                }
              }
            }
          }
        });
      }

      // ==== 当月 入出庫ランキング（TOP20） ==== (bagian ini sama seperti sebelumnya)
      const rankTbody = $("#tbl-rank-month");
      if (rankTbody) {
        const now   = new Date();
        const year  = now.getFullYear();
        const month = now.getMonth(); // 0-based

        const labelEl = $("#rank-month-label");
        if (labelEl) {
          labelEl.textContent = `${year}年${month + 1}月`;
        }

        const agg = new Map();
        for (const h of history || []) {
          const rawDate = h.timestamp || h.date || h.datetime || "";
          if (!rawDate) continue;

          let dt = rawDate instanceof Date ? rawDate : new Date(String(rawDate).replace(" ", "T"));
          if (!dt || isNaN(dt)) continue;
          if (dt.getFullYear() !== year || dt.getMonth() !== month) continue;

          const code = String(h.code || "").trim();
          const name = String(h.itemName || h.name || "").trim();
          const qty  = Number(h.qty || h.quantity || 0) || 0;
          if (!code && !name) continue;
          if (!qty) continue;

          const key = `${code}||${name}`;
          const cur = agg.get(key) || { code, name, total: 0 };
          cur.total += Math.abs(qty);
          agg.set(key, cur);
        }

        const rows = Array.from(agg.values())
          .filter(r => r.total > 0)
          .sort((a, b) => b.total - a.total)
          .slice(0, 20);

        if (!rows.length) {
          rankTbody.innerHTML = `
            <tr>
              <td colspan="3" class="text-center text-muted py-3">
                当月の入出庫データがありません
              </td>
            </tr>`;
        } else {
          rankTbody.innerHTML = rows.map((r, index) => {
            const rank = index + 1;

            let icon  = "bi-award";
            let badge = "bg-light text-muted";
            if (rank === 1) { icon = "bi-trophy-fill"; badge = "bg-warning text-dark"; }
            else if (rank === 2) { icon = "bi-trophy-fill"; badge = "bg-secondary"; }
            else if (rank === 3) { icon = "bi-trophy-fill"; badge = "bg-info"; }

            return `
              <tr>
                <td class="text-center align-middle">
                  <span class="badge ${badge}">
                    <i class="bi ${icon} me-1"></i>${rank}
                  </span>
                </td>
                <td class="align-middle">
                  <div class="small text-muted">${escapeHtml(r.code || "")}</div>
                  <div class="fw-semibold">${escapeHtml(r.name || "")}</div>
                </td>
                <td class="text-end align-middle">
                  <span class="fw-semibold">${fmt(r.total)}</span>
                </td>
              </tr>`;
          }).join("");
        }
      }

      $("#btn-export-mov")?.addEventListener("click", () => {
        const heads = ["月","IN","OUT"];
        const csv = [heads.join(",")]
          .concat(series.map(s => [s.month, s.in || 0, s.out || 0].join(",")))
          .join("\n");
        downloadCSV_JP("月次INOUT.csv", csv);
      }, { once: true });

    } catch (e) {
      console.error("renderDashboard()", e);
      toast("ダッシュボードの読み込みに失敗しました。");
    }
  }

  // --- GANTI fungsi lama updateWelcomeBanner ---
  function updateWelcomeBanner() {
    const who = getCurrentUser();
    const nama = who?.name || who?.id || "ユーザー";
    const roleRaw = (who?.role || "user").toLowerCase();
    const roleJP  = roleRaw === "admin" ? "管理者" : "ユーザー";
document.body.classList.toggle("is-admin", roleRaw === "admin");
    const banner = document.getElementById("welcome-banner");
    if (banner) {
      banner.innerHTML = `ようこそ、<b>${escapeHtml(nama)}</b> さん。<span class="badge-soft" style="margin-left:.4rem">${roleJP}</span>
        <span class="text-muted small">端末、電源、電波確認しましょう。</span>`;
    }
    const welName = document.getElementById("wel-name");
    if (welName) { welName.textContent = `${nama}（${roleJP}）`; }
    const whoEl = document.getElementById("who");
    if (whoEl) {
      const id = who?.id || "";
      const role = who?.role || "user";
      whoEl.textContent = `${nama} (${id} | ${role})`;
    }
  }

  // === Live reload (user-configurable) ===
  const LIVE_KEY = "liveRefreshSec";
  let LIVE_TIMER = null;
  let LIVE_SEC = Number(localStorage.getItem(LIVE_KEY) || "120");

  function setLiveRefresh(seconds){
    LIVE_SEC = Math.max(0, Number(seconds || 0));
    localStorage.setItem(LIVE_KEY, String(LIVE_SEC));
    startLiveReload();
  }
  function startLiveReload(){
    clearInterval(LIVE_TIMER);
    if (LIVE_SEC <= 0) return;
    LIVE_TIMER = setInterval(async () => {
      try {
        const active = document.querySelector("main section.active")?.id || "";
        api("items", { method: "GET", silent: true }).then(list => {
          _ITEMS_CACHE = Array.isArray(list) ? list : (list?.data || []);
        }).catch(()=>{});
        if (active === "view-dashboard")    renderDashboard();
        if (active === "view-history")      renderHistory();
        if (active === "view-shelf-list")   loadTanaList();
      } catch (e) {}
    }, LIVE_SEC * 1000);
  }

  /* -------------------- Items -------------------- */
  // ukuran tetap untuk tombol agar “操作” rapi & tidak terlalu lebar
const ACT_GRID_STYLE = [
  "display:grid;",
  "grid-template-columns:repeat(3,28px);",   // 3 tombol per baris
  "grid-auto-rows:28px;",                   // tinggi tiap baris
  "gap:4px;",                               // jarak antar tombol
  "justify-content:end;",
  "min-width:140px;"                        // lebih ramping
].join("");


  // alias agar tombol DL & bulk tidak error meski 62mm belum dibuat
  async function makeItemLabel62mmDataURL(item){ return await makeItemLabelDataURL(item); }

  // === PATCHED: tplItemRow: paksa cell aksi rata kanan & min-width ===
  function tplItemRow(it){
    const qrid  = `qr-${safeId(it.code)}`;
    const stock = Number(it.stock || 0);
    const min   = Number(it.min   || 0);

    const badge =
      (stock <= 0) ? '<span class="badge bg-secondary ms-1">ゼロ</span>' :
      (stock <= min) ? '<span class="badge bg-danger ms-1">要補充</span>' :
      '<span class="badge bg-success ms-1">OK</span>';

    const dept = it.department
      ? `<span class="badge rounded-pill text-bg-light">${escapeHtml(it.department)}</span>` : '';
    const loc  = it.location
      ? `<span class="badge rounded-pill bg-body-secondary">${escapeHtml(it.location)}</span>` : '';

    const actions = [
      `<button class="btn btn-sm btn-primary btn-edit" data-code="${escapeAttr(it.code)}" title="編集"><i class="bi bi-pencil-square"></i></button>`,
      `<button class="btn btn-sm btn-danger btn-del" data-code="${escapeAttr(it.code)}" title="削除"><i class="bi bi-trash3"></i></button>`,
      `<button class="btn btn-sm btn-outline-success btn-dl" data-code="${escapeAttr(it.code)}" title="ラベルDL"><i class="bi bi-download"></i></button>`,
      `<button class="btn btn-sm btn-outline-warning btn-lotqr" data-code="${escapeAttr(it.code)}" title="Lot QR"><i class="bi bi-qr-code"></i></button>`,
      `<button class="btn btn-sm btn-outline-secondary btn-preview" data-code="${escapeAttr(it.code)}" title="プレビュー"><i class="bi bi-search"></i></button>`
    ].join('');

    return [
      '<tr data-code="', escapeAttr(it.code), '">',
        '<td style="width:36px"><input type="checkbox" class="row-chk" data-code="', escapeAttr(it.code), '"></td>',
        '<td style="width:110px"><div class="tbl-qr-box"><div id="', qrid, '" class="d-inline-block"></div></div></td>',
        '<td>',
          '<div class="small text-muted">', escapeHtml(it.code), '</div>',
          '<div class="td-name">',
            '<a href="#" class="link-underline link-item" data-code="', escapeAttr(it.code), '">',
              escapeHtml(it.name),
            '</a>',
          '</div>',
        '</td>',
        '<td>', (it.img ? `<img src="${escapeAttr(it.img)}" alt="" style="height:32px">` : ''), '</td>',
        '<td class="text-end">¥', fmt(it.price), '</td>',
        '<td class="text-end">', fmt(stock), badge, '</td>',
        '<td class="text-end">', fmt(min), '</td>',
        '<td>', dept, '</td>',
        '<td>', loc, '</td>',
     '<td class="td-actions" style="text-align:right">',
  '<div class="act-grid actions" style="', ACT_GRID_STYLE, '">', // pakai grid 2 baris
    actions,
  '</div>',
'</td>',


  
      '</tr>'
    ].join('');
  }

  // === Mobile mini "操作" button renderer (HP only) ===
  function ensureMobileActions(){ /* disabled: no floating action bubble on mobile */ }


  // === HEADER & COLGROUP sinkron ke jumlah kolom body (kuat untuk TABLE/TBODY) ===
  function ensureItemsHeader() {
    const host = document.getElementById("tbl-items");
    if (!host) return;

    const table = host.tagName === "TABLE" ? host : host.closest("table");
    if (!table) return;
    table.classList.add('table','items-table');

    const tbody = host.tagName === "TBODY" ? host
                : (table.tBodies[0] || table.querySelector("tbody") || table.createTBody());

    const thead = table.tHead || table.createTHead();
    const tr    = thead.rows[0] || thead.insertRow();

    const sample = tbody.querySelector("tr[data-code], tbody tr") || null;
    const bodyCols = sample ? sample.children.length : 10;

    const defaultHeads = ["", "QR", "コード / 名称", "画像", "価格", "在庫", "最小", "部門", "置場", "操作"];

    while (tr.children.length < bodyCols) {
      const th = document.createElement("th");
      const i = tr.children.length;
      th.textContent = defaultHeads[i] ?? "";
      tr.appendChild(th);
    }
    while (tr.children.length > bodyCols) tr.lastElementChild.remove();

    if (tr.children.length) {
      const last = tr.children[tr.children.length - 1];
      last.textContent = "操作";
      last.style.minWidth = "150px";
      last.style.textAlign = "right";
    }
  }

  function ensureItemsColgroup() {
    const host = document.getElementById("tbl-items");
    if (!host) return;

    const table = host.tagName === "TABLE" ? host : host.closest("table");
    if (!table) return;

    const tbody = host.tagName === "TBODY" ? host
                : (table.tBodies[0] || table.querySelector("tbody") || table.createTBody());

    const sample = tbody.querySelector("tr[data-code], tbody tr") || null;
    const bodyCols = sample ? sample.children.length : 10;

    table.querySelectorAll("colgroup").forEach(cg => cg.remove());

    const widths = [
  "36px",    // checkbox
  "110px",   // QR
  "320px",   // コード/名称  <-- kasih ruang
  "72px",    // 画像
  "110px",   // 価格
  "120px",   // 在庫
  "100px",   // 最小
  "120px",   // 部門
  "120px",   // 置場 (boleh 100–140)
  "150px"    // 操作
];


    const cg = document.createElement("colgroup");
    for (let i = 0; i < bodyCols; i++) {
      const col = document.createElement("col");
      if (widths[i]) col.style.width = widths[i];
      cg.appendChild(col);
    }
    table.insertBefore(cg, table.firstChild);
  }

  async function renderItems(){
    const tbody = $("#tbl-items");
    if (!tbody) return;

    if (CONFIG.FEATURES && CONFIG.FEATURES.SKELETON) {
      tbody.innerHTML = '<tr><td colspan="10"><div class="skel" style="height:120px"></div></td></tr>';
      setupTopScrollbar();
    }

    try {
      const listAll = await api("items", { method: "GET" });
      _ITEMS_CACHE = Array.isArray(listAll) ? listAll
                    : (Array.isArray(listAll?.data) ? listAll.data : []);

      let page = 0, size = 100;

      const getNum = (td) => {
        const m = (td?.textContent || "").match(/-?\d+(?:\.\d+)?/);
        return Number(m ? m[0] : 0);
      };
      const highlightLow = () => {
        $$("#tbl-items tr").forEach(tr => {
          const stock = getNum(tr.children[5]);
          const min   = getNum(tr.children[6]);
          tr.classList.toggle("row-low", stock <= min);
        });
      };

      async function renderPage(){
        const slice = _ITEMS_CACHE.slice(page*size, (page+1)*size);

        if (page === 0) {
          tbody.innerHTML = slice.map(tplItemRow).join("");
        } else {
          tbody.insertAdjacentHTML("beforeend", slice.map(tplItemRow).join(""));
        }

        page++;

        highlightLow();

        try { await ensureQRCode(); } catch(_) {}
        renderRowQRCodes(slice);

        

        // ⬇ selalu sinkronkan header & colgroup setelah render halaman
        ensureItemsHeader();
        ensureItemsColgroup();
        queueMicrotask(() => { ensureItemsHeader(); ensureItemsColgroup(); });

        // --- sinkronisasi top scrollbar setiap selesai render halaman
        setupTopScrollbar();
        if (typeof window.__resyncTopScroll === "function") window.__resyncTopScroll();
      }

      await renderPage();

      if (_ITEMS_CACHE.length > size) {
        const more = document.createElement("div");
        more.className = "text-center my-3";
        more.innerHTML = '<button id="btn-load-more" class="btn btn-outline-secondary btn-sm">Load more</button>';
        // taruh di luar <table>, ideal di wrapper horizontal yang memang ada di CSS
        const table = tbody.closest('table');
        const host  = document.getElementById('items-table-wrap') || table?.parentElement || document.body;
        host.appendChild(more);  // tampil setelah tabel, masih di dalam wrapper

        more.addEventListener("click", async (e)=>{
          e.preventDefault();
          await renderPage();
          // setelah nambah baris, resync
          if (typeof window.__resyncTopScroll === "function") window.__resyncTopScroll();
          if (page*size >= _ITEMS_CACHE.length) more.remove();
        });
      }

    } catch (e) {
      console.error("renderItems()", e);
      toast("商品一覧の読み込みに失敗しました。");
    }

    // Delegasi klik untuk kolom 「操作」 — IKAT SEKALI
    if (!tbody.__bound) {
      tbody.addEventListener("click", async (ev)=>{
        const btn  = ev.target.closest("button");
        if (!btn) return;
        const code = btn.getAttribute("data-code");
        if (!code) return;

        const item = _ITEMS_CACHE.find(x => String(x.code) === String(code));

        if (btn.classList.contains("btn-edit")) { openEditItem(code); return; }

        if (btn.classList.contains("btn-del")) {
          if (!isAdmin()) return toast("Akses ditolak (admin only)");
          if (!confirm("削除してもよろしいですか？")) return;
          try{
            const r = await api("deleteItem", { method:"POST", body:{ code }});
            if (r?.ok) { toast("削除しました"); renderItems(); }
            else toast(r?.error || "削除失敗");
          }catch(e){ toast("削除失敗: " + (e?.message||e)); }
          return;
        }

        if (btn.classList.contains("btn-dl")) {
          if (!item) return;
          const url = await makeItemLabel62mmDataURL(item);
          const a = document.createElement("a");
          a.href = url; a.download = `label_${sanitizeFilename(item.code)}.png`; a.click();
          return;
        }

        if (btn.classList.contains("btn-lotqr")) {
          if (!item) return;
          openLotQRModal(item);
          return;
        }

        if (btn.classList.contains("btn-preview")) {
          if (!item) return;
          showItemPreview(item);
          return;
        }
      });
      tbody.__bound = true;
    }

    try{
  const th = tbody?.closest("table")?.querySelector("thead tr th:last-child");
  if (th) th.style.minWidth = "150px";
} catch{}


    try { bindPreviewButtons(); } catch(e) {}
  }

  // === render QR di tiap baris items ===
  function renderRowQRCodes(items){
    items = Array.isArray(items) ? items : [];
    for (const it of items){
      const qrid = 'qr-' + safeId(it.code);
      const el = document.getElementById(qrid);
      if (!el) continue;
      el.innerHTML = '';
      try {
        new QRCode(el, {
          text: 'ITEM|' + normalizeCodeDash(it.code),
          width: 64, height: 64,
          correctLevel: QRCode.CorrectLevel.M
        });
      } catch(e){}
    }
  }

  // ---------- LABEL CANVAS ----------
  async function makeItemLabelDataURL(item) {
    const W = 760, H = 260, pad = 18, imgW = 200, gap = 16;
    const QUIET = 16, qrSize = 136, gapQR = 14;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); g.imageSmoothingEnabled = false;

    g.fillStyle = "#fff"; g.fillRect(0, 0, W, H);
    g.strokeStyle = "#000"; g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, W - 1, H - 1);

    const rx = pad, ry = pad, rw = imgW, rh = H - 2 * pad, r = 18;
    roundRect(g, rx, ry, rw, rh, r, true, true, "#eaf1ff", "#cbd5e1");
    await drawImageIfAny(g, item.img, rx, ry, rw, rh, r);

    const colStart = pad + imgW + gap;
    const qy = pad + ((H - 2 * pad) - qrSize) / 2;
    const qx = colStart + gapQR + QUIET;
    g.fillStyle = "#fff";
    g.fillRect(qx - QUIET, qy - QUIET, qrSize + 2 * QUIET, qrSize + 2 * QUIET);
    try {
      const codeNorm = normalizeCodeDash(item.code);
      const du = await generateQrDataUrl(`ITEM|${codeNorm}`, qrSize);
      const im = new Image(); im.src = du; await imgLoaded(im);
      g.drawImage(im, qx, qy, qrSize, qrSize);
    } catch (e) {}

    const colQRW = qrSize + 2 * QUIET;
    const gridX  = colStart + gapQR + colQRW + gapQR;
    const cellH  = (H - 2 * pad) / 3;
    g.strokeStyle = "#000"; g.lineWidth = 1;
    g.strokeRect(gridX + 0.5, pad + 0.5, W - gridX - pad - 1, H - 2 * pad - 1);
    for (let i = 1; i <= 2; i++) {
      const y = pad + cellH * i;
      g.beginPath(); g.moveTo(gridX + 0.5, y + 0.5); g.lineTo(W - pad - 0.5, y + 0.5); g.stroke();
    }

    const labelWidth = 96;
    const labelX = gridX + 10;
    const valX   = gridX + 10 + labelWidth;
    const valMaxW = W - pad - valX - 10;

    const LBL_FONT = '600 14px "Noto Sans JP", system-ui';
    const VAL_WEIGHT = "700";

    const cells = [
      { title: "コード：",     value: String(item.code || ""),            base: 20, min: 11 },
      { title: "商品名：",     value: String(item.name || ""),            base: 22, min: 11 },
      { title: "部門／置場：", value: [item.department||"", item.location? "／"+String(item.location).toUpperCase():""].join(""), base: 18, min: 11 }
    ];

    cells.forEach((cell, i) => {
      const yTop = pad + i * cellH;
      g.font = LBL_FONT; g.fillStyle = "#000";
      const labelH = 14;
      const ly = yTop + (cellH - labelH) / 2;
      g.textBaseline = "top"; g.textAlign = "left";
      g.fillText(cell.title, labelX, Math.round(ly));

      drawWrapBoxVCenter(
        g, cell.value, valX, yTop + 4, valMaxW, cellH - 8,
        { base: cell.base, min: cell.min, lineGap: 3, weight: VAL_WEIGHT }
      );
    });

    return c.toDataURL("image/png");

    // helpers
    function roundRect(ctx, x, y, w, h, r, fill, stroke, fillColor, border) {
      ctx.save(); ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      if (fill)   { ctx.fillStyle = fillColor || "#eef"; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = border || "#000"; ctx.stroke(); }
      ctx.restore();
    }
    function imgLoaded(im){ return new Promise(res => { im.onload = res; im.onerror = res; }); }
    async function drawImageIfAny(ctx, url, x, y, w, h, rr){
      if (!url){
        ctx.save(); ctx.fillStyle="#3B82F6"; ctx.font='bold 28px "Noto Sans JP", system-ui';
        ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText("画像", x + w/2, y + h/2);
        ctx.restore(); return;
      }
      try{
        const im = new Image(); im.crossOrigin="anonymous"; im.src=url; await imgLoaded(im);
        const s = Math.min(w/im.width, h/im.height), iw = im.width*s, ih = im.height*s;
        const ix = x + (w - iw)/2, iy = y + (h - ih)/2;
        ctx.save(); ctx.beginPath();
        ctx.moveTo(x + rr, y); ctx.arcTo(x + w, y, x + w, y + h, rr);
        ctx.arcTo(x + w, y + h, x, y + h, rr); ctx.arcTo(x, y + h, x, y, rr);
        ctx.arcTo(x, y, x + w, y, rr); ctx.closePath(); ctx.clip();
        ctx.drawImage(im, ix, iy, iw, ih); ctx.restore();
      } catch (e) {}
    }

    function measureLines(ctx, text, maxW){
      const tokens = String(text ?? "").split(/(\s+)/);
      const lines = []; let line = "";
      const push = (tok) => {
        if (ctx.measureText(tok).width <= maxW) {
          const t = line + tok;
          if (!line || ctx.measureText(t).width <= maxW) line = t;
          else { lines.push(line.trim()); line = tok.trimStart(); }
        } else {
          for (const ch of Array.from(tok)) {
            const t = line + ch;
            if (!line || ctx.measureText(t).width <= maxW) line = t;
            else { lines.push(line.trim()); line = ch; }
          }
        }
      };
      tokens.forEach(push);
      if (line) lines.push(line.trim());
      return lines;
    }

    function drawWrapBoxVCenter(ctx, text, x, yTop, maxW, maxH, opt={}){
      const base = opt.base || 18, min = opt.min || 12, gap = opt.lineGap || 4;
      const fam  = '"Noto Sans JP", system-ui';
      const weight = opt.weight || "normal";
      let size = base, lines;
      while (true){
        ctx.font = `${weight} ${size}px ${fam}`;
        lines = measureLines(ctx, text, maxW);
        const totalH = lines.length * size + (lines.length - 1) * gap;
        if (totalH <= maxH || size <= min) break;
        size -= 1;
      }
      const totalH = lines.length * size + (lines.length - 1) * gap;
      let y = yTop + (maxH - totalH) / 2;
      ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillStyle = "#000";
      for (const ln of lines){
        ctx.fillText(ln, x, Math.round(y));
        y += size + gap;
        if (y - yTop > maxH) break;
      }
    }
  } // end makeItemLabelDataURL

  async function generateQrDataUrl(text, size) {
    await ensureQRCode();
    return await new Promise((resolve) => {
      const tmp = document.createElement("div");
      Object.assign(tmp.style, {
        position: "fixed", left: "-9999px", top: "0", width: size + "px", height: size + "px"
      });
      document.body.appendChild(tmp);

      new QRCode(tmp, { text, width: size, height: size, correctLevel: QRCode.CorrectLevel.M });

      const grab = () => {
        const node = tmp.querySelector("img,canvas");
        if (!node) return "";
        try { return node.tagName === "IMG" ? node.src : node.toDataURL("image/png"); }
        catch (e) { return ""; }
      };

      let tries = 0;
      (function waitRender() {
        const url = grab();
        if (url || tries >= 15) {
          document.body.removeChild(tmp);
          resolve(url || "");
          return;
        }
        tries++; setTimeout(waitRender, 60);
      })();
    });
  }

  // === LOT label (pakai layout item, QR diganti LOT + caption) ===
  async function makeLotLabelDataURL(item, qtyPerBox, lotId) {
    const base = await makeItemLabelDataURL(item);
    const im = new Image(); im.src = base;
    await new Promise(r => { im.onload = r; im.onerror = r; });

    const W = im.width, H = im.height;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"); g.imageSmoothingEnabled = false;

    g.drawImage(im, 0, 0);

    const pad = 18, imgW = 200, gap = 16;
    const QUIET = 16, qrSize = 136, gapQR = 14;
    const colStart = pad + imgW + gap;
    const qy = pad + ((H - 2 * pad) - qrSize) / 2;
    const qx = colStart + gapQR + QUIET;

    try {
      const codeNorm = normalizeCodeDash(item.code);
      const txt = lotId ? `LOT|${codeNorm}|${qtyPerBox}|${lotId}` : `LOT|${codeNorm}|${qtyPerBox}`;
      const du = await generateQrDataUrl(txt, qrSize);
      const qr = new Image(); qr.src = du;
      await new Promise(r => { qr.onload = r; qr.onerror = r; });
      g.fillStyle = "#fff"; g.fillRect(qx - QUIET, qy - QUIET, qrSize + 2 * QUIET, qrSize + 2 * QUIET);
      g.drawImage(qr, qx, qy, qrSize, qrSize);
    } catch (e) {}

    const capW = qrSize + 2 * QUIET;
    const capH = 40;
    const capX = colStart + gapQR;
    const capY = qy + qrSize + 6;

    g.fillStyle = "#ffffff";
    g.fillRect(capX, capY, capW, capH);
    g.strokeStyle = "#d1d5db";
    g.lineWidth = 1;
    g.strokeRect(capX + 0.5, capY + 0.5, capW - 1, capH - 1);

    g.fillStyle = "#111";
    g.textAlign = "center";
    g.textBaseline = "top";
    g.font = '700 14px "Noto Sans JP", system-ui';
    g.fillText(`箱あたり：${Number(qtyPerBox || 0)} pcs`, capX + capW / 2, capY + 6);

    if ((lotId || "").trim()) {
      g.font = '600 12px "Noto Sans JP", system-ui';
      g.fillStyle = "#374151";
      g.fillText(`ロット：${String(lotId)}`, capX + capW / 2, capY + 22);
    }

    return c.toDataURL("image/png");
  }

  /* -------------------- Users -------------------- */
  async function renderUsers() {
    try {
      const who = getCurrentUser();
      const list = await api("users", { method: "GET" });
      let arr = Array.isArray(list) ? list : (Array.isArray(list?.data) ? list.data : []);

      const admin = isAdmin();

      $("#btn-users-import")?.classList.toggle("d-none", !admin);
      $("#btn-users-export")?.classList.toggle("d-none", !admin);
      $("#btn-print-qr-users")?.classList.toggle("d-none", !admin);
      $("#btn-open-new-user")?.classList.toggle("d-none", !admin);

      if (!admin && who) {
        arr = arr.filter(u => String(u.id) === String(who.id));
      }

      const tbody = $("#tbl-userqr");
      tbody.innerHTML = arr.map(u => {
        const uidSafe = safeId(u.id);
        return `
        <tr>
          <td style="width:170px"><div id="uqr-${uidSafe}"></div></td>
          <td>${escapeHtml(u.id)}</td>
          <td>${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.role || "user")}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-success btn-dl-user" data-id="${escapeAttr(u.id)}" title="ダウンロード">
              <i class="bi bi-download"></i>
            </button>
          </td>
        </tr>`;
      }).join("");

      await ensureQRCode();
      for (const u of arr) {
        const el = document.getElementById(`uqr-${safeId(u.id)}`);
        if (!el) continue;
        el.innerHTML = ""; new QRCode(el, { text: `USER|${u.id}`, width: 64, height: 64, correctLevel: QRCode.CorrectLevel.M });
      }

      tbody.addEventListener("click", async (e) => {
        const b = e.target.closest(".btn-dl-user"); if (!b) return;
        const id = b.getAttribute("data-id");
        const url = await generateQrDataUrl(`USER|${id}`, 300);
        const a = document.createElement("a"); a.href = url; a.download = `user_${id}.png`; a.click();
      });

      const right = $("#print-qr-users-grid");
      if (right) {
        if (!admin && who) {
          right.innerHTML = `
            <div class="card p-3 w-100">
              <div class="fw-semibold mb-2">ユーザー情報</div>
              <div class="d-flex align-items-center gap-3">
                <div id="me-qr"></div>
                <div class="small">
                  <div><b>ID</b>：${escapeHtml(who.id || "")}</div>
                  <div><b>氏名</b>：${escapeHtml(who.name || "")}</div>
                  <div><b>ユーザー</b>：${escapeHtml(who.role || "user")}</div>
                  <div><b>PIN</b>：<span class="text-muted">（非表示）</span></div>
                </div>
              </div>
            </div>`;
          const box = document.getElementById("me-qr");
          if (box) { new QRCode(box, { text: `USER|${who.id}`, width: 120, height: 120 }); }
        } else {
          right.innerHTML = `<div class="text-muted small">印刷するユーザーQRを左の表から選択してダウンロードしてください。</div>`;
        }
      }
    } catch (e) { toast("ユーザーQRの読み込みに失敗しました。"); }
  }

  // New User (admin only)
  function openNewUser() {
    if (!isAdmin()) return toast("Akses ditolak (admin only)");
    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.innerHTML = `
<div class="modal-dialog">
  <div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">新規ユーザー</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <div class="row g-3">
        <div class="col-md-4"><label class="form-label">ID</label><input id="nu-id" class="form-control" placeholder="USER001"></div>
        <div class="col-md-5"><label class="form-label">氏名</label><input id="nu-name" class="form-control"></div>
        <div class="col-md-3"><label class="form-label">権限</label>
          <select id="nu-role" class="form-select"><option value="user">user</option><option value="admin">admin</option></select>
        </div>
      </div>
      <div class="small text-muted mt-2">PIN の設定は別途（GAS 側）で行ってください。</div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-bs-dismiss="modal">閉じる</button>
      <button class="btn btn-primary" id="nu-save">作成</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap); modal.show();
    $("#nu-save", wrap)?.addEventListener("click", async () => {
      const id = ($("#nu-id", wrap).value || "").trim();
      const name = $("#nu-name", wrap).value || "";
      const role = $("#nu-role", wrap).value || "user";
      if (!id) return toast("ID を入力してください。");
      try {
        const r = await api("upsertUser", { method: "POST", body: { id, name, role } });
        if (r?.ok) { modal.hide(); wrap.remove(); renderUsers(); toast("作成しました"); }
        else toast(r?.error || "作成失敗");
      } catch (e) { toast("作成失敗: " + (e?.message || e)); }
    });
    wrap.addEventListener("hidden.bs.modal", () => wrap.remove(), { once: true });
  }

  /* -------------------- History -------------------- */
/* -------------------- History -------------------- */
async function renderHistory() {
  try {
    const raw  = await api("history", { method: "GET" });
    const list = pickRows(raw);

    // TBODY: prioritaskan #tbl-history tbody; fallback: elemen #tbl-history itu sendiri
    const tbody =
      document.querySelector("#tbl-history tbody") ||
      document.getElementById("tbl-history");
    if (!tbody) { console.warn("Elemen #tbl-history tidak ditemukan"); return; }

    // Ambil role user sekarang
    const admin = isAdmin();

    // Ambil 400 terakhir (baru → atas)
    const recent = list.slice(-400).reverse();

    // Kosong → pesan ramah
    if (!recent.length) {
      tbody.innerHTML = `<tr><td colspan="${admin ? 10 : 9}" class="text-muted py-3 text-center">履歴はありません</td></tr>`;
      ensureViewAutoMenu("history", "#view-history .items-toolbar .right");

      // Sembunyikan header kolom 修正 untuk non-admin
      const table = tbody.closest("table") || document.querySelector("#tbl-history");
      const thLast = table?.querySelector("thead tr th:last-child");
      if (!admin && thLast) thLast.style.display = "none";
      return;
    }

    // 🔁 Build baris; simpan row nomor sheet di data-row
    tbody.innerHTML = recent.map(h => `
      <tr data-row="${h.row || ""}" data-code="${escapeAttr(h.code || "")}">
        <td>${escapeHtml(h.timestamp || h.date || h.datetime || "")}</td>
        <td>${escapeHtml(h.userId || h.user_id || "")}</td>
        <td>${escapeHtml(h.userName || h.user_name || h.user || "")}</td>
        <td>${escapeHtml(h.code || "")}</td>
        <td>${escapeHtml(h.itemName || h.name || "")}</td>
        <td class="text-end">${fmt(h.qty || h.quantity || 0)}</td>
        <td>${escapeHtml(h.unit || "")}</td>
        <td>${escapeHtml(h.type || h.kind || "")}</td>
        <td>${escapeHtml(h.note || h.remarks || "")}</td>
        ${admin ? `<td class="text-end">
          <button class="btn btn-sm btn-outline-primary btn-hist-fix" data-code="${escapeAttr(h.code||"")}">修正</button>
        </td>` : ""}
      </tr>
    `).join("");

    // Header 「修正」 disembunyikan untuk non-admin
    const table = tbody.closest("table") || document.querySelector("#tbl-history");
    const thLast = table?.querySelector("thead tr th:last-child");
    if (!admin && thLast) thLast.style.display = "none";

    // Jaga-jaga: untuk non-admin, sembunyikan juga seluruh sel terakhir di <tbody>
    if (!admin) table?.querySelectorAll("tbody tr td:last-child").forEach(td => td.style.display = "none");

    ensureViewAutoMenu("history", "#view-history .items-toolbar .right");

    // 🆕 Binding tombol 修正 → buka modal edit
    if (admin && !tbody.__histBound) {
      tbody.__histBound = true;
      tbody.addEventListener("click", (ev) => {
        const btn = ev.target.closest(".btn-hist-fix");
        if (!btn) return;
        ev.preventDefault();

        const tr = btn.closest("tr");
        if (!tr) return;

        const rowNo = Number(tr.getAttribute("data-row") || "0");
        if (!rowNo) return;

        const tds = tr.children;
        const dateText  = (tds[0]?.textContent || "").trim();
        const userId    = (tds[1]?.textContent || "").trim();
        const userName  = (tds[2]?.textContent || "").trim();
        const code      = (tds[3]?.textContent || "").trim();
        const itemName  = (tds[4]?.textContent || "").trim();
        const qtyText   = (tds[5]?.textContent || "").replace(/[,¥]/g, "").trim();
        const unitText  = (tds[6]?.textContent || "").trim();
        const typeText  = (tds[7]?.textContent || "").trim();
        const noteText  = (tds[8]?.textContent || "").trim();

        const currentQty   = Number(qtyText || 0) || 0;
        const currentType  = (String(typeText).toUpperCase() === "OUT") ? "OUT" : "IN";
        const currentUnit  = unitText || "pcs";

        openHistoryEditModal({
          row : rowNo,
          date: dateText,
          userId,
          userName,
          code,
          itemName,
          qty : currentQty,
          unit: currentUnit,
          type: currentType,
          note: noteText
        });
      });
    }
  } catch (e) {
    console.error("renderHistory() error:", e);
    toast("履歴の読み込みに失敗しました。");
  }
}
function openHistoryEditModal(h) {
  if (!isAdmin()) {
    toast("Akses ditolak（管理者のみ）");
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "modal fade";
  wrap.innerHTML = `
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">履歴の修正</h5>
          <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body">
          <div class="mb-2 small text-muted">
            コードやユーザー情報はそのままにして、数量・種別・備考を修正できます。
          </div>
          <div class="row g-3">
            <div class="col-md-4">
              <label class="form-label">日時</label>
              <input class="form-control" value="${escapeAttr(h.date || "")}" readonly>
            </div>
            <div class="col-md-4">
              <label class="form-label">ユーザー</label>
              <input class="form-control" value="${escapeAttr(h.userName || h.userId || "")}" readonly>
            </div>
            <div class="col-md-4">
              <label class="form-label">コード</label>
              <input class="form-control" value="${escapeAttr(h.code || "")}" readonly>
            </div>
            <div class="col-md-8">
              <label class="form-label">品名</label>
              <input class="form-control" value="${escapeAttr(h.itemName || "")}" readonly>
            </div>
            <div class="col-md-4">
              <label class="form-label">数量</label>
              <input id="hist-qty" type="number" class="form-control" value="${h.qty || 0}">
            </div>
            <div class="col-md-4">
              <label class="form-label">単位</label>
              <input id="hist-unit" class="form-control" value="${escapeAttr(h.unit || "pcs")}">
            </div>
            <div class="col-md-4">
              <label class="form-label">種別</label>
              <select id="hist-type" class="form-select">
                <option value="IN"  ${h.type === "OUT" ? "" : "selected"}>IN（入庫）</option>
                <option value="OUT" ${h.type === "OUT" ? "selected" : ""}>OUT（出庫）</option>
              </select>
            </div>
            <div class="col-12">
              <label class="form-label">備考</label>
              <textarea id="hist-note" class="form-control" rows="2">${escapeHtml(h.note || "")}</textarea>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-bs-dismiss="modal">キャンセル</button>
          <button class="btn btn-primary" id="hist-save">保存</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);
  const modal = new bootstrap.Modal(wrap);
  modal.show();

  $("#hist-save", wrap)?.addEventListener("click", async () => {
    const qtyVal  = Number($("#hist-qty", wrap).value || 0);
    const unitVal = ($("#hist-unit", wrap).value || "pcs").trim() || "pcs";
    const typeVal = $("#hist-type", wrap).value || "IN";
    const noteVal = $("#hist-note", wrap).value || "";

    if (!Number.isFinite(qtyVal) || qtyVal <= 0) {
      toast("数量を正しく入力してください。");
      return;
    }

    try {
      const res = await api("historyEdit", {
        method: "POST",
        body: {
          row : h.row,
          qty : qtyVal,
          unit: unitVal,
          type: typeVal,
          note: noteVal
        }
      });

      if (res?.ok) {
        toast("履歴を修正しました。");
        modal.hide();
        wrap.remove();
        await renderHistory();      // refresh history
        renderDashboard();          // refresh dashboard
      } else {
        toast(res?.error || "修正に失敗しました。");
      }
    } catch (e) {
      toast("修正に失敗しました: " + (e?.message || e));
    }
  });

  wrap.addEventListener("hidden.bs.modal", () => wrap.remove(), { once: true });
}

  // --- Tambahan: hint visual untuk input manual di 入出荷 ---
  function setManualHints({ autoFromLot } = { autoFromLot:false }){
    const qty  = document.getElementById('io-qty');
    const type = document.getElementById('io-type');
    if (!qty || !type) return;
    if (autoFromLot){
      qty.classList.remove('needs-manual');
      type.classList.remove('needs-manual');
      qty.dataset.autofill = '1';
    }else{
      qty.classList.add('needs-manual');
      type.classList.add('needs-manual');
      delete qty.dataset.autofill;
    }
  }

  /* -------------------- IO Scanner -------------------- */
  let IO_SCANNER = null;

  function bindIO() {
    const btnStart = $("#btn-io-scan"),
          btnStop  = $("#btn-io-stop"),
          area     = $("#io-scan-area");
    if (!btnStart || !btnStop || !area) return;

    setManualHints({ autoFromLot:false });

    const ioCode = document.getElementById("io-code");
    if (ioCode) {
      let timer = null;
      ioCode.addEventListener("input", (e) => {
        clearTimeout(timer);
        const v = (e.target.value || "").trim();
        if (!v) {
          const n = document.getElementById("io-name");
          const p = document.getElementById("io-price");
          const s = document.getElementById("io-stock");
          if (n) n.value = ""; if (p) p.value = ""; if (s) s.value = "";
          return;
        }
        timer = setTimeout(() => { setManualHints({autoFromLot:false}); findItemIntoIO(v); }, 220);
      });
      ioCode.addEventListener("blur", () => {
        const v = (ioCode.value || "").trim();
        if (v) findItemIntoIO(v);
      });
      ioCode.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const v = (ioCode.value || "").trim();
          if (v) findItemIntoIO(v);
        }
      });
    }

    btnStart.addEventListener("click", async () => {
      try {
        area.textContent = "カメラ起動中…";
        IO_SCANNER = await startBackCameraScan("io-scan-area", async (text) => {
          const parsed = parseScanText(String(text || ""));
          if (!parsed) return;

          if (parsed.kind === "item") {
            const code = parsed.code;
            $("#io-code").value = code;
            await findItemIntoIO(code);
            setManualHints({ autoFromLot:false });
            return;
          }

          if (parsed.kind === "lot") {
            const { code, qty, lot } = parsed;
            $("#io-code").value = code;
            await findItemIntoIO(code);

            const qtyField = document.getElementById("io-qty");
            if (qtyField) qtyField.value = Number(qty || 0) || "";

            setManualHints({ autoFromLot:true });
            return;
          }
        });
      } catch (e) { toast(e?.message || String(e)); }
    });

    btnStop.addEventListener("click", async () => {
      try { await IO_SCANNER?.stop?.(); IO_SCANNER?.clear?.(); } catch (e) {}
      area.innerHTML = "カメラ待機中…";
    });

    // auto-stop saat tab disembunyikan
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        try { IO_SCANNER?.stop?.(); IO_SCANNER?.clear?.(); } catch(e){}
        area.innerHTML = "カメラ待機中…";
      }
    });

    $("#btn-io-lookup")?.addEventListener("click", (e) => {
      e.preventDefault();
      const code = ($("#io-code").value || "").trim();
      if (code) findItemIntoIO(code);
    });

    $("#form-io")?.addEventListener("submit", async (e) => {
      e.preventDefault();

      const who = getCurrentUser();
      if (!who) return toast("ログイン情報がありません。");

           const code = ($("#io-code").value || "").trim();
      const qty  = Number($("#io-qty").value || 0);
      const unit = $("#io-unit").value || "pcs";

      // 🔁 Normalisasi type: pastikan IN / OUT saja
      const typeRaw = $("#io-type").value || "IN";
      const type = (() => {
        const t = String(typeRaw).toUpperCase();
        if (t === "OUT" || t === "-1" || t === "出庫") return "OUT";
        return "IN";
      })();



      if (!code) return toast("コードを入力またはスキャンしてください。");
      if (!Number.isFinite(qty) || qty <= 0) return toast("数量を入力してください。");

      const btn = $("#form-io button[type=submit]") || $("#btn-io-submit");
      if (btn?.__busy) return;
      if (btn) { btn.__busy = true; btn.disabled = true; }

      try {
        const r = await api("log", { method: "POST", body: { userId: who.id, userName: who.name || "",  code, qty, unit, type } });
        if (r?.ok) {
          const msgType = (type === "IN") ? "入庫" : "出庫";
          toast(`${msgType}として登録しました（${code} × ${qty} ${unit}）`);
          $("#io-qty").value = "";
          await findItemIntoIO(code);
          setManualHints({ autoFromLot:false });
          renderDashboard();
        } else {
          toast(r?.error || "登録失敗");
        }
      } catch (err) {
        toast("登録失敗: " + (err?.message || err));
      } finally {
        if (btn) { btn.disabled = false; btn.__busy = false; }
      const hv = document.getElementById("view-history");
 if (hv && hv.classList.contains("active")) {
   await renderHistory(); // refresh langsung jika sedang di tab 履歴
 }

      }
    });

  }

  async function startBackCameraScan(mountId, onScan, boxSize) {
    const isPhone = isMobile();
    const qrboxSize = boxSize ?? (isPhone ? 220 : 240);
    const mount = document.getElementById(mountId);
    if (mount) Object.assign(mount.style, { maxWidth: "420px", margin: "0 auto", aspectRatio: "4/3", position: "relative" });

    if ("BarcodeDetector" in window) {
      try {
        const ok = await (async () => {
          let stream;
          const video = Object.assign(document.createElement("video"), { playsInline: true, autoplay: true, muted: true });
          Object.assign(video.style, { width: "100%", height: "100%", objectFit: "cover" });
          mount.innerHTML = ""; mount.appendChild(video);

          const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
          const back = devs.find(d => /back|rear|environment/i.test(d.label)) || devs.at(-1);
          const constraints = {
            audio: false,
            video: {
              deviceId: back ? { exact: back.deviceId } : { ideal: "environment" },
              width: { ideal: 1280 }, height: { ideal: 720 },
              focusMode: "continuous", exposureMode: "continuous"
            }
          };
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          video.srcObject = stream;

          await new Promise(r => setTimeout(r, 500));

          const detector = new BarcodeDetector({ formats: ["qr_code"] });
          let raf = 0, stopped = false;
          const loop = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(video);
              if (codes?.length) {
                const txt = codes[0].rawValue || "";
                if (txt) { stop(); onScan(txt); return; }
              }
            } catch (e) { }
            raf = requestAnimationFrame(loop);
          };
          const stop = () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks()?.forEach(t => t.stop()); mount.innerHTML = ""; };
          loop();
          return { stop: async () => stop(), clear: () => { try { mount.innerHTML = ""; } catch (e) { } } };
        })();
        if (ok) return ok;
      } catch (e) { console.warn("Native detector gagal → fallback html5-qrcode", e); }
    }

    await ensureHtml5Qrcode();
    const formatsOpt = (window.Html5QrcodeSupportedFormats && Html5QrcodeSupportedFormats.QR_CODE)
      ? { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE] }
      : {};
    const cfg = {
      fps: 30,
      qrbox: { width: qrboxSize, height: qrboxSize },
      aspectRatio: 1.33,
      rememberLastUsedCamera: true,
      disableFlip: true,
      videoConstraints: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        focusMode: "continuous",
        exposureMode: "continuous"
      },
      ...formatsOpt
    };
    const scanner = new Html5Qrcode(mountId, { useBarCodeDetectorIfSupported: true });
    async function startWith(source) {
      await scanner.start(source, cfg, txt => onScan(txt));
      try {
        await new Promise(r => setTimeout(r, 600));
        await scanner.applyVideoConstraints({ advanced: [{ focusMode: "continuous" }, { exposureMode: "continuous" }, { zoom: 3 }] }).catch(() => { });
      } catch (e) { }
      return scanner;
    }
    try { return await startWith({ facingMode: "environment" }); }
    catch (e) {
      const cams = await Html5Qrcode.getCameras();
      if (!cams?.length) throw new Error("カメラが見つかりません。権限をご確認ください。");
      const back = cams.find(c => /back|rear|environment/i.test(c.label)) || cams.at(-1);
      return await startWith({ deviceId: { exact: back.id } });
    }
  }

  // Parser QR
  function parseScanText(txt) {
    const s = String(txt || "").trim();

    if (/^ITEM\|/i.test(s)) {
      const code = normalizeCodeDash((s.split("|")[1] || "").trim());
      return { kind: "item", code };
    }
    if (/^LOT\|/i.test(s)) {
      const [, codeRaw, qtyRaw, lotRaw] = s.split("|");
      const code = normalizeCodeDash(codeRaw || "");
      const qty  = Number(qtyRaw || 0) || 0;
      const lot  = (lotRaw || "").trim();
      if (code && qty > 0) return { kind: "lot", code, qty, lot };
    }
    try {
      const o = JSON.parse(s);
      if ((o.t === "item" || o.type === "item") && o.code) {
        return { kind: "item", code: normalizeCodeDash(String(o.code)) };
      }
      if ((o.t === "lot" || o.type === "lot") && o.code && Number(o.qty || 0) > 0) {
        return { kind: "lot", code: normalizeCodeDash(String(o.code)), qty: Number(o.qty), lot: String(o.lot || "") };
      }
    } catch (e) {}
    return null;
  }

  // IO lookup form
  async function findItemIntoIO(codeRaw) {
    const code = normalizeCodeDash(String(codeRaw || "")).trim();
    const nameEl  = document.getElementById("io-name");
    const priceEl = document.getElementById("io-price");
    const stockEl = document.getElementById("io-stock");
    if (!nameEl || !priceEl || !stockEl) return;

    nameEl.value  = "";
    priceEl.value = "";
    stockEl.value = "";

    let item = _ITEMS_CACHE.find(x => String(x.code) === code);
    if (!item) {
      try {
        const r = await api("itemByCode", { method: "POST", body: { code }, silent: true });
        if (r?.ok && r.item) item = r.item;
      } catch (e) {}
    }

    if (item) {
      nameEl.value  = item.name || "";
      priceEl.value = Number(item.price || 0);
      stockEl.value = Number(item.stock || 0);
    }
    return item;
  }

  /* -------------------- Stocktake (棚卸) -------------------- */
  let SHELF_SCANNER = null;
  const ST = { rows: new Map() };

  const ST_DRAFT_KEY = "shelfDraftV1";
  function saveShelfDraft(){
    try{
      const arr = [...ST.rows.values()];
      const data = { at: new Date().toISOString(), rows: arr };
      localStorage.setItem(ST_DRAFT_KEY, JSON.stringify(data));
      toast("下書きを保存しました");
    }catch(e){ toast("保存失敗: " + (e?.message || e)); }
  }
  function loadShelfDraft(){
    try{
      const raw = localStorage.getItem(ST_DRAFT_KEY);
      if(!raw){ return toast("下書きがありません"); }
      const data = JSON.parse(raw||"{}");
      const map = new Map();
      (data.rows||[]).forEach(r => {
        const book = Number(r.book||0), qty=Number(r.qty||0);
        map.set(String(r.code), { code:String(r.code), name:r.name, department:(r.department||""), book, qty, diff: qty - book });
      });
      ST.rows = map;
      renderShelfTable();
      toast("下書きを読み込みました");
    }catch(e){ toast("読込失敗: " + (e?.message || e)); }
  }
  function clearShelfDraft(){
    try{ localStorage.removeItem(ST_DRAFT_KEY); toast("下書きを削除しました"); }catch (e) {}
  }

  window.ST = ST;

  async function addOrUpdateStocktake(code, realQty) {
    if (!code) return;
    let item = _ITEMS_CACHE.find(x => String(x.code) === String(code));
    if (!item) { const r = await api("itemByCode", { method: "POST", body: { code } }); if (r?.ok) item = r.item; }
    if (!item) return toast("アイテムが見つかりません: " + code);
    const book = Number(item.stock || 0);
    const qty = Number(realQty ?? book);
    const diff = qty - book;
    ST.rows.set(code, { code, name: item.name, department: (item.department || ""), book, qty, diff });
    renderShelfTable();
  }
  async function addOrIncStocktake(code, delta) {
    if (!code || !delta) return;
    let item = _ITEMS_CACHE.find(x => String(x.code) === String(code));
    if (!item) { const r = await api("itemByCode", { method: "POST", body: { code } }); if (r?.ok) item = r.item; }
    if (!item) return toast("アイテムが見つかりません: " + code);

    const row = ST.rows.get(code);
    const book = Number(item.stock || 0);
    const currentQty = row ? Number(row.qty || 0) : book;
    const newQty = currentQty + Number(delta);
    ST.rows.set(code, { code, name: item.name, department: (item.department || ""), book, qty: newQty, diff: newQty - book });
    renderShelfTable();
  }

  function renderShelfTable() {
    const tbody = $("#tbl-stocktake"); if (!tbody) return;
    const isadmin = isAdmin();
    const arr = [...ST.rows.values()];
    tbody.innerHTML = arr.map(r => `
      <tr data-code="${escapeAttr(r.code)}">
        <td>${escapeHtml(r.code)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.department || "")}</td>
        <td class="text-end">${fmt(r.book)}</td>
        <td class="text-end"><input type="number" class="form-control form-control-sm st-qty" value="${r.qty}"></td>
        <td class="text-end ${r.diff === 0 ? "" : "fw-bold"}">${fmt(r.qty - r.book)}</td>
        <td class="text-end">
          <div class="st-actions d-inline-flex gap-2">
            ${isadmin ? `<button class="btn btn-outline-primary btn-st-adjust btn-sm">Edit</button>` : ""}
            <button class="btn btn-outline-danger btn-st-del btn-sm">削除</button>
          </div>
        </td>
      </tr>
    `).join("");

    const sumEl = $("#st-summary");
    if (sumEl) {
      const total = arr.length;
      const diffRows = arr.filter(x => (x.diff||0) !== 0).length;
      const diffSum = arr.reduce((a,b)=>a+Number(b.diff||0),0);
      const absSum  = arr.reduce((a,b)=>a+Math.abs(Number(b.diff||0)),0);
      sumEl.textContent = `件数: ${total} ／ 差異あり: ${diffRows} ／ 差異合計: ${fmt(diffSum)} ／ 絶対差異: ${fmt(absSum)}`;
    }

    tbody.oninput = (e) => {
      const tr = e.target.closest("tr"); if (!tr) return;
      if (!e.target.classList.contains("st-qty")) return;

      const code = tr.getAttribute("data-code");
      const rec = ST.rows.get(code); if (!rec) return;

      rec.qty = Number(e.target.value || 0);
      rec.diff = rec.qty - rec.book;

      tr.children[5].textContent = fmt(rec.diff);
      tr.children[5].classList.toggle("fw-bold", rec.diff !== 0);

      const arr2 = [...ST.rows.values()];
      const sumEl2 = $("#st-summary");
      if (sumEl2){
        const diffRows = arr2.filter(x => (x.diff||0) !== 0).length;
        const diffSum  = arr2.reduce((a,b)=>a+Number(b.diff||0),0);
        const absSum   = arr2.reduce((a,b)=>a+Math.abs(Number(b.diff||0)),0);
        sumEl2.textContent = `件数: ${arr2.length} ／ 差異あり: ${diffRows} ／ 差異合計: ${fmt(diffSum)} ／ 絶対差異: ${fmt(absSum)}`;
      }
    };

    tbody.onclick = (e) => {
      const tr = e.target.closest("tr"); if (!tr) return;
      const code = tr.getAttribute("data-code"); const rec = ST.rows.get(code); if (!rec) return;
      if (e.target.closest(".btn-st-adjust")) { if (!isAdmin()) return toast("Akses ditolak (admin only)"); openEditItem(code); }
      if (e.target.closest(".btn-st-del")) {
        ST.rows.delete(code);
        renderShelfTable();
      }
    };
  }

  function bindShelf() {
    // --- toolbar buttons (差異のみ / 下書き保存 / 読込 / クリア / 確定) ---
    const toolbarRight = document.querySelector('#view-shelf .items-toolbar .right');
    if (toolbarRight && !toolbarRight.querySelector('.st-controls')) {
      const wrap = document.createElement('div');
      wrap.className = 'st-controls d-flex align-items-center gap-2 flex-wrap';
      wrap.innerHTML = `
        <div class="form-check form-switch m-0">
          <input class="form-check-input" type="checkbox" id="st-diff-only">
          <label class="form-check-label small" for="st-diff-only">差異のみ</label>
        </div>
        <button id="st-save"   class="btn btn-sm btn-outline-secondary">下書き保存</button>
        <button id="st-load"   class="btn btn-sm btn-outline-secondary">読込</button>
        <button id="st-clear"  class="btn btn-sm btn-outline-danger">クリア</button>
        <button id="st-commit" class="btn btn-sm btn-primary">確定（在庫更新）</button>
      `;
      toolbarRight.appendChild(wrap);
    }

    const btnStart = $("#btn-start-scan"),
          btnStop  = $("#btn-stop-scan"),
          area     = $("#scan-area");

    if (!btnStart || !btnStop || !area) return;

    // --- スキャン開始 / 停止 ---
    btnStart.addEventListener("click", async () => {
      try {
        area.textContent = "カメラ起動中…";
        SHELF_SCANNER = await startBackCameraScan("scan-area", async (text) => {
          const p = parseScanText(String(text || ""));
          if (!p) return;

          if (p.kind === "item") {
            if (confirm("この商品を追加してもよろしいですか？")) {
              await addOrUpdateStocktake(p.code, ST.rows.get(p.code)?.qty ?? undefined);
            }
            return;
          }
          if (p.kind === "lot") {
            if (confirm("この商品を追加してもよろしいですか？")) {
              await addOrIncStocktake(p.code, Number(p.qty || 0));
            }
            return;
          }
        });
      } catch (e) {
        toast(e?.message || String(e));
      }
    });

    btnStop.addEventListener("click", async () => {
      try { await SHELF_SCANNER?.stop?.(); SHELF_SCANNER?.clear?.(); } catch (e) {}
      area.innerHTML = "カメラ待機中…";
    });

    // auto-stop scan saat tab disembunyikan
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        try { SHELF_SCANNER?.stop?.(); SHELF_SCANNER?.clear?.(); } catch(e){}
        area.innerHTML = "カメラ待機中…";
      }
    });

    // --- フィルタ (コード / 名称) ---
    $("#st-filter")?.addEventListener("input", (e) => {
      const q = (e.target.value || "").toLowerCase();
      $$("#tbl-stocktake tr").forEach(tr => {
        const code = (tr.children[0]?.textContent || "").toLowerCase();
        const name = (tr.children[1]?.textContent || "").toLowerCase();
        tr.style.display = (code.includes(q) || name.includes(q)) ? "" : "none";
      });
    });

    // --- 手入力で1件追加 ---
    $("#st-add")?.addEventListener("click", async (e) => {
      e.preventDefault();
      const code = ($("#st-code").value || "").trim();
      const qty  = Number($("#st-qty").value || 0);
      if (!code) return;
      await addOrUpdateStocktake(code, qty || undefined);
      $("#st-code").value = "";
      $("#st-qty").value  = "";
    });

    // --- 差異のみスイッチ ---
    const diffOnly = document.getElementById("st-diff-only");
    if (diffOnly && !diffOnly.__bound) {
      diffOnly.__bound = true;
      diffOnly.addEventListener("change", () => {
        const only = diffOnly.checked;
        $$("#tbl-stocktake tr").forEach(tr => {
          const diffText = (tr.children[5]?.textContent || "0").replace(/[,¥]/g, "");
          const diff = Number(diffText || 0);
          tr.style.display = (!only || diff !== 0) ? "" : "none";
        });
      });
    }

    // --- 下書き保存 / 読込 / クリア ---
       $("#st-save")?.addEventListener("click", (e) => {
      e.preventDefault();
      saveShelfDraft();
    });

    $("#st-load")?.addEventListener("click", (e) => {
      e.preventDefault();
      loadShelfDraft();
    });

    $("#st-clear")?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!confirm("現在の棚卸データをクリアしますか？")) return;
      ST.rows = new Map();
      renderShelfTable();
      clearShelfDraft();
    });

    // ✅ 確定（在庫更新＆棚卸記録）
    $("#st-commit")?.addEventListener("click", async (e) => {
      e.preventDefault();

      const who = getCurrentUser();
      if (!who) {
        toast("ログイン情報がありません。");
        return;
      }

      const rows = [...ST.rows.values()];
      if (!rows.length) {
        toast("棚卸データがありません。");
        return;
      }

      if (!confirm(`現在の棚卸 ${rows.length} 件を確定し、在庫を更新しますか？`)) {
        return;
      }

      const btn = e.currentTarget;
      if (btn.__busy) return;
      btn.__busy = true;
      btn.disabled = true;

      try {
        // pakai cache item untuk dapat unit / location / department dll.
        if (!_ITEMS_CACHE.length) {
          const listAll = await api("items", { method: "GET", silent: true });
          _ITEMS_CACHE = Array.isArray(listAll) ? listAll : (listAll?.data || []);
        }
        const mapItems = new Map(_ITEMS_CACHE.map(it => [String(it.code), it]));

        // tampilkan loading global biar user tahu sedang proses
        setLoading(true, "棚卸を確定しています…");

        for (const r of rows) {
          const code = String(r.code || "").trim();
          if (!code) continue;

          const qtyFinal = Number(r.qty || 0);
          const book     = Number(r.book || 0);
          const diff     = qtyFinal - book;

          const item = mapItems.get(code) || {};
          const unit = item.unit || "pcs";
          const location   = item.location   || "";
          const department = r.department || item.department || "";

          // 1) koreksi stok lewat log IN/OUT (履歴＋商品在庫を自動調整)
          if (diff !== 0) {
            const type = diff > 0 ? "IN" : "OUT";
            const qtyAdj = Math.abs(diff);
            await api("log", {
              method: "POST",
              silent: true,
              body: {
                userId  : who.id,
                userName: who.name || "",
                code,
                qty     : qtyAdj,
                unit,
                type,
                note    : "棚卸確定"
              }
            });
          }

          // 2) simpan hasil棚卸 keシート棚卸 (tanaSave)
          await api("tanaSave", {
            method: "POST",
            silent: true,
            body: {
              code,
              name      : r.name,
              qty       : qtyFinal,
              unit,
              location,
              department,
              userId    : who.id,
              note      : `book:${book} diff:${diff}`
            }
          });
        }

        toast("棚卸を確定しました。");

        // bersihkan input dan draft lokal
        ST.rows = new Map();
        renderShelfTable();
        clearShelfDraft();

        // refresh tampilan lain
        renderItems();      // 商品一覧 → stok terkoreksi
        renderDashboard();  // kartu-kartu dashboard
        loadTanaList();     // 棚卸一覧 → langsung muncul
      } catch (err) {
        console.error("st-commit error", err);
        toast("棚卸の確定に失敗しました: " + (err?.message || err));
      } finally {
        setLoading(false);
        btn.disabled = false;
        btn.__busy = false;
      }
    });
  } // ⬅️ Penutup bindShelf()


  /* -------------------- Tanaoroshi List (棚卸一覧) -------------------- */

  const JP_TANA_MAP = {
    period : "棚卸年月",
    date   : "日付",
    code   : "コード",
    name   : "品名",
    qty    : "数量",
    unit   : "単位",
    price  : "単価",
    amount : "金額",
    location   : "場所",
    department : "部門",
    userId     : "担当者",
    note       : "備考"
  };

  let _TANA_ROWS = [];

  function tanaJPHeaders() { return Object.values(JP_TANA_MAP); }

  function formatTanaNote(row) {
    const raw = String(row.note || "");
    let book = row.book;
    let diff = row.diff;

    if (book == null || diff == null) {
      const m = raw.match(/book:\s*(-?\d+)\s+diff:\s*(-?\d+)/i);
      if (m) {
        book = Number(m[1]);
        diff = Number(m[2]);
      }
    }
    if (book != null || diff != null) {
      const b = Number(book || 0);
      const d = Number(diff || 0);
      return `帳簿:${fmt(b)} / 差異:${fmt(d)}`;
    }
    return raw;
  }

  function tanaToJPRow(row) {
    return {
      [JP_TANA_MAP.period]    : row.period || "",
      [JP_TANA_MAP.date]      : row.date || "",
      [JP_TANA_MAP.code]      : row.code || "",
      [JP_TANA_MAP.name]      : row.name || "",
      [JP_TANA_MAP.qty]       : String(row.qty ?? ""),
      [JP_TANA_MAP.unit]      : row.unit || "pcs",
      [JP_TANA_MAP.price]     : row.price != null ? String(row.price) : "",
      [JP_TANA_MAP.amount]    : row.amount != null ? String(row.amount) : "",
      [JP_TANA_MAP.location]  : row.location || "",
      [JP_TANA_MAP.department]: row.department || "",
      [JP_TANA_MAP.userId]    : row.userId || "",
      [JP_TANA_MAP.note]      : formatTanaNote(row)
    };
  }

  function renderTanaTable() {
    const tbl = document.getElementById("tbl-tana");
    if (!tbl) return;

    const heads        = tanaJPHeaders();
    const headsWithOps = [...heads, "操作"];

    const monthSel = document.getElementById("tana-month");
    const month    = (monthSel?.value || "").trim();

    const data = month
      ? _TANA_ROWS.filter(r => r.period === month)
      : _TANA_ROWS.slice();

    // header
    tbl.innerHTML =
      "<thead><tr>" +
      headsWithOps.map(h => `<th>${h}</th>`).join("") +
      "</tr></thead>";

    if (!data.length) {
      tbl.insertAdjacentHTML(
        "beforeend",
        `<tbody><tr><td colspan="${headsWithOps.length}" class="text-muted py-4 text-center">データはありません</td></tr></tbody>`
      );
      updateTanaSummary();
      bindTanaTableEvents();
      return;
    }

    let totalAmount = 0;

    const bodyHtml =
      "<tbody>" +
      data.map((row) => {
        const jpRow = tanaToJPRow(row);
        const code  = jpRow[JP_TANA_MAP.code] || "";

        totalAmount += Number(row.amount || 0);

        const tds = heads.map(h => {
          const v = jpRow[h] ?? "";
          if (h === JP_TANA_MAP.price || h === JP_TANA_MAP.amount) {
            const num = Number(v || 0);
            return `<td class="text-end">${num ? "¥" + fmt(num) : ""}</td>`;
          }
          if (h === JP_TANA_MAP.qty) {
            return `<td class="text-end">${fmt(v)}</td>`;
          }
          return `<td>${escapeHtml(v)}</td>`;
        }).join("");

        return `
          <tr data-idx="${row.idx}" data-code="${escapeAttr(code)}">
            ${tds}
            <td class="text-end">
              <button class="btn btn-sm btn-outline-primary btn-tana-edit">編集</button>
            </td>
          </tr>`;
      }).join("") +
      "</tbody>";

    const idxAmount = heads.indexOf(JP_TANA_MAP.amount);
    const leftSpan  = idxAmount;
    const rightSpan = headsWithOps.length - idxAmount - 1;

    const tfootHtml = `
      <tfoot>
        <tr>
          <td colspan="${leftSpan}" class="text-end fw-bold">合計金額</td>
          <td class="text-end fw-bold">¥${fmt(totalAmount)}</td>
          <td colspan="${rightSpan}"></td>
        </tr>
      </tfoot>`;

    tbl.insertAdjacentHTML("beforeend", bodyHtml + tfootHtml);

    updateTanaSummary();
    bindTanaTableEvents();
  }

  function updateTanaSummary() {
    const host = document.getElementById("tana-summary");
    if (!host) return;
    if (!_TANA_ROWS.length) {
      host.textContent = "";
      return;
    }

    const agg = new Map();
    for (const r of _TANA_ROWS) {
      const key = r.period || "不明";
      const cur = agg.get(key) || { qty: 0, amount: 0 };
      cur.qty    += Number(r.qty || 0);
      cur.amount += Number(r.amount || 0);
      agg.set(key, cur);
    }

    const rows = [...agg.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    const html =
      '<div class="fw-semibold mb-1">月別集計（全データ）</div>' +
      '<div class="table-responsive"><table class="table table-sm mb-0">' +
      '<thead><tr><th>棚卸年月</th><th class="text-end">数量合計</th><th class="text-end">金額合計</th></tr></thead>' +
      '<tbody>' +
      rows.map(([period, v]) => `
        <tr>
          <td>${escapeHtml(period)}</td>
          <td class="text-end">${fmt(v.qty)}</td>
          <td class="text-end">¥${fmt(v.amount)}</td>
        </tr>`).join("") +
      '</tbody></table></div>';

    host.innerHTML = html;
  }

  function bindTanaFilterUI() {
    const monthSel = document.getElementById("tana-month");
    if (monthSel && !monthSel.__bound) {
      monthSel.__bound = true;
      monthSel.addEventListener("change", () => renderTanaTable());
    }
    const clearBtn = document.getElementById("tana-month-clear");
    if (clearBtn && !clearBtn.__bound) {
      clearBtn.__bound = true;
      clearBtn.addEventListener("click", (e) => {
        e.preventDefault();
        if (monthSel) monthSel.value = "";
        renderTanaTable();
      });
    }
  }

  function bindTanaTableEvents() {
    const tbl = document.getElementById("tbl-tana");
    if (!tbl || tbl.__tanaBound) return;
    tbl.__tanaBound = true;

    tbl.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".btn-tana-edit");
      if (!btn) return;
      const tr  = btn.closest("tr");
      const idx = Number(tr?.getAttribute("data-idx") || "-1");
      const row = _TANA_ROWS.find(r => r.idx === idx);
      if (!row) return;
      openTanaEditModal(row);
    });
  }

  function openTanaEditModal(row) {
    const who = getCurrentUser();
    if (!who) return toast("ログイン情報がありません。");

    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title">棚卸数量の編集</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <div class="modal-body">
            <div class="mb-2 small text-muted">コード・名称などは変更不可です。数量のみ編集できます。</div>
            <div class="row g-3">
              <div class="col-md-6"><label class="form-label">コード</label>
                <input class="form-control" value="${escapeAttr(row.code)}" readonly></div>
              <div class="col-md-6"><label class="form-label">品名</label>
                <input class="form-control" value="${escapeAttr(row.name || "")}" readonly></div>
              <div class="col-md-4"><label class="form-label">棚卸年月</label>
                <input class="form-control" value="${escapeAttr(row.period || "")}" readonly></div>
              <div class="col-md-4"><label class="form-label">単価</label>
                <input class="form-control" value="${fmt(row.price || 0)}" readonly></div>
              <div class="col-md-4"><label class="form-label">数量</label>
                <input id="tana-edit-qty" type="number" class="form-control" min="0" value="${row.qty}"></div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">キャンセル</button>
            <button class="btn btn-primary" id="tana-edit-save">保存</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap); modal.show();

    $("#tana-edit-save", wrap)?.addEventListener("click", async () => {
      const qtyVal = Number($("#tana-edit-qty", wrap).value || 0);
      if (!Number.isFinite(qtyVal) || qtyVal < 0) {
        return toast("数量を正しく入力してください。");
      }

      const oldQty = Number(row.qty || 0);
      const delta  = qtyVal - oldQty;

      let book = row.book;
      let oldDiff = row.diff;
      if (book == null || oldDiff == null) {
        const m = String(row.note || "").match(/book:\s*(-?\d+)\s+diff:\s*(-?\d+)/i);
        if (m) {
          book    = Number(m[1]);
          oldDiff = Number(m[2]);
        }
      }
      if (book == null) {
        book = oldQty - (oldDiff || 0);
      }
      const newDiff = qtyVal - book;

      try {
        if (delta !== 0) {
          const type = delta > 0 ? "IN" : "OUT";
          const qty  = Math.abs(delta);
          await api("log", {
            method: "POST",
            body: {
              userId: who.id,
              code  : row.code,
              qty,
              unit  : row.unit || "pcs",
              type,
              note  : "棚卸修正"
            }
          });
        }

        await api("tanaSave", {
          method: "POST",
          body: {
            code      : row.code,
            name      : row.name,
            qty       : qtyVal,
            unit      : row.unit || "pcs",
            location  : row.location || "",
            department: row.department || "",
            userId    : row.userId || who.id,
            note      : `book:${book} diff:${newDiff}`
          }
        });

        toast("棚卸数量を保存しました。");
        modal.hide();
        wrap.remove();
        loadTanaList();
      } catch (e) {
        console.error(e);
        toast("保存に失敗しました。");
      }
    });

    wrap.addEventListener("hidden.bs.modal", () => wrap.remove(), { once: true });
  }

  async function loadTanaList() {
    try {
      const [res, itemsRaw] = await Promise.all([
        api("tanaList", { method: "GET" }),
        api("items",   { method: "GET", silent: true }).catch(() => [])
      ]);

      const rowsRaw =
        Array.isArray(res)        ? res :
        Array.isArray(res?.rows) ? res.rows :
        Array.isArray(res?.data) ? res.data : [];

      const items =
        Array.isArray(itemsRaw) ? itemsRaw :
        Array.isArray(itemsRaw?.data) ? itemsRaw.data : [];

      const mapItems = new Map(items.map(it => [String(it.code), it]));

      _TANA_ROWS = rowsRaw.map((r, idx) => {
        const date   = r.date || "";
        const period = date ? String(date).slice(0, 7) : "";
        const code   = r.code || "";
        const item   = mapItems.get(String(code)) || {};

        const qty   = Number(r.qty || 0);
        const unit  = r.unit || "pcs";
        const price = (r.price != null)
          ? Number(r.price || 0)
          : Number(item.price || 0);
        const amount = qty * price;

        const location   = r.location   || item.location   || "";
        const department = r.department || item.department || "";

        return {
          idx,
          period,
          date,
          code,
          name      : r.name || item.name || "",
          qty,
          unit,
          price,
          amount,
          location,
          department,
          userId    : r.userId || "",
          note      : r.note || "",
          book      : (typeof r.book !== "undefined") ? Number(r.book || 0) : null,
          diff      : (typeof r.diff !== "undefined") ? Number(r.diff || 0) : null
        };
      });

      renderTanaTable();
      bindTanaFilterUI();
      ensureViewAutoMenu("shelf-list", "#view-shelf-list .items-toolbar .right");
    } catch (e) {
      console.error("loadTanaList error", e);
      const tbl = document.getElementById("tbl-tana");
      if (tbl) {
        tbl.innerHTML =
          '<tbody><tr><td colspan="5" class="text-danger py-4">取得に失敗しました</td></tr></tbody>';
      }
      const host = document.getElementById("tana-summary");
      if (host) host.textContent = "取得に失敗しました。";
      ensureViewAutoMenu("shelf-list", "#view-shelf-list .items-toolbar .right");
    }
  }

  // CSV Export / Import untuk 棚卸一覧 (per bulan)
  $("#tana-exp")?.addEventListener("click", (e)=> {
    e.preventDefault();
    if (!_TANA_ROWS.length) {
      alert("データがありません。");
      return;
    }

    const month = (document.getElementById("tana-month")?.value || "").trim();
    const rows  = month
      ? _TANA_ROWS.filter(r => r.period === month)
      : _TANA_ROWS.slice();

    if (!rows.length) {
      alert("該当するデータがありません。");
      return;
    }

    const heads = tanaJPHeaders();
    const csvRows = rows.map(r => {
      const jp = tanaToJPRow(r);
      return heads.map(h => {
        let v = jp[h] ?? "";
        v = String(v).replace(/,/g, " ");
        return v;
      }).join(",");
    });

    const fname = month ? `棚卸_${month}.csv` : "棚卸.csv";
    const csv   = [heads.join(",")].concat(csvRows).join("\n");
    downloadCSV_JP(fname, csv);
  });
$("#tana-exp-year")?.addEventListener("click", (e)=> {
  e.preventDefault();

  if (!_TANA_ROWS.length) {
    alert("データがありません。");
    return;
  }

  let year = "";

  // 1) Kalau kamu punya select <select id="tana-year">, pakai dulu itu
  const ySel = document.getElementById("tana-year");
  if (ySel && ySel.value) {
    year = String(ySel.value).trim();
  } else {
    // 2) Kalau user sudah pilih month (YYYY-MM), ambil tahunnya
    const mVal = (document.getElementById("tana-month")?.value || "").trim();
    if (mVal && /^\d{4}-\d{2}$/.test(mVal)) {
      year = mVal.slice(0, 4); // "2025-11" → "2025"
    }
  }

  // 3) Kalau masih kosong → tanya pakai prompt
  if (!year) {
    const nowY  = new Date().getFullYear();
    const input = prompt("出力したい年(YYYY)を入力してください。", String(nowY));
    if (!input) return;
    if (!/^\d{4}$/.test(input)) {
      alert("年は YYYY 形式で入力してください。");
      return;
    }
    year = input;
  }

  // Filter data berdasarkan tahun (period = "YYYY-MM")
  const rows = _TANA_ROWS.filter(r => String(r.period || "").slice(0, 4) === year);
  if (!rows.length) {
    alert("該当するデータがありません。");
    return;
  }

  const heads = tanaJPHeaders();
  const csvRows = rows.map(r => {
    const jp = tanaToJPRow(r);
    return heads.map(h => {
      let v = jp[h] ?? "";
      v = String(v).replace(/,/g, " ");  // amankan koma
      return v;
    }).join(",");
  });

  const fname = `棚卸_${year}.csv`;
  const csv   = [heads.join(",")].concat(csvRows).join("\n");
  downloadCSV_JP(fname, csv);
});

  $("#input-tana-imp")?.addEventListener("change", async (ev)=> {
    const file = ev.target.files?.[0]; if(!file) return;
    const buf = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const resp = await api("tanaImportCSV", { method:'POST', body:{ csvBase64: b64 } });
    if(!resp || !resp.ok) return alert('インポート失敗');
    alert(`インポート: ${resp.imported} 行`);
    loadTanaList();
    ev.target.value = '';
  });

  /* -------------------- Auto-refresh UI helpers -------------------- */
  function itemsAuto_refreshLabel(sec){
    const btn = document.getElementById("btn-items-auto");
    if (!btn) return;
    if (!sec) btn.textContent = "Auto: Off";
    else if (sec >= 60) btn.textContent = `Auto: ${Math.round(sec/60)}分`;
    else btn.textContent = `Auto: ${sec}秒`;
  }
  function itemsAuto_extendMenu(){
    const btn = document.getElementById("btn-items-auto");
    const menu = btn?.parentElement?.querySelector(".dropdown-menu");
    if (!menu) return;
    if (!menu.querySelector('[data-autorefresh="180"]')) {
      menu.insertAdjacentHTML("beforeend", `
        <li><a class="dropdown-item" data-autorefresh="180">180秒</a></li>
        <li><a class="dropdown-item" data-autorefresh="300">300秒（5分）</a></li>
        <li><a class="dropdown-item" data-autorefresh="600">600秒（10分）</a></li>
      `);
    }
    menu.querySelectorAll("[data-autorefresh]").forEach(a => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const sec = Number(a.getAttribute("data-autorefresh") || "0");
        itemsAuto_refreshLabel(sec);
        setLiveRefresh(sec);
      });
    });
    const saved = Number(localStorage.getItem("liveRefreshSec") || "120");
    itemsAuto_refreshLabel(saved);
  }
  itemsAuto_extendMenu();

  function ensureViewAutoMenu(viewKey, toolbarRightSel){
    const host = document.querySelector(toolbarRightSel); if (!host) return;
    const BTN_ID = `btn-auto-${viewKey}`;
    const WRAP_ID = `auto-wrap-${viewKey}`;
    if (document.getElementById(BTN_ID)) {
      const saved = Number(localStorage.getItem("liveRefreshSec") || "120");
      const btn = document.getElementById(BTN_ID);
      if (btn) {
        btn.textContent = !saved ? "Auto: Off" : (saved >= 60 ? `Auto: ${Math.round(saved/60)}分` : `Auto: ${saved}秒`);
      }
      return;
    }
    const wrap = document.createElement("div");
    wrap.id = WRAP_ID;
    wrap.className = "btn-group";
    wrap.innerHTML = `
      <button id="${BTN_ID}" class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">Auto</button>
      <ul class="dropdown-menu dropdown-menu-end">
        <li><a class="dropdown-item" data-autorefresh="0">Off</a></li>
        <li><a class="dropdown-item" data-autorefresh="120">120秒（2分）</a></li>
        <li><a class="dropdown-item" data-autorefresh="180">180秒（3分）</a></li>
        <li><a class="dropdown-item" data-autorefresh="300">300秒（5分）</a></li>
        <li><a class="dropdown-item" data-autorefresh="600">600秒（10分）</a></li>
      </ul>`;
    host.appendChild(wrap);
    wrap.querySelectorAll("[data-autorefresh]").forEach(a=>{
      a.addEventListener("click",(e)=>{
        e.preventDefault();
        const sec = Number(a.getAttribute("data-autorefresh") || "0");
        setLiveRefresh(sec);
        const btn = document.getElementById(BTN_ID);
        if (!btn) return;
        btn.textContent = !sec ? "Auto: Off" : (sec >= 60 ? `Auto: ${Math.round(sec/60)}分` : `Auto: ${sec}秒`);
      });
    });
    const saved = Number(localStorage.getItem("liveRefreshSec") || "120");
    const btn = document.getElementById(BTN_ID);
    if (btn) btn.textContent = !saved ? "Auto: Off" : (saved >= 60 ? `Auto: ${Math.round(saved/60)}分` : `Auto: ${saved}秒`);
  }

  function openEditItem(code) {
    if (!isAdmin()) return toast("Akses ditolak (admin only)");
    const it = _ITEMS_CACHE.find(x => String(x.code) === String(code)); if (!it) return;
    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.innerHTML = `
<div class="modal-dialog">
  <div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">商品編集</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <div class="row g-3">
        <div class="col-md-6"><label class="form-label">コード</label><input id="md-code" class="form-control" value="${escapeAttr(it.code)}" readonly></div>
        <div class="col-md-6"><label class="form-label">名称</label><input id="md-name" class="form-control" value="${escapeAttr(it.name)}"></div>
        <div class="col-md-4"><label class="form-label">価格</label><input id="md-price" type="number" class="form-control" value="${Number(it.price || 0)}"></div>
        <div class="col-md-4"><label class="form-label">在庫</label><input id="md-stock" type="number" class="form-control" value="${Number(it.stock || 0)}"></div>
        <div class="col-md-4"><label class="form-label">最小</label><input id="md-min" type="number" class="form-control" value="${Number(it.min || 0)}"></div>
        <div class="col-md-8"><label class="form-label">画像URL</label><input id="md-img" class="form-control" value="${escapeAttr(it.img || "")}"></div>
        <div class="col-md-4"><label class="form-label">置場</label>
          <input id="md-location" class="form-control text-uppercase" value="${escapeAttr(it.location || "")}" placeholder="A-01-03"></div>
        <div class="col-md-4"><label class="form-label">部門</label>
          <input id="md-department" class="form-control" value="${escapeAttr(it.department || "")}" placeholder="製造/品質/倉庫など"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-bs-dismiss="modal">閉じる</button>
      <button class="btn btn-primary" id="md-save">保存</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap); modal.show();

    $("#md-location", wrap)?.addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""); });

    $("#md-save", wrap)?.addEventListener("click", async () => {
      try {
        const payload = {
          code: $("#md-code", wrap).value,
          name: $("#md-name", wrap).value,
          price: Number($("#md-price", wrap).value || 0),
          stock: Number($("#md-stock", wrap).value || 0),
          min: Number($("#md-min", wrap).value || 0),
          img: $("#md-img", wrap).value,
          location: ($("#md-location", wrap).value || "").toUpperCase().trim(),
          department: ($("#md-department", wrap).value || "").trim(),
          overwrite: true
        };
        const r = await api("updateItem", { method: "POST", body: payload });
        if (r?.ok) { modal.hide(); wrap.remove(); renderItems(); renderShelfTable(); }
        else toast(r?.error || "保存失敗");
      } catch (e) { toast("保存失敗: " + (e?.message || e)); }
    });

    wrap.addEventListener("hidden.bs.modal", () => wrap.remove(), { once: true });
  }

  function openNewItem() {
    if (!isAdmin()) return toast("Akses ditolak (admin only)");
    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.innerHTML = `
<div class="modal-dialog">
  <div class="modal-content">
    <div class="modal-header"><h5 class="modal-title">新規商品</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body">
      <div class="row g-3">
        <div class="col-md-6"><label class="form-label">コード</label><input id="nw-code" class="form-control" placeholder="SKU-001"></div>
        <div class="col-md-6"><label class="form-label">名称</label><input id="nw-name" class="form-control"></div>
        <div class="col-md-4"><label class="form-label">価格</label><input id="nw-price" type="number" class="form-control" value="0"></div>
        <div class="col-md-4"><label class="form-label">在庫</label><input id="nw-stock" type="number" class="form-control" value="0"></div>
        <div class="col-md-4"><label class="form-label">最小</label><input id="nw-min" type="number" class="form-control" value="0"></div>
        <div class="col-md-8"><label class="form-label">画像URL</label><input id="nw-img" class="form-control"></div>
        <div class="col-md-4"><label class="form-label">置場</label><input id="nw-location" class="form-control text-uppercase" placeholder="A-01-03"></div>
        <div class="col-md-4"><label class="form-label">部門</label>
          <input id="nw-department" class="form-control" placeholder="製造/品質/倉庫など">
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" data-bs-dismiss="modal">閉じる</button>
      <button class="btn btn-primary" id="nw-save">作成</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap); modal.show();
    $("#nw-location", wrap)?.addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ""); });
    $("#nw-save", wrap)?.addEventListener("click", async () => {
      try {
        const payload = {
          code: ($("#nw-code", wrap).value || "").trim(),
          name: $("#nw-name", wrap).value,
          price: Number($("#nw-price", wrap).value || 0),
          stock: Number($("#nw-stock", wrap).value || 0),
          min: Number($("#nw-min", wrap).value || 0),
          img: $("#nw-img", wrap).value,
          location: ($("#nw-location", wrap).value || "").toUpperCase().trim(),
          department: ($("#nw-department", wrap).value || "").trim(),
          overwrite: false
        };
        if (!payload.code) return toast("コードを入力してください。");
        const r = await api("updateItem", { method: "POST", body: payload });
        if (r?.ok) { modal.hide(); wrap.remove(); renderItems(); toast("作成しました"); }
        else toast(r?.error || "作成失敗");
      } catch (e) { toast("作成失敗: " + (e?.message || e)); }
    });
    wrap.addEventListener("hidden.bs.modal", () => wrap.remove(), { once: true });
  }

  // === LOT QR modal ===
  function openLotQRModal(item) {
    if (!item) return;
    const wrap = document.createElement("div");
    wrap.className = "modal fade";
    wrap.innerHTML = `
  <div class="modal-dialog">
    <div class="modal-content">
      <div class="modal-header"><h5 class="modal-title">Lot/箱 QR ラベル</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
      <div class="modal-body">
        <div class="row g-3">
          <div class="col-md-6"><label class="form-label">コード</label><input class="form-control" value="${escapeAttr(item.code)}" readonly></div>
          <div class="col-md-6"><label class="form-label">名称</label><input class="form-control" value="${escapeAttr(item.name || "")}" readonly></div>
          <div class="col-md-4"><label class="form-label">1箱の数量</label><input id="lot-qty" type="number" min="1" class="form-control" value="10"></div>
          <div class="col-md-8"><label class="form-label">ロットID（任意）</label><input id="lot-id" class="form-control" placeholder="LOT-2025-11-A"></div>
        </div>
        <div class="mt-3 d-flex align-items-center gap-3">
          <div id="lotqr-box"></div>
          <div class="small text-muted" id="lot-caption"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline-secondary" data-bs-dismiss="modal">閉じる</button>
        <button class="btn btn-outline-primary" id="lot-preview">プレビュー</button>
        <button class="btn btn-primary" id="lot-dl">DL</button>
      </div>
    </div>
  </div>`;
    document.body.appendChild(wrap);
    const modal = new bootstrap.Modal(wrap); modal.show();

    const box = $("#lotqr-box", wrap);

    async function renderQR() {
      const qty = Math.max(1, Number($("#lot-qty", wrap).value || 0) || 1);
      const lot = ($("#lot-id", wrap).value || "").trim();
      const codeNorm = normalizeCodeDash(item.code);
      const text = lot ? `LOT|${codeNorm}|${qty}|${lot}` : `LOT|${codeNorm}|${qty}`;

      const cap = $("#lot-caption", wrap);
      if (cap) cap.textContent = `コード: ${codeNorm} / 数量: ${qty}` + (lot ? ` / ロット: ${lot}` : "");

      box.innerHTML = "";
      try {
        await ensureQRCode();
        new QRCode(box, { text, width: 140, height: 140, correctLevel: QRCode.CorrectLevel.M });
      } catch {
        box.textContent = text; // fallback teks
      }
    }

    $("#lot-qty", wrap)?.addEventListener("input", renderQR);
    $("#lot-id", wrap)?.addEventListener("input", renderQR);
    renderQR();

    $("#lot-preview", wrap)?.addEventListener("click", async ()=> {
      const qty = Math.max(1, Number($("#lot-qty", wrap).value || 0) || 1);
      const lot = ($("#lot-id", wrap).value || "").trim();
      const url = await makeLotLabelDataURL(item, qty, lot);
      openPreview(url);
    });

    $("#lot-dl", wrap)?.addEventListener("click", async ()=>{
      const qty = Math.max(1, Number($("#lot-qty", wrap).value || 0) || 1);
      const lot = ($("#lot-id", wrap).value || "").trim();
      const url = await makeLotLabelDataURL(item, qty, lot);
      const lotSafe  = lot ? `_${sanitizeFilename(lot)}` : "";
      const codeSafe = sanitizeFilename(item.code);
      const a = document.createElement("a");
      a.href = url; a.download = `LOT_${codeSafe}${lotSafe}_${qty}.png`; a.click();
    });

    wrap.addEventListener("hidden.bs.modal", () => wrap.remove(), { once: true });
  }

  // --- Expose core helpers for global preview block ---
   // --- Expose core helpers for global preview block ---
  window.__INV_APP__ = window.__INV_APP__ || {};
  Object.assign(window.__INV_APP__, {
    fmt,
    api,
    generateQrDataUrl,
    makeItemLabelDataURL,
    openEditItem,

    // ⬇ biar bisa dipanggil dari initSidebar (global)
    renderDashboard,
    renderItems,
    renderUsers,
    renderHistory,
    renderShelfTable,
    loadTanaList
  });

function keepBackendWarm(){
  if (!CONFIG?.FEATURES?.HEALTH_PING) return;
  const ms = Number(CONFIG.HEALTH_PING_MS || 15000);
  setInterval(() => { api('ping', { method:'GET', silent:true }).catch(()=>{}); }, ms);
}

  /* -------------------- Boot -------------------- */
  window.addEventListener("DOMContentLoaded", () => {
    const logo = document.getElementById("brand-logo");
    if (logo && window.CONFIG && CONFIG.LOGO_URL) {
      logo.src = CONFIG.LOGO_URL; logo.alt = "logo";
      logo.onerror = () => { logo.style.display = "none"; };
    }

    const newItemBtn = $("#btn-open-new-item");
    const newUserBtn = $("#btn-open-new-user");
    if (newItemBtn) { newItemBtn.classList.toggle("d-none", !isAdmin()); newItemBtn.addEventListener("click", openNewItem); }
    if (newUserBtn) { newUserBtn.classList.toggle("d-none", !isAdmin()); newUserBtn.addEventListener("click", openNewUser); }

    hydrateCurrentUser();
    bindIO();
    bindShelf();
    updateWelcomeBanner();
    // ✨ Chart.js global style
    if (window.Chart) {
      Chart.defaults.font.family = '"Noto Sans JP", system-ui';
      Chart.defaults.color = "#4b5563";
      Chart.defaults.plugins.legend.labels.usePointStyle = true;
    }
    renderDashboard();
    bindPrintAllLabels();
    keepBackendWarm();
    $("#btn-logout")?.addEventListener("click", logout);

    // Preload QR lib & aktifkan Preview
    ensureQRCode()
      .catch(()=>{})
      .finally(()=>{ try{ bindPreviewButtons(); }catch(e){} });

    startLiveReload();
  });

})();   // <-- PENUTUP IIFE UTAMA



/* -------------------- Preview Modal & Preview helpers -------------------- */
(function () {
  "use strict";

  // escapeHtml lokal (modul preview berdiri sendiri dari IIFE utama)
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));
  }

  // Bridge ke helper inti di dalam IIFE utama (lihat window.__INV_APP__)
  function __invCore() { return window.__INV_APP__ || {}; }

  function fmt(n) {
    const core = __invCore();
    if (typeof core.fmt === "function") {
      return core.fmt(n);
    }
    try { return new Intl.NumberFormat("ja-JP").format(Number(n || 0)); }
    catch { return String(n || 0); }
  }

  async function invApi(action, opts) {
    const core = __invCore();
    if (typeof core.api !== "function") {
      throw new Error("API helper not ready");
    }
    return core.api(action, opts);
  }

  async function invGenerateQr(text, size) {
    const core = __invCore();
    if (typeof core.generateQrDataUrl !== "function") {
      throw new Error("QR helper not ready");
    }
    return core.generateQrDataUrl(text, size);
  }

  async function invMakeItemLabel(item) {
    const core = __invCore();
    if (typeof core.makeItemLabelDataURL !== "function") {
      throw new Error("Label helper not ready");
    }
    return core.makeItemLabelDataURL(item);
  }


  function invOpenEditItem(code) {
    const core = __invCore();
    if (typeof core.openEditItem !== "function") {
      throw new Error("Edit helper not ready");
    }
    return core.openEditItem(code);
  }

  function ensurePreviewModal() {
    if (document.getElementById("preview-modal")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="modal fade" id="preview-modal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title"><i class="bi bi-search me-2"></i>商品プレビュー</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="閉じる"></button>
            </div>
            <div class="modal-body">
              <div class="d-flex gap-3 align-items-start flex-wrap">
                <div>
                  <div id="pv-qr" class="rounded p-2 border bg-light"></div>
                  <div class="small text-muted mt-1">QR を印刷ラベルと同一サイズ比で生成</div>
                </div>
                <div class="flex-grow-1">
                  <div class="d-flex align-items-center gap-2 flex-wrap">
                    <span id="pv-name" class="fw-semibold fs-5"></span>
                    <span id="pv-status" class="badge"></span>
                  </div>
                  <div class="text-muted mt-1">
                    <span class="me-3">コード: <span id="pv-code"></span></span>
                    <span class="me-3">部門: <span id="pv-dept"></span></span>
                    <span>置場: <span id="pv-loc"></span></span>
                  </div>
                  <div class="mt-2">
                    <span class="me-3">価格: <span id="pv-price"></span></span>
                    <span class="me-3">在庫: <span id="pv-stock"></span></span>
                    <span>最小: <span id="pv-min"></span></span>
                  </div>
                </div>
                <div class="ms-auto">
                  <img id="pv-img" alt="" style="max-height:120px;max-width:180px;object-fit:contain;border:1px solid var(--bs-border-color);border-radius:.5rem;display:none">
                </div>
              </div>
            </div>
            <div class="modal-footer">
              <button id="pv-edit" type="button" class="btn btn-primary btn-sm">
                <i class="bi bi-pencil me-1"></i>編集
              </button>
              <button id="pv-print" type="button" class="btn btn-outline-secondary btn-sm">
                <i class="bi bi-printer me-1"></i>ラベル印刷
              </button>
              <button type="button" class="btn btn-light btn-sm" data-bs-dismiss="modal">閉じる</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
  }

  function ensurePreviewHistoryArea() {
    ensurePreviewModal();
    const modal = document.getElementById("preview-modal");
    if (!modal) return;
    if (modal.querySelector("#pv-history")) return;

    const body = modal.querySelector(".modal-body") || modal;
    const panel = document.createElement("div");
    panel.id = "pv-history";
    panel.className = "mt-3";
    panel.innerHTML = `
      <div class="fw-semibold mb-1">履歴（最新10件）</div>
      <div class="table-responsive">
        <table class="table table-sm mb-0">
          <thead>
            <tr>
              <th style="white-space:nowrap">日時</th>
              <th style="white-space:nowrap">ユーザー</th>
              <th style="white-space:nowrap">種別</th>
              <th class="text-end" style="white-space:nowrap">数量</th>
              <th style="white-space:nowrap">備考</th>
            </tr>
          </thead>
          <tbody id="pv-history-body">
            <tr><td colspan="5" class="text-muted">読み込み中…</td></tr>
          </tbody>
        </table>
      </div>`;
    body.appendChild(panel);
  }

  async function loadItemHistory(code) {
    try {
      ensurePreviewHistoryArea();
      const tb = document.getElementById("pv-history-body");
      if (tb) {
        tb.innerHTML = `<tr><td colspan="5" class="text-muted">読み込み中…</td></tr>`;
      }
      const res = await invApi("historyByCode", {
        method: "POST",
        body: { code, limit: 10 },
        silent: true
      });
      const rows = (res && res.ok && Array.isArray(res.rows)) ? res.rows : [];
      if (!rows.length) {
        if (tb) {
          tb.innerHTML = `<tr><td colspan="5" class="text-muted">履歴はありません</td></tr>`;
        }
        return;
      }
      if (tb) {
        tb.innerHTML = rows.map(r => `
          <tr>
            <td>${escapeHtml(r.date || "")}</td>
            <td>${escapeHtml(r.userId || "")}</td>
            <td>${escapeHtml(r.type || "")}</td>
            <td class="text-end">${fmt(r.qty || 0)} ${escapeHtml(r.unit || "")}</td>
            <td>${escapeHtml(r.note || "")}</td>
          </tr>`).join("");
      }
    } catch (e) {
      const tb = document.getElementById("pv-history-body");
      if (tb) {
        tb.innerHTML = `<tr><td colspan="5" class="text-danger">履歴の取得に失敗</td></tr>`;
      }
    }
  }

  function extractRowData(tr) {
    const get = sel => tr.querySelector(sel);
    const codeCell = get("td:nth-child(3) .small, td:nth-child(3)");
    const code = (tr.getAttribute("data-code") ||
                 (codeCell ? codeCell.textContent : "") ||
                 "").trim();
    const name = (get(".td-name")?.textContent || "").trim();
    const imgEl = get("td:nth-child(4) img");
    const priceText = (get("td:nth-child(5)")?.textContent || "").trim();
    const priceNum  = Number(priceText.replace(/[^\d.-]/g, "")) || 0;
    const stockText = (get("td:nth-child(6)")?.textContent || "0").replace(/[^0-9.-]/g, "");
    const minText   = (get("td:nth-child(7)")?.textContent || "0").replace(/[^0-9.-]/g, "");
    const dept  = (get("td:nth-child(8)")?.textContent || "").trim();
    const loc   = (get("td:nth-child(9)")?.textContent || "").trim();
    return {
      code,
      name,
      img: imgEl?.getAttribute("src") || "",
      price: priceText,
      stock: Number(stockText || 0),
      min: Number(minText || 0),
      department: dept,
      location: loc
    };
  }

  function showItemPreview(item) {
    try {
      ensurePreviewModal();

      const d = {
        code: String(item?.code || "").trim(),
        name: String(item?.name || "").trim(),
        dept: String(item?.department || item?.dept || "").trim(),
        loc : String(item?.location || item?.loc || "").trim(),
        priceNum: Number(item?.price || 0),
        stock: Number(item?.stock || 0),
        min  : Number(item?.min || 0),
        img  : item?.img || ""
      };

      const elCode  = document.getElementById("pv-code");
      const elName  = document.getElementById("pv-name");
      const elDept  = document.getElementById("pv-dept");
      const elLoc   = document.getElementById("pv-loc");
      const elPrice = document.getElementById("pv-price");
      const elStock = document.getElementById("pv-stock");
      const elMin   = document.getElementById("pv-min");
      const elImg   = document.getElementById("pv-img");
      const elStatus= document.getElementById("pv-status");
      const qrBox   = document.getElementById("pv-qr");

      if (elCode)  elCode.textContent  = d.code || "-";
      if (elName)  elName.textContent  = d.name || "(名称未設定)";
      if (elDept)  elDept.textContent  = d.dept || "-";
      if (elLoc)   elLoc.textContent   = d.loc  || "-";
      if (elPrice) elPrice.textContent = "¥" + fmt(d.priceNum || 0);
      if (elStock) elStock.textContent = String(d.stock);
      if (elMin)   elMin.textContent   = String(d.min);

      if (elStatus) {
        elStatus.className = "badge";
        if (d.stock <= 0) {
          elStatus.classList.add("bg-secondary");
          elStatus.textContent = "在庫ゼロ";
        } else if (d.stock <= d.min) {
          elStatus.classList.add("bg-danger");
          elStatus.textContent = "要補充";
        } else {
          elStatus.classList.add("bg-success");
          elStatus.textContent = "十分";
        }
      }

      if (elImg) {
        if (d.img) {
          elImg.src = d.img;
          elImg.style.display = "";
        } else {
          elImg.style.display = "none";
        }
      }

      if (qrBox) {
        qrBox.innerHTML = "";
        (async () => {
          try {
            const url = await invGenerateQr(`ITEM|${d.code}`, 128);
            if (url) {
              const im = new Image();
              im.src = url;
              im.width = 128;
              im.height = 128;
              im.alt = d.code;
              qrBox.appendChild(im);
            } else {
              qrBox.textContent = d.code || "(QR)";
            }
          } catch {
            qrBox.textContent = d.code || "(QR)";
          }
        })();
      }

      const btnEdit  = document.getElementById("pv-edit");
      const btnPrint = document.getElementById("pv-print");

      if (btnEdit) {
        btnEdit.onclick = () => {
          try { invOpenEditItem(d.code); }
          catch (e) { alert("編集を開けませんでした"); }
        };
      }

      if (btnPrint) {
        btnPrint.onclick = async () => {
          try {
            const url = await invMakeItemLabel(item);
            const w = window.open("", "_blank", "width=900,height=700");
            if (!w) {
              alert("ポップアップがブロックされました。");
              return;
            }
            w.document.write("<meta charset='utf-8'><title>ラベル印刷</title>");
            w.document.write("<style>body{margin:0;padding:16px;font-family:sans-serif} img{max-width:100%;display:block;margin:0 auto} @media print{img{page-break-inside:avoid;}}</style>");
            w.document.write(`<img src="${url}" alt="${d.code}">`);
            w.document.close();
            w.focus();
            setTimeout(() => { try { w.print(); } catch (_) {} }, 500);
          } catch (e) {
            alert("ラベル生成に失敗しました");
          }
        };
      }

      const modalEl = document.getElementById("preview-modal");
      if (window.bootstrap && window.bootstrap.Modal && modalEl) {
        window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
      } else if (modalEl) {
        modalEl.style.display = "block";
      }

      try { loadItemHistory(d.code); } catch (_e) {}

    } catch (e) {
      console.error("showItemPreview()", e);
      alert("プレビューを開けませんでした。");
    }
  }

  function openPreview(url) {
    try {
      ensurePreviewModal();
      const modalEl = document.getElementById("preview-modal");
      if (!modalEl) return;

      const imgEl   = modalEl.querySelector("#pv-img");
      const qrBox   = modalEl.querySelector("#pv-qr");
      const nameEl  = modalEl.querySelector("#pv-name");
      const codeEl  = modalEl.querySelector("#pv-code");
      const deptEl  = modalEl.querySelector("#pv-dept");
      const locEl   = modalEl.querySelector("#pv-loc");
      const priceEl = modalEl.querySelector("#pv-price");
      const stockEl = modalEl.querySelector("#pv-stock");
      const minEl   = modalEl.querySelector("#pv-min");
      const statusEl= modalEl.querySelector("#pv-status");

      if (nameEl)  nameEl.textContent  = "";
      if (codeEl)  codeEl.textContent  = "";
      if (deptEl)  deptEl.textContent  = "";
      if (locEl)   locEl.textContent   = "";
      if (priceEl) priceEl.textContent = "";
      if (stockEl) stockEl.textContent = "";
      if (minEl)   minEl.textContent   = "";
      if (statusEl) { statusEl.className = "badge"; statusEl.textContent = ""; }
      if (qrBox)   qrBox.innerHTML     = "";

      if (imgEl) {
        imgEl.src = url || "";
        imgEl.style.display = url ? "block" : "none";
      }

      if (window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
      } else {
        modalEl.style.display = "block";
      }
    } catch (e) {
      console.error("openPreview failed:", e);
      alert("プレビューを開けませんでした。");
    }
  }

  function bindPreviewButtons() {
    const tbl = document.getElementById("tbl-items");
    if (!tbl || tbl.__pvBound) return;
    tbl.__pvBound = true;

    ensurePreviewModal();

    tbl.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".btn-preview");
      if (!btn) return;
      ev.preventDefault();
      const tr = btn.closest("tr");
      if (!tr) return;
      const data = extractRowData(tr);
      showItemPreview(data);
    });

    tbl.addEventListener("click", (ev) => {
      const a = ev.target.closest(".link-item");
      if (!a) return;
      ev.preventDefault();
      const tr = a.closest("tr");
      if (!tr) return;
      const data = extractRowData(tr);
      showItemPreview(data);
    });

    tbl.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-action='detail'], [data-role='preview']");
      if (!btn) return;
      ev.preventDefault();
      const tr = btn.closest("tr");
      if (!tr) return;
      const data = extractRowData(tr);
      showItemPreview(data);
    });
  }

  document.addEventListener("click", (e) => {
    const a = e.target.closest(".js-filter");
    if (!a) return;
    const f = a.dataset.f;
    const rows = document.querySelectorAll("#tbl-items tr[data-code]");
    rows.forEach(tr => {
      const d = extractRowData(tr);
      let show = true;
      if (f === "low")  show = d.stock > 0 && d.stock <= d.min;
      if (f === "zero") show = d.stock <= 0;
      if (f === "img")  show = !!d.img;
      if (f === "all")  show = true;
      tr.style.display = show ? "" : "none";
    });
  });

  window.showItemPreview    = showItemPreview;
  window.openPreview        = openPreview;
  window.bindPreviewButtons = bindPreviewButtons;

})();

/* =========================================================
 * TOP SCROLLBAR — sinkronisasi dengan tabel items
 * =======================================================*/
function setupTopScrollbar(){
  const top  = document.getElementById("items-scroll-top");
  const wrap = document.getElementById("items-table-wrap");
  if (!top || !wrap) return;

  // pastikan ada inner bar
  let inner = top.firstElementChild;
  if (!inner) { inner = document.createElement("div"); top.appendChild(inner); }
  inner.style.height = "1px";

  const getTableWidth = () => {
    const tbl = wrap.querySelector("table");
    // fallback ke scrollWidth wrap kalau tabel belum ada
    return (tbl?.scrollWidth || wrap.scrollWidth || 0);
  };

  const syncSize = () => {
    inner.style.width = getTableWidth() + "px";
    // Samakan posisi scroll
    if (Math.abs(top.scrollLeft - wrap.scrollLeft) > 1) {
      top.scrollLeft = wrap.scrollLeft;
    }
  };

  // Bi-directional scroll
  if (!wrap.__topSyncBound) {
    wrap.__topSyncBound = true;
    wrap.addEventListener("scroll", () => { top.scrollLeft = wrap.scrollLeft; }, { passive: true });
  }
  if (!top.__wrapSyncBound) {
    top.__wrapSyncBound = true;
    top.addEventListener("scroll", () => { wrap.scrollLeft = top.scrollLeft; }, { passive: true });
  }

  // Resize & DOM changes observer → auto-resize saat isi berubah
  top.__resizeObs?.disconnect?.();
  top.__mutObs?.disconnect?.();

  const ro = new ResizeObserver(syncSize);
  ro.observe(wrap);
  const tbl = wrap.querySelector("table");
  if (tbl) ro.observe(tbl);
  top.__resizeObs = ro;

  const mo = new MutationObserver((muts) => {
    // kalau ada perubahan baris/kolom, resync
    let need = false;
    for (const m of muts) {
      if (m.type === "childList" || m.type === "attributes") { need = true; break; }
    }
    if (need) syncSize();
  });
  mo.observe(wrap, { childList: true, subtree: true, attributes: true });
  top.__mutObs = mo;

  // init
  syncSize();
  setTimeout(syncSize, 0);
  if (!top.__winResizeBound) {
    window.addEventListener("resize", syncSize);
    top.__winResizeBound = true;
  }

  // helper publik untuk dipanggil setelah render page
  window.__resyncTopScroll = syncSize;
}
// === TANGGAL + HARI (JP) ===
function updateTodayBox() {
  const el = document.getElementById('today-text');
  if (!el) return;

  const now = new Date();
  const days = ['日','月','火','水','木','金','土'];

  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const w = days[now.getDay()];

  el.textContent = `${y}/${m}/${d}（${w}）`;
}

// === CUACA (contoh: Tokyo, Open-Meteo, tanpa API key) ===
async function updateWeatherBox() {
  const el = document.getElementById('weather-text');
  if (!el) return;

  try {
    // Koordinat Tokyo – ganti kalau mau kota lain
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      '?latitude=35.6895&longitude=139.6917' +
      '&current_weather=true&timezone=Asia%2FTokyo';

    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data = await res.json();
    const cw = data.current_weather;

    const temp = Math.round(cw.temperature); // ℃
    const code = cw.weathercode;

    const label = weatherCodeToJa(code);
    el.textContent = `${label} / ${temp}℃`;
  } catch (err) {
    console.error('Weather error', err);
    el.textContent = '天気情報取得エラー';
  }
}

// mapping sederhana weather code → JP
function weatherCodeToJa(code) {
  // kode Open-Meteo (disederhanakan)
  if (code === 0) return '快晴';
  if (code === 1 || code === 2) return '晴れ';
  if (code === 3) return 'くもり';
  if (code >= 51 && code <= 67) return '雨（霧雨）';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return '雨';
  if (code >= 95) return '雷雨';
  return '天気';
}

// Jalankan setelah DOM siap
document.addEventListener('DOMContentLoaded', () => {
  updateTodayBox();
  updateWeatherBox();
});
// ===============================
// Sidebar + View Switch ala app
// ===============================
// ===============================
// Sidebar + View Switch ala app
// ===============================
function initSidebar() {
  const body      = document.body;
  const sidebar   = document.getElementById('sb');
  const backdrop  = document.getElementById('sb-backdrop');
  const burgerBtn = document.querySelectorAll('[data-burger]');
  const links     = sidebar ? sidebar.querySelectorAll('a[data-view]') : [];
  const pageTitle = document.getElementById('page-title');

  // akses helper / render dari IIFE utama
  const app = window.__INV_APP__ || {};

  if (!sidebar) return;

  const mqDesktop = window.matchMedia('(min-width: 992px)');

  const openSidebar = () => {
    if (!mqDesktop.matches) body.classList.add('sb-open');
  };
  const closeSidebar = () => {
    body.classList.remove('sb-open');
  };
  const toggleSidebar = () => {
    if (mqDesktop.matches) return; // desktop: sidebar selalu tampil
    body.classList.toggle('sb-open');
  };

  // Burger (icon kiri atas + tombol "メニュー" di HP)
  burgerBtn.forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      toggleSidebar();
    });
  });

  // Backdrop klik untuk tutup
  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeSidebar();
    });
  }

  // ESC juga nutup di mobile
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      closeSidebar();
    }
  });

  // Kalau resize ke desktop, pastikan class sb-open dibersihkan
  mqDesktop.addEventListener('change', (e) => {
    if (e.matches) {
      body.classList.remove('sb-open');
    }
  });

  // Fungsi ganti view
  function activateViewById(viewId, linkEl) {
    if (!viewId) return;

    // Nav: set active
    links.forEach(a => a.classList.remove('active'));
    if (linkEl) linkEl.classList.add('active');

    // Section: show/hide
    document.querySelectorAll('main section[id^="view-"]').forEach(sec => {
      if (sec.id === viewId) {
        sec.classList.remove('d-none');
        sec.classList.add('active');
      } else {
        sec.classList.add('d-none');
        sec.classList.remove('active');
      }
    });

    // Judul halaman = text di sidebar
    if (pageTitle && linkEl) {
      pageTitle.textContent = linkEl.textContent.trim();
    }

    // Panggil renderer per view (kalau ada)
    switch (viewId) {
      case 'view-dashboard':
        app.renderDashboard && app.renderDashboard();
        break;
      case 'view-items':
        app.renderItems && app.renderItems();
        break;
      case 'view-users':
        app.renderUsers && app.renderUsers();
        break;
      case 'view-history':
        app.renderHistory && app.renderHistory();
        break;
      case 'view-shelf':
        app.renderShelfTable && app.renderShelfTable();
        break;
      case 'view-shelf-list':
        app.loadTanaList && app.loadTanaList();
        break;
    }

    // Tutup sidebar setelah pilih menu (di HP)
    if (!mqDesktop.matches) {
      closeSidebar();
    }

    // Scroll ke atas dikit biar rapi
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Klik menu sidebar
  links.forEach(link => {
    link.addEventListener('click', (ev) => {
      ev.preventDefault();
      const viewId = link.getAttribute('data-view');
      activateViewById(viewId, link);
    });
  });

  // Inisialisasi awal: pakai link yang sudah .active di HTML
  const current = sidebar.querySelector('a[data-view].active') || links[0];
  if (current) {
    const firstView = current.getAttribute('data-view');
    activateViewById(firstView, current);
  }
}

// Listener global (boleh tetap seperti ini)
document.addEventListener('DOMContentLoaded', () => {
  initSidebar();
});
