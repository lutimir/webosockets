/* ===== Groš — SPA =====
 * Store vrstva má dve implementácie:
 *  - RemoteStore: hovorí s Groš API (server/server.js, SQLite)
 *  - LocalStore:  demo režim v localStorage, keď appka beží bez backendu
 * Výber prebehne automaticky cez GET /api/health.
 * Platby sú simulované — checkout() sa v produkcii vymení za Stripe.
 */
(() => {
  "use strict";

  const LS_KEY = "gros.v1";
  const app = document.getElementById("app");
  let store = null;
  let me = null; // slug prihláseného tvorcu (cache pre synchrónny routing)

  /* ---------- utils ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

  const eur = (n) => n.toLocaleString("sk-SK", { style: "currency", currency: "EUR", maximumFractionDigits: n % 1 ? 2 : 0 });

  const timeAgo = (ts) => {
    const d = Math.floor((Date.now() - ts) / 86400000);
    if (d === 0) return "dnes";
    if (d === 1) return "včera";
    return `pred ${d} dňami`;
  };

  const total = (c) => c.tips.reduce((s, t) => s + t.amount, 0);

  const toast = (msg) => {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  };

  const confetti = () => {
    const colors = ["#f5b942", "#ff8a5c", "#7c5cff", "#3ecf8e", "#ff5c72"];
    for (let i = 0; i < 60; i++) {
      const p = document.createElement("div");
      p.className = "confetti-piece";
      p.style.left = Math.random() * 100 + "vw";
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 1.6 + Math.random() * 1.6 + "s";
      p.style.animationDelay = Math.random() * 0.4 + "s";
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 4000);
    }
  };

  /* ================= RemoteStore — Groš API ================= */
  const api = async (path, body) => {
    const r = await fetch("/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Chyba servera (" + r.status + ")");
    return j;
  };

  const RemoteStore = {
    mode: "remote",
    async init() { me = (await api("/me")).slug; },
    async getCreator(slug) {
      try { return await api("/creators/" + encodeURIComponent(slug)); }
      catch { return null; }
    },
    async register(data) { me = (await api("/register", data)).slug; },
    async login(slug, password) { me = (await api("/login", { slug, password })).slug; },
    async logout() { await api("/logout", {}); me = null; },
    async addTip(slug, tip) { return api("/creators/" + encodeURIComponent(slug) + "/tips", tip); },
  };

  /* ================= LocalStore — demo v prehliadači ================= */
  const seed = () => ({
    creators: {
      demo: {
        slug: "demo",
        name: "Miško Pixel",
        emoji: "🎮",
        tagline: "Robím indie webové hry a návody, ako si spraviť vlastnú. Každý groš ide na kávu a serverovňu.",
        goal: { title: "Nový herný server", target: 300 },
        tips: [
          { name: "Zuzka", amount: 5, msg: "Curling hra je super, hrali sme ju celý večer! 🥌", monthly: false, ts: Date.now() - 86400000 * 2 },
          { name: "Anonym", amount: 15, msg: "Len tak ďalej 💪", monthly: false, ts: Date.now() - 86400000 * 5 },
          { name: "Peter K.", amount: 3, msg: "", monthly: true, ts: Date.now() - 86400000 * 9 },
          { name: "Lucia", amount: 10, msg: "Za návod na websockety — konečne to chápem!", monthly: false, ts: Date.now() - 86400000 * 14 },
        ],
      },
    },
    me: null,
  });

  const LocalStore = {
    mode: "local",
    state: null,
    save() { localStorage.setItem(LS_KEY, JSON.stringify(this.state)); },
    async init() {
      try { this.state = JSON.parse(localStorage.getItem(LS_KEY)) || seed(); }
      catch { this.state = seed(); }
      me = this.state.me;
    },
    async getCreator(slug) { return this.state.creators[slug] ?? null; },
    async register(data) {
      if (this.state.creators[data.slug]) throw new Error("Táto adresa je už obsadená");
      this.state.creators[data.slug] = {
        slug: data.slug, name: data.name, emoji: data.emoji,
        tagline: data.tagline, goal: data.goal, tips: [],
      };
      this.state.me = me = data.slug;
      this.save();
    },
    async login(slug) {
      if (!this.state.creators[slug]) throw new Error("Tvorca neexistuje");
      this.state.me = me = slug; // demo režim — bez hesla
      this.save();
    },
    async logout() { this.state.me = me = null; this.save(); },
    async addTip(slug, tip) {
      const c = this.state.creators[slug];
      c.tips.unshift({ ...tip, ts: Date.now() });
      this.save();
      return c;
    },
  };

  /* ---------- router ---------- */
  async function route() {
    const h = location.hash.slice(1) || "home";
    document.getElementById("nav-dash").hidden = !me;
    const cta = document.getElementById("nav-cta");
    cta.textContent = me ? "Moja stránka" : "Vytvoriť stránku";
    cta.href = me ? "#c/" + me : "#onboard";

    if (h.startsWith("c/")) return renderCreator(h.slice(2));
    if (h === "onboard") return renderOnboard();
    if (h === "login") return renderLogin();
    if (h === "dash") return renderDash();
    return renderHome();
  }

  /* ---------- views ---------- */
  function renderHome() {
    app.innerHTML = `
      <div class="creator-hero">
        <div class="creator-avatar">🪙</div>
        <h1>Vitaj v Groši</h1>
        <p class="tagline">Vyber si, kam ďalej:</p>
      </div>
      <div class="grid grid-3">
        <a class="card" href="#c/demo"><div class="card-icon">🎮</div><h3>Demo stránka tvorcu</h3><p>Pozri, ako vyzerá stránka a skús prispieť.</p></a>
        <a class="card" href="#onboard"><div class="card-icon">✨</div><h3>Vytvor si vlastnú</h3><p>Za dve minúty máš svoju stránku podpory.</p></a>
        <a class="card" href="#login"><div class="card-icon">🔑</div><h3>Prihlásenie</h3><p>Už máš stránku? Prihlás sa do dashboardu.</p></a>
      </div>`;
  }

  function renderOnboard() {
    const emojis = ["🎨", "🎮", "🎵", "✍️", "📷", "🧑‍💻", "🎙️", "🧵"];
    const remote = store.mode === "remote";
    app.innerHTML = `
      <div class="creator-hero">
        <h1>Vytvor si stránku tvorcu</h1>
        <p class="tagline">Dve minúty a môžeš prijímať príspevky. Máš už účet? <a href="#login" style="color:var(--gold)">Prihlás sa</a>.</p>
      </div>
      <form class="onboard-card" id="onboard-form">
        <div class="field">
          <label>Tvoje meno / prezývka</label>
          <input name="name" required maxlength="40" placeholder="Napr. Miško Pixel">
        </div>
        <div class="field">
          <label>Adresa stránky</label>
          <input name="slug" required maxlength="30" pattern="[a-z0-9\\-]+" placeholder="misko-pixel">
          <div class="hint">gros.app/<b id="slug-echo">tvoje-meno</b> — malé písmená, čísla a pomlčky</div>
        </div>
        <div class="field">
          <label>Heslo</label>
          <input name="password" type="password" ${remote ? 'required minlength="6"' : ""} maxlength="100" placeholder="${remote ? "Aspoň 6 znakov" : "V demo režime nepovinné"}" autocomplete="new-password">
          <div class="hint">Na prihlásenie do tvojho dashboardu</div>
        </div>
        <div class="field">
          <label>Avatar</label>
          <div class="emoji-row" id="emoji-row">
            ${emojis.map((e, i) => `<button type="button" class="emoji-opt${i === 0 ? " sel" : ""}" data-e="${e}">${e}</button>`).join("")}
          </div>
        </div>
        <div class="field">
          <label>O čom tvoríš?</label>
          <textarea name="tagline" maxlength="200" placeholder="Pár viet o tvojej tvorbe…"></textarea>
        </div>
        <div class="field">
          <label>Cieľ (nepovinné)</label>
          <input name="goalTitle" maxlength="60" placeholder="Napr. Nový mikrofón">
        </div>
        <div class="field">
          <label>Cieľová suma (€)</label>
          <input name="goalTarget" type="number" min="10" max="100000" placeholder="300">
        </div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">🪙 Vytvoriť stránku</button>
      </form>`;

    let emoji = emojis[0];
    document.getElementById("emoji-row").addEventListener("click", (ev) => {
      const b = ev.target.closest(".emoji-opt");
      if (!b) return;
      document.querySelectorAll(".emoji-opt").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
      emoji = b.dataset.e;
    });

    const form = document.getElementById("onboard-form");
    form.slug.addEventListener("input", () => {
      form.slug.value = form.slug.value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
      document.getElementById("slug-echo").textContent = form.slug.value || "tvoje-meno";
    });

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const target = parseInt(form.goalTarget.value, 10);
      try {
        await store.register({
          slug: form.slug.value.trim(),
          name: form.name.value.trim(),
          password: form.password.value,
          emoji,
          tagline: form.tagline.value.trim() || "Podpor moju tvorbu grošom!",
          goal: form.goalTitle.value.trim() && target > 0
            ? { title: form.goalTitle.value.trim(), target }
            : null,
        });
      } catch (e) {
        toast("⚠️ " + e.message);
        return;
      }
      confetti();
      toast("🎉 Stránka vytvorená!");
      location.hash = "c/" + me;
    });
  }

  function renderLogin() {
    const local = store.mode === "local";
    app.innerHTML = `
      <div class="creator-hero">
        <h1>Prihlásenie</h1>
        <p class="tagline">${local ? "Demo režim — stačí adresa stránky, heslo sa nekontroluje." : "Prihlás sa do svojho dashboardu."}</p>
      </div>
      <form class="onboard-card" id="login-form">
        <div class="field">
          <label>Adresa stránky</label>
          <input name="slug" required maxlength="30" placeholder="misko-pixel" autocomplete="username">
        </div>
        <div class="field">
          <label>Heslo</label>
          <input name="password" type="password" ${local ? "" : "required"} maxlength="100" autocomplete="current-password">
        </div>
        <button class="btn btn-primary btn-block btn-lg" type="submit">🔑 Prihlásiť sa</button>
        <p style="margin-top:16px;text-align:center;font-size:0.9rem;color:var(--text-dim)">
          Nemáš účet? <a href="#onboard" style="color:var(--gold)">Vytvor si stránku</a>
        </p>
      </form>`;

    document.getElementById("login-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      try {
        await store.login(f.slug.value.trim().toLowerCase(), f.password.value);
      } catch (e) {
        toast("⚠️ " + e.message);
        return;
      }
      toast("👋 Vitaj späť!");
      location.hash = "dash";
    });
  }

  async function renderCreator(slug) {
    const c = await store.getCreator(slug);
    if (!c) {
      app.innerHTML = `<div class="creator-hero"><div class="creator-avatar">😢</div>
        <h1>Tvorca neexistuje</h1><p class="tagline">Skús <a href="#c/demo" style="color:var(--gold)">demo stránku</a>.</p></div>`;
      return;
    }
    const sum = total(c);
    const goalHtml = c.goal ? (() => {
      const pct = Math.min(100, Math.round((sum / c.goal.target) * 100));
      return `<div class="goal-card">
        <div class="goal-head"><h3>🎯 ${esc(c.goal.title)}</h3><span>${eur(sum)} / ${eur(c.goal.target)} · ${pct} %</span></div>
        <div class="goal-bar"><div class="goal-fill" style="width:${pct}%"></div></div>
      </div>`;
    })() : "";

    const wallHtml = c.tips.length
      ? [...c.tips].sort((a, b) => b.ts - a.ts).map((t) => `
        <div class="wall-item">
          <div class="wall-emoji">${t.monthly ? "🔁" : "🪙"}</div>
          <div class="wall-body">
            <div class="wall-head"><strong>${esc(t.name)}</strong><span class="amt">${eur(t.amount)}${t.monthly ? "/mes" : ""}</span></div>
            ${t.msg ? `<div class="wall-msg">„${esc(t.msg)}"</div>` : ""}
            <div class="wall-time">${timeAgo(t.ts)}</div>
          </div>
        </div>`).join("")
      : `<div class="wall-empty">Buď prvý, kto prispeje! 🪙</div>`;

    app.innerHTML = `
      <div class="creator-hero">
        <div class="creator-avatar">${c.emoji}</div>
        <h1>${esc(c.name)}</h1>
        <p class="tagline">${esc(c.tagline)}</p>
        <div class="creator-total">💛 ${eur(sum)} od ${c.tips.length} podporovateľov</div>
      </div>
      ${goalHtml}
      <div class="tip-card">
        <h3>Podpor tvorcu ${esc(c.name)}</h3>
        <div class="tip-amounts" id="tip-amounts">
          ${[2, 5, 10].map((a, i) => `<button class="tip-amt${i === 1 ? " sel" : ""}" data-a="${a}">${a} €</button>`).join("")}
        </div>
        <div class="tip-custom">
          <span>alebo vlastná suma:</span>
          <input id="tip-custom" type="number" min="1" max="10000" placeholder="7">
          <span>€</span>
        </div>
        <div class="field">
          <input id="tip-name" maxlength="40" placeholder="Tvoje meno (nepovinné)">
        </div>
        <div class="field tip-msg">
          <textarea id="tip-msg" maxlength="240" placeholder="Odkaz pre tvorcu (nepovinné)"></textarea>
        </div>
        <label class="monthly-toggle"><input type="checkbox" id="tip-monthly"> Prispievať každý mesiac 🔁</label>
        <button class="btn btn-primary btn-block btn-lg" id="tip-go">🪙 Prispieť</button>
      </div>
      <div class="wall">
        <h3>💬 Stena podpory</h3>
        ${wallHtml}
      </div>`;

    let amount = 5;
    document.getElementById("tip-amounts").addEventListener("click", (ev) => {
      const b = ev.target.closest(".tip-amt");
      if (!b) return;
      document.querySelectorAll(".tip-amt").forEach((x) => x.classList.remove("sel"));
      b.classList.add("sel");
      amount = parseInt(b.dataset.a, 10);
      document.getElementById("tip-custom").value = "";
    });
    document.getElementById("tip-custom").addEventListener("input", (ev) => {
      const v = parseFloat(ev.target.value);
      if (v > 0) {
        amount = v;
        document.querySelectorAll(".tip-amt").forEach((x) => x.classList.remove("sel"));
      }
    });

    document.getElementById("tip-go").addEventListener("click", () => {
      if (!(amount > 0)) { toast("⚠️ Zadaj platnú sumu"); return; }
      checkout(c, {
        amount: Math.round(amount * 100) / 100,
        name: document.getElementById("tip-name").value.trim() || "Anonym",
        msg: document.getElementById("tip-msg").value.trim(),
        monthly: document.getElementById("tip-monthly").checked,
      });
    });
  }

  /* Simulovaný checkout — v produkcii nahradiť redirectom na Stripe Checkout */
  function checkout(creator, tip) {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <div class="big-emoji">${creator.emoji}</div>
        <h3>Prispievaš ${eur(tip.amount)}${tip.monthly ? "/mesiac" : ""}</h3>
        <p>pre tvorcu <b>${esc(creator.name)}</b> · demo platba, nič sa nestrháva</p>
        <div class="pay-methods">
          <button class="pay-method" data-m="card">💳 Platobná karta</button>
          <button class="pay-method" data-m="apple">🍎 Apple Pay</button>
          <button class="pay-method" data-m="google">🤖 Google Pay</button>
        </div>
        <button class="close-link">Zrušiť</button>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });
    overlay.querySelector(".close-link").addEventListener("click", close);

    overlay.querySelectorAll(".pay-method").forEach((b) => b.addEventListener("click", async () => {
      b.textContent = "⏳ Spracúvam…";
      try {
        await store.addTip(creator.slug, tip);
      } catch (e) {
        close();
        toast("⚠️ " + e.message);
        return;
      }
      close();
      confetti();
      toast(`🎉 Ďakujeme! ${eur(tip.amount)} pre ${creator.name}`);
      route(); // refresh steny a súčtov
    }));
  }

  async function renderDash() {
    const c = me && await store.getCreator(me);
    if (!c) { location.hash = "login"; return; }
    const sum = total(c);
    const monthly = c.tips.filter((t) => t.monthly).reduce((s, t) => s + t.amount, 0);

    // príspevky za posledných 14 dní
    const days = Array.from({ length: 14 }, (_, i) => {
      const dayStart = Date.now() - (13 - i) * 86400000;
      return c.tips
        .filter((t) => t.ts >= dayStart - 43200000 && t.ts < dayStart + 43200000)
        .reduce((s, t) => s + t.amount, 0);
    });
    const max = Math.max(...days, 1);
    const pageUrl = location.origin + location.pathname + "#c/" + c.slug;
    const widgetCode = `<script src="https://gros.app/widget.js" data-creator="${c.slug}"><\/script>`;

    app.innerHTML = `
      <div class="dash-head">
        <h1>${c.emoji} Ahoj, ${esc(c.name)}!</h1>
        <div>
          <a class="btn btn-sm btn-ghost" href="#c/${c.slug}">Moja verejná stránka →</a>
          <button class="btn btn-sm btn-ghost" id="logout-btn">Odhlásiť</button>
        </div>
      </div>
      <div class="stat-row">
        <div class="stat"><div class="stat-v">${eur(sum)}</div><div class="stat-l">celkom vyzbierané</div></div>
        <div class="stat"><div class="stat-v">${c.tips.length}</div><div class="stat-l">podporovateľov</div></div>
        <div class="stat"><div class="stat-v">${eur(monthly)}</div><div class="stat-l">mesačná podpora</div></div>
        <div class="stat"><div class="stat-v">${c.tips.length ? eur(sum / c.tips.length) : "—"}</div><div class="stat-l">priemerný príspevok</div></div>
      </div>
      <div class="chart-card">
        <h3>📈 Posledných 14 dní</h3>
        <div class="bars">${days.map((v) => `<div class="bar" style="height:${Math.round((v / max) * 100)}%" title="${eur(v)}"></div>`).join("")}</div>
        <div class="bar-labels">${days.map((_, i) => `<span>${i === 0 ? "-13d" : i === 13 ? "dnes" : ""}</span>`).join("")}</div>
      </div>
      <div class="share-box">
        <h3>🔗 Zdieľaj svoju stránku</h3>
        <div class="share-row">
          <input readonly value="${esc(pageUrl)}" id="share-url">
          <button class="btn btn-sm btn-primary" id="copy-url">Kopírovať</button>
        </div>
      </div>
      <div class="share-box">
        <h3>🧩 Widget na tvoj web</h3>
        <div class="share-row">
          <input readonly value="${esc(widgetCode)}" id="widget-code">
          <button class="btn btn-sm btn-primary" id="copy-widget">Kopírovať</button>
        </div>
      </div>`;

    document.getElementById("logout-btn").addEventListener("click", async () => {
      await store.logout();
      toast("👋 Odhlásený");
      location.hash = "";
      route();
    });

    const copy = (id, label) => document.getElementById(id).addEventListener("click", () => {
      navigator.clipboard.writeText(document.getElementById(label).value)
        .then(() => toast("📋 Skopírované!"))
        .catch(() => toast("⚠️ Kopírovanie zlyhalo"));
    });
    copy("copy-url", "share-url");
    copy("copy-widget", "widget-code");
  }

  /* ---------- boot ---------- */
  (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch("/api/health", { signal: ctrl.signal });
      clearTimeout(t);
      store = r.ok && (await r.json()).service === "gros" ? RemoteStore : LocalStore;
    } catch {
      store = LocalStore;
    }
    await store.init();
    const foot = document.querySelector(".footer p");
    if (foot) foot.textContent = store.mode === "remote"
      ? "🪙 Groš — beží na Groš API (Node + SQLite). Platby sú simulované; produkčná verzia napojí Stripe."
      : "🪙 Groš — demo beží celé v prehliadači (localStorage). Platby sú simulované; produkčná verzia napojí Stripe.";
    window.addEventListener("hashchange", route);
    route();
  })();
})();
