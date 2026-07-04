/* ===== Klipp — demo SPA (prompt 1/10) =====
 * Celý stav žije v localStorage. Zhliadnutia sú simulované — v produkcii
 * ich bude sťahovať backend z API platforiem (TikTok / YouTube / IG).
 */
(() => {
  "use strict";

  const LS_KEY = "klipp.v1";
  const app = document.getElementById("app");

  const PLATFORMS = { TikTok: "🎵", Shorts: "▶️", Reels: "📸" };

  /* ---------- utils ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const eur = (n) => n.toLocaleString("sk-SK", { style: "currency", currency: "EUR", maximumFractionDigits: n % 1 ? 2 : 0 });

  const views = (n) =>
    n >= 1e6 ? (n / 1e6).toLocaleString("sk-SK", { maximumFractionDigits: 1 }) + " mil."
    : n >= 1e3 ? (n / 1e3).toLocaleString("sk-SK", { maximumFractionDigits: 1 }) + " tis."
    : String(n);

  const timeAgo = (ts) => {
    const d = Math.floor((Date.now() - ts) / 86400000);
    if (d === 0) return "dnes";
    if (d === 1) return "včera";
    return `pred ${d} dňami`;
  };

  const uid = () => Math.random().toString(36).slice(2, 10);

  const toast = (msg) => {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  };

  /* ---------- state ---------- */
  const seed = () => {
    const day = 86400000;
    return {
      role: "clipper",
      clipperName: "Ty",
      campaigns: [
        {
          id: "c-gamer", title: "Klipy z mojich streamov", creatorName: "PeXo Gaming", emoji: "🎮",
          platforms: ["TikTok", "Shorts"], rate: 3, budget: 500, mine: false, open: true, ts: Date.now() - day * 12,
          rules: "• Klipy 15–60 sekúnd z mojich Twitch streamov\n• Titulky povinné, logo nechaj v rohu\n• Žiadny clickbait mimo kontextu\n• Max 3 klipy denne na účet",
        },
        {
          id: "c-podcast", title: "Najlepšie momenty z podcastu", creatorName: "Silná Zostava", emoji: "🎙️",
          platforms: ["TikTok", "Reels", "Shorts"], rate: 4.5, budget: 1200, mine: false, open: true, ts: Date.now() - day * 6,
          rules: "• Vystrihni pointy, nie celé odpovede\n• Uvádzaj hosťa v popise\n• Formát 9:16, čisté strihy",
        },
        {
          id: "c-fitness", title: "Fitness výzva — 30 dní", creatorName: "Janka Fit", emoji: "💪",
          platforms: ["Reels"], rate: 2.5, budget: 200, mine: true, open: true, ts: Date.now() - day * 3,
          rules: "• Iba klipy z výzvy #Janka30\n• Pozitívny tón, žiadne body-shaming komentáre",
        },
      ],
      clips: [
        { id: uid(), campId: "c-gamer", clipper: "klipmaster_88", url: "https://tiktok.com/@klipmaster_88/video/731", platform: "TikTok", viewsN: 48200, status: "approved", ts: Date.now() - day * 9, viral: 1.4 },
        { id: uid(), campId: "c-gamer", clipper: "Ty", url: "https://tiktok.com/@ty/video/992", platform: "TikTok", viewsN: 12400, status: "approved", ts: Date.now() - day * 4, viral: 1.1 },
        { id: uid(), campId: "c-podcast", clipper: "Ty", url: "https://youtube.com/shorts/abc123", platform: "Shorts", viewsN: 3150, status: "pending", ts: Date.now() - day * 1, viral: 2.2 },
        { id: uid(), campId: "c-fitness", clipper: "strihacka_lu", url: "https://instagram.com/reel/xyz789", platform: "Reels", viewsN: 8900, status: "pending", ts: Date.now() - day * 1, viral: 0.9 },
        { id: uid(), campId: "c-fitness", clipper: "viralvlado", url: "https://instagram.com/reel/qq456", platform: "Reels", viewsN: 21700, status: "approved", ts: Date.now() - day * 2, viral: 1.7 },
      ],
    };
  };

  let state;
  try { state = JSON.parse(localStorage.getItem(LS_KEY)) || seed(); }
  catch { state = seed(); }
  const save = () => localStorage.setItem(LS_KEY, JSON.stringify(state));

  /* ---------- doménová logika ---------- */
  const campaign = (id) => state.campaigns.find((c) => c.id === id);
  const campClips = (id) => state.clips.filter((k) => k.campId === id);

  /* Zárobky schválených klipov v poradí odoslania, kumulatívne zastropované rozpočtom. */
  function earningsFor(camp) {
    const out = new Map();
    let left = camp.budget;
    for (const k of campClips(camp.id).filter((k) => k.status === "approved").sort((a, b) => a.ts - b.ts)) {
      const raw = Math.round((k.viewsN / 1000) * camp.rate * 100) / 100;
      const earn = Math.max(0, Math.min(raw, left));
      out.set(k.id, earn);
      left -= earn;
    }
    return out;
  }

  const spentFor = (camp) => {
    let s = 0;
    earningsFor(camp).forEach((v) => { s += v; });
    return Math.round(s * 100) / 100;
  };

  const clipEarn = (k) => {
    const camp = campaign(k.campId);
    if (!camp) return 0;
    if (k.status === "approved") return earningsFor(camp).get(k.id) ?? 0;
    if (k.status === "pending") // potenciál — informatívne, bez stropu
      return Math.round((k.viewsN / 1000) * camp.rate * 100) / 100;
    return 0;
  };

  /* Simulovaný sync zhliadnutí — v produkcii nahradí čítanie z API platforiem. */
  function syncViews(clips) {
    let synced = 0;
    for (const k of clips) {
      if (k.status === "rejected") continue;
      const ageDays = Math.max(1, (Date.now() - k.ts) / 86400000);
      const growth = Math.round(k.viral * (50 + Math.random() * 850) / Math.sqrt(ageDays));
      k.viewsN += growth;
      synced++;
    }
    save();
    return synced;
  }

  /* ---------- router ---------- */
  function route() {
    const h = location.hash.slice(1);
    document.getElementById("nav-clipper").hidden = state.role !== "clipper";
    document.getElementById("nav-influencer").hidden = state.role !== "influencer";
    document.querySelectorAll("#role-switch button").forEach((b) =>
      b.classList.toggle("active", b.dataset.role === state.role));

    if (h.startsWith("k/")) return renderCampaign(h.slice(2));
    if (h === "new") return renderNew();
    if (h === "moje") return renderClipperDash();
    if (h === "kampane") return renderInfluencerDash();
    return renderList();
  }

  document.getElementById("role-switch").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-role]");
    if (!b) return;
    state.role = b.dataset.role;
    save();
    location.hash = state.role === "influencer" ? "kampane" : "";
    route();
  });

  /* ---------- views ---------- */
  function campCardHtml(c) {
    const spent = spentFor(c);
    const pct = Math.min(100, Math.round((spent / c.budget) * 100));
    const n = campClips(c.id).length;
    return `
      <a class="camp-card${c.open ? "" : " camp-closed"}" href="#k/${c.id}">
        <div class="camp-top">
          <div class="camp-title">
            <span class="emoji">${c.emoji}</span>
            <div><h3>${esc(c.title)}</h3><span class="by">${esc(c.creatorName)}${c.mine ? " · tvoja kampaň" : ""}</span></div>
          </div>
          <span class="rate-pill">${eur(c.rate)} / 1000 👁️</span>
        </div>
        <div class="camp-meta">
          ${c.platforms.map((p) => `<span class="plat-tag">${PLATFORMS[p]} ${p}</span>`).join("")}
          <span>✂️ ${n} klipov</span>
          <span class="status-pill ${c.open ? "open" : "closed"}">${c.open ? "otvorená" : "uzavretá"}</span>
        </div>
        <div class="budget-bar"><div class="budget-fill" style="width:${pct}%"></div></div>
        <div class="budget-label"><span>vyplatené ${eur(spent)}</span><span>rozpočet ${eur(c.budget)}</span></div>
      </a>`;
  }

  function renderList() {
    const open = state.campaigns.filter((c) => c.open).sort((a, b) => b.ts - a.ts);
    const closed = state.campaigns.filter((c) => !c.open);
    app.innerHTML = `
      <div class="page-head">
        <h1>🔥 Otvorené kampane</h1>
        ${state.role === "influencer" ? '<a class="btn btn-sm btn-primary" href="#new">+ Nová kampaň</a>' : ""}
      </div>
      <p class="page-sub">Vyber si kampaň, nastrihaj klipy a zarábaj za každých 1 000 zhliadnutí.</p>
      ${open.map(campCardHtml).join("") || '<div class="empty-note">Zatiaľ žiadne kampane — vypíš prvú!</div>'}
      ${closed.length ? `<h2 style="font-size:1.1rem;margin:28px 0 14px;color:var(--text-dim)">Uzavreté</h2>` + closed.map(campCardHtml).join("") : ""}`;
  }

  function clipRowHtml(k, { showClipper = false, moderate = false, mineView = false } = {}) {
    const earn = clipEarn(k);
    const label = k.status === "approved" ? "schválený" : k.status === "pending" ? "čaká" : "zamietnutý";
    return `
      <div class="clip-row" data-clip="${k.id}">
        <div class="clip-plat">${PLATFORMS[k.platform] ?? "🎬"}</div>
        <div class="clip-body">
          <div class="clip-url">${esc(k.url)}</div>
          <div class="clip-sub">${showClipper ? esc(k.clipper) + " · " : ""}${k.platform} · ${timeAgo(k.ts)} · <span class="status-pill ${k.status}">${label}</span></div>
        </div>
        <div class="clip-nums">
          <div class="clip-views" data-views>${views(k.viewsN)} 👁️</div>
          <div class="clip-earn">${k.status === "rejected" ? "—" : (k.status === "pending" && (moderate || mineView) ? "~" : "") + eur(earn)}</div>
        </div>
        ${moderate && k.status === "pending" ? `
          <div class="clip-actions">
            <button class="btn btn-sm btn-primary" data-approve="${k.id}">✓ Schváliť</button>
            <button class="btn btn-sm btn-danger" data-reject="${k.id}">✕</button>
          </div>` : ""}
      </div>`;
  }

  function renderCampaign(id) {
    const c = campaign(id);
    if (!c) { app.innerHTML = '<div class="empty-note">Kampaň neexistuje. <a href="#" style="color:var(--lime)">Späť na zoznam</a></div>'; return; }
    const spent = spentFor(c);
    const clips = campClips(id).sort((a, b) => b.ts - a.ts);
    const isOwner = c.mine && state.role === "influencer";
    const canSubmit = state.role === "clipper" && c.open && spent < c.budget;

    app.innerHTML = `
      <a href="#" style="color:var(--text-dim);font-size:0.9rem">← všetky kampane</a>
      <div class="page-head" style="margin-top:10px">
        <div class="camp-title">
          <span class="emoji" style="font-size:2.4rem">${c.emoji}</span>
          <div><h1>${esc(c.title)}</h1><span class="by" style="color:var(--text-dim)">${esc(c.creatorName)}</span></div>
        </div>
        <span class="rate-pill">${eur(c.rate)} / 1000 👁️</span>
      </div>
      <div class="camp-meta" style="margin-bottom:6px">
        ${c.platforms.map((p) => `<span class="plat-tag">${PLATFORMS[p]} ${p}</span>`).join("")}
        <span class="status-pill ${c.open ? "open" : "closed"}">${c.open ? "otvorená" : "uzavretá"}</span>
      </div>
      <div class="budget-bar"><div class="budget-fill" style="width:${Math.min(100, Math.round((spent / c.budget) * 100))}%"></div></div>
      <div class="budget-label"><span>vyplatené ${eur(spent)}</span><span>rozpočet ${eur(c.budget)}</span></div>
      <div class="rules-card"><h3>📋 Pravidlá kampane</h3>${esc(c.rules)}</div>

      ${canSubmit ? `
      <div class="form-card">
        <h3 style="margin-bottom:16px">✂️ Odoslať klip</h3>
        <div class="field">
          <label>Link na tvoj klip</label>
          <input id="clip-url" type="url" placeholder="https://tiktok.com/@ty/video/…">
        </div>
        <div class="field">
          <label>Platforma</label>
          <div class="check-row" id="plat-row">
            ${c.platforms.map((p, i) => `<span class="check-tag${i === 0 ? " sel" : ""}" data-p="${p}">${PLATFORMS[p]} ${p}</span>`).join("")}
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="clip-send">Odoslať na schválenie</button>
      </div>` : state.role === "clipper" ? '<div class="empty-note">Kampaň už neprijíma nové klipy.</div>' : ""}

      <div class="page-head" style="margin-top:30px">
        <h2 style="font-size:1.15rem">🎬 Klipy v kampani (${clips.length})</h2>
        ${isOwner ? "" : `<button class="btn btn-sm btn-ghost" id="sync-btn">🔄 Sync zhliadnutí</button>`}
      </div>
      ${clips.map((k) => clipRowHtml(k, { showClipper: true, moderate: isOwner })).join("") || '<div class="empty-note">Buď prvý klipper v tejto kampani! ✂️</div>'}`;

    if (canSubmit) {
      let platform = c.platforms[0];
      document.getElementById("plat-row").addEventListener("click", (ev) => {
        const t = ev.target.closest(".check-tag");
        if (!t) return;
        document.querySelectorAll("#plat-row .check-tag").forEach((x) => x.classList.remove("sel"));
        t.classList.add("sel");
        platform = t.dataset.p;
      });
      document.getElementById("clip-send").addEventListener("click", () => {
        const url = document.getElementById("clip-url").value.trim();
        try { new URL(url); } catch { toast("⚠️ Zadaj platný link na klip"); return; }
        state.clips.push({
          id: uid(), campId: c.id, clipper: state.clipperName, url, platform,
          viewsN: 0, status: "pending", ts: Date.now(),
          viral: 0.5 + Math.random() * 2, // simulácia virality klipu
        });
        save();
        toast("🚀 Klip odoslaný na schválenie!");
        route();
      });
    }

    document.getElementById("sync-btn")?.addEventListener("click", () => {
      syncViews(clips);
      toast("🔄 Zhliadnutia aktualizované");
      route();
      document.querySelectorAll("[data-views]").forEach((el) => el.classList.add("bumped"));
    });

    app.addEventListener("click", (ev) => {
      const ap = ev.target.closest("[data-approve]");
      const rj = ev.target.closest("[data-reject]");
      if (!ap && !rj) return;
      const k = state.clips.find((x) => x.id === (ap?.dataset.approve || rj?.dataset.reject));
      if (!k) return;
      k.status = ap ? "approved" : "rejected";
      save();
      toast(ap ? "✅ Klip schválený — začína zarábať" : "🚫 Klip zamietnutý");
      route();
    }, { once: true });
  }

  function renderNew() {
    if (state.role !== "influencer") {
      app.innerHTML = `<div class="empty-note">Kampane vypisujú influenceri.<br><br>
        <button class="btn btn-primary" id="switch-inf">🎤 Prepnúť sa na influencera</button></div>`;
      document.getElementById("switch-inf").addEventListener("click", () => {
        state.role = "influencer"; save(); route();
      });
      return;
    }
    app.innerHTML = `
      <div class="page-head"><h1>🎤 Nová kampaň</h1></div>
      <form class="form-card" id="new-form">
        <div class="field">
          <label>Názov kampane</label>
          <input name="title" required maxlength="60" placeholder="Napr. Klipy z mojich streamov">
        </div>
        <div class="field">
          <label>Tvoje meno / značka</label>
          <input name="creatorName" required maxlength="40" placeholder="PeXo Gaming">
        </div>
        <div class="field-row">
          <div class="field">
            <label>Sadzba za 1 000 zhliadnutí (€)</label>
            <input name="rate" type="number" required min="0.5" max="50" step="0.1" placeholder="3">
          </div>
          <div class="field">
            <label>Celkový rozpočet (€)</label>
            <input name="budget" type="number" required min="20" max="100000" placeholder="500">
          </div>
        </div>
        <div class="field">
          <label>Platformy</label>
          <div class="check-row" id="plat-pick">
            ${Object.entries(PLATFORMS).map(([p, e], i) => `<span class="check-tag${i === 0 ? " sel" : ""}" data-p="${p}">${e} ${p}</span>`).join("")}
          </div>
        </div>
        <div class="field">
          <label>Pravidlá pre klipperov</label>
          <textarea name="rules" maxlength="600" rows="4" placeholder="• Klipy 15–60 s&#10;• Titulky povinné…"></textarea>
        </div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">🚀 Spustiť kampaň</button>
        <p class="hint" style="margin-top:12px;color:var(--text-dim);font-size:0.85rem">V produkcii sa rozpočet pri spustení zamkne platbou vopred — klipperi tak vedia, že odmeny sú kryté.</p>
      </form>`;

    const picked = new Set(["TikTok"]);
    document.getElementById("plat-pick").addEventListener("click", (ev) => {
      const t = ev.target.closest(".check-tag");
      if (!t) return;
      const p = t.dataset.p;
      if (picked.has(p) && picked.size > 1) { picked.delete(p); t.classList.remove("sel"); }
      else { picked.add(p); t.classList.add("sel"); }
    });

    document.getElementById("new-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      const f = ev.target;
      state.campaigns.push({
        id: "c-" + uid(),
        title: f.title.value.trim(),
        creatorName: f.creatorName.value.trim(),
        emoji: "🎤",
        platforms: [...picked],
        rate: parseFloat(f.rate.value),
        budget: parseFloat(f.budget.value),
        rules: f.rules.value.trim() || "Bez špeciálnych pravidiel — strihaj, čo najlepšie vieš.",
        mine: true, open: true, ts: Date.now(),
      });
      save();
      toast("🎉 Kampaň spustená!");
      location.hash = "kampane";
    });
  }

  function renderClipperDash() {
    const mine = state.clips.filter((k) => k.clipper === state.clipperName).sort((a, b) => b.ts - a.ts);
    const earned = mine.filter((k) => k.status === "approved").reduce((s, k) => s + clipEarn(k), 0);
    const totalViews = mine.reduce((s, k) => s + (k.status === "rejected" ? 0 : k.viewsN), 0);
    const pending = mine.filter((k) => k.status === "pending").length;

    app.innerHTML = `
      <div class="page-head">
        <h1>✂️ Moje klipy</h1>
        <button class="btn btn-sm btn-primary" id="sync-btn">🔄 Sync zhliadnutí</button>
      </div>
      <div class="stat-row">
        <div class="stat"><div class="stat-v">${eur(Math.round(earned * 100) / 100)}</div><div class="stat-l">zarobené</div></div>
        <div class="stat"><div class="stat-v">${views(totalViews)}</div><div class="stat-l">zhliadnutí spolu</div></div>
        <div class="stat"><div class="stat-v">${mine.length}</div><div class="stat-l">klipov</div></div>
        <div class="stat"><div class="stat-v">${pending}</div><div class="stat-l">čaká na schválenie</div></div>
      </div>
      ${mine.map((k) => {
        const c = campaign(k.campId);
        return `<a href="#k/${k.campId}" style="display:block">${clipRowHtml(k, { mineView: true })}</a>`
          .replace('<div class="clip-sub">', `<div class="clip-sub">${c ? esc(c.emoji + " " + c.title) + " · " : ""}`);
      }).join("") || '<div class="empty-note">Zatiaľ žiadne klipy — <a href="#" style="color:var(--lime)">vyber si kampaň</a> a začni! ✂️</div>'}`;

    document.getElementById("sync-btn").addEventListener("click", () => {
      const n = syncViews(mine);
      toast(n ? "🔄 Aktualizovaných " + n + " klipov" : "Nie je čo synchronizovať");
      route();
      document.querySelectorAll("[data-views]").forEach((el) => el.classList.add("bumped"));
    });
  }

  function renderInfluencerDash() {
    const mine = state.campaigns.filter((c) => c.mine).sort((a, b) => b.ts - a.ts);
    const allClips = mine.flatMap((c) => campClips(c.id));
    const spent = mine.reduce((s, c) => s + spentFor(c), 0);
    const totalViews = allClips.filter((k) => k.status === "approved").reduce((s, k) => s + k.viewsN, 0);
    const pending = allClips.filter((k) => k.status === "pending");

    app.innerHTML = `
      <div class="page-head">
        <h1>🎤 Moje kampane</h1>
        <a class="btn btn-sm btn-primary" href="#new">+ Nová kampaň</a>
      </div>
      <div class="stat-row">
        <div class="stat"><div class="stat-v">${eur(spent)}</div><div class="stat-l">vyplatené klipperom</div></div>
        <div class="stat"><div class="stat-v">${views(totalViews)}</div><div class="stat-l">získaných zhliadnutí</div></div>
        <div class="stat"><div class="stat-v">${allClips.length}</div><div class="stat-l">klipov celkom</div></div>
        <div class="stat"><div class="stat-v">${pending.length}</div><div class="stat-l">čaká na schválenie</div></div>
      </div>
      ${spent > 0 ? `<p class="page-sub">Priemerná cena zhliadnutia: <b style="color:var(--lime)">${(spent / Math.max(totalViews, 1) * 1000).toLocaleString("sk-SK", { style: "currency", currency: "EUR" })} / 1000 👁️</b> — platíš len za výsledok.</p>` : ""}
      ${pending.length ? `<h2 style="font-size:1.1rem;margin:8px 0 14px">⏳ Na schválenie</h2>` +
        pending.map((k) => clipRowHtml(k, { showClipper: true, moderate: true })).join("") : ""}
      <h2 style="font-size:1.1rem;margin:26px 0 14px">📢 Kampane</h2>
      ${mine.map(campCardHtml).join("") || '<div class="empty-note">Zatiaľ žiadna kampaň — vypíš prvú!</div>'}`;

    app.addEventListener("click", (ev) => {
      const ap = ev.target.closest("[data-approve]");
      const rj = ev.target.closest("[data-reject]");
      if (!ap && !rj) return;
      ev.preventDefault();
      const k = state.clips.find((x) => x.id === (ap?.dataset.approve || rj?.dataset.reject));
      if (!k) return;
      k.status = ap ? "approved" : "rejected";
      save();
      toast(ap ? "✅ Klip schválený — začína zarábať" : "🚫 Klip zamietnutý");
      route();
    }, { once: true });
  }

  window.addEventListener("hashchange", route);
  route();
})();
