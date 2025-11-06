/* =========================================================
 * app.js — Inventory (Frontend)
 * Fokus: konek GAS stabil (GET/POST sederhana, tanpa CORS custom)
 * =======================================================*/
(function () {
  "use strict";

  // ---------- Helpers UI ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const fmt = (n) => new Intl.NumberFormat("ja-JP").format(Number(n || 0));
  function toast(msg){ alert(msg); }

  // ---------- API (fix bawaan) ----------
  async function api(action, { method="GET", body=null }={}) {
    if (!window.CONFIG || !CONFIG.BASE_URL) {
      throw new Error("config.js tidak dimuat atau BASE_URL kosong");
    }
    const base = CONFIG.BASE_URL.replace(/\/$/, "");
    const apikey = encodeURIComponent(CONFIG.API_KEY || "");
    const url = `${base}?action=${encodeURIComponent(action)}&apikey=${apikey}&_=${Date.now()}`;

    let res;
    if (method === "GET") {
      res = await fetch(url, { cache: "no-cache" });              // TIDAK pakai mode/headers aneh
    } else {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },          // hanya header standar
        body: JSON.stringify({ ...(body||{}), apikey: CONFIG.API_KEY })
      });
    }
    if (!res.ok) throw new Error(`[${res.status}] ${res.statusText}`);
    const data = await res.json().catch(()=>{ throw new Error("Respon bukan JSON"); });
    if (data && data.ok === false) throw new Error(data.error || "API error");
    return data;
  }

  // ---------- Dashboard ----------
  async function renderDashboard() {
    const [items, users, series] = await Promise.all([
      api("items", { method: "GET" }),
      api("users", { method: "GET" }),
      api("statsMonthlySeries", { method: "GET" })
    ]);

    $("#metric-total-items") && ($("#metric-total-items").textContent = (items||[]).length);
    const low = (items||[]).filter(it => Number(it.stock||0) <= Number(it.min||0)).length;
    $("#metric-low-stock") && ($("#metric-low-stock").textContent = low);
    $("#metric-users") && ($("#metric-users").textContent = (users||[]).length);

    // chart dummy (tanpa lib) → cukup set legend/badge
    const last = (series||[]).at(-1) || { in:0, out:0 };
    $("#badge-in")  && ($("#badge-in").textContent  = fmt(last.in||0));
    $("#badge-out") && ($("#badge-out").textContent = fmt(last.out||0));
  }

  // ---------- IO (form sederhana untuk bukti konek) ----------
  function bindIO() {
    const form = $("#form-io");
    if (!form) return;

    $("#btn-io-lookup")?.addEventListener("click", async () => {
      try {
        const code = ($("#io-code").value || "").trim();
        if (!code) return;
        const r = await api("itemByCode", { method: "POST", body: { code } });
        if (!r?.ok) return toast("アイテムが見つかりません");
        $("#io-name").value  = r.item?.name  || "";
        $("#io-price").value = r.item?.price || 0;
        $("#io-stock").value = r.item?.stock || 0;
      } catch (e) { toast("検索失敗: " + e.message); }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const who = JSON.parse(localStorage.getItem("currentUser") || '{"id":"ADMIN001"}'); // fallback
        const payload = {
          userId: who.id,
          code: $("#io-code").value,
          qty: Number($("#io-qty").value||0),
          unit: $("#io-unit").value,
          type: $("#io-type").value
        };
        const r = await api("log", { method: "POST", body: payload });
        if (r?.ok) { toast("登録しました"); renderDashboard(); }
      } catch (e2) { toast("登録失敗: " + e2.message); }
    });
  }

  // ---------- Boot ----------
  window.addEventListener("DOMContentLoaded", async () => {
    // Cek config.js terbaca
    if (!window.CONFIG || !CONFIG.BASE_URL) {
      console.error("CONFIG kosong. Pastikan <script> config.js dibuat sebelum app.js");
      toast("CONFIG kosong. Periksa config.js");
      return;
    }

    // Cek API cepat → tampilkan error jelas (kalau salah URL / bukan /exec)
    try {
      await api("items", { method: "GET" });
    } catch (e) {
      console.error("API check failed:", e);
      toast("Gagal konek ke backend: " + e.message + "\nPastikan URL GAS /exec & akses publik.");
      return;
    }

    // jika lolos, render dashboard & bind IO
    try { await renderDashboard(); } catch (e) { console.error(e); toast("Gagal load dashboard: " + e.message); }
    bindIO();
  });
})();
