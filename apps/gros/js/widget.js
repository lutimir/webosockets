/* ===== Groš widget =====
 * Vlož na svoj web jedným riadkom:
 *   <script src="https://gros.app/widget.js" data-creator="tvoje-meno"></script>
 * Vykreslí plávajúce tlačidlo "Podpor ma grošom", ktoré otvorí stránku tvorcu.
 */
(() => {
  "use strict";

  const script = document.currentScript;
  if (!script) return;

  const creator = script.dataset.creator || "demo";
  const position = script.dataset.position === "left" ? "left" : "right";
  const label = script.dataset.label || "🪙 Podpor ma grošom";

  // Cieľová appka — relatívne k umiestneniu widget.js
  const appUrl = new URL("../app.html#c/" + encodeURIComponent(creator), script.src).href;

  const btn = document.createElement("a");
  btn.href = appUrl;
  btn.target = "_blank";
  btn.rel = "noopener";
  btn.textContent = label;
  btn.setAttribute("aria-label", "Podporiť tvorcu " + creator);
  Object.assign(btn.style, {
    position: "fixed",
    bottom: "20px",
    [position]: "20px",
    zIndex: "9999",
    background: "#f5b942",
    color: "#1a1200",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: "15px",
    fontWeight: "700",
    padding: "12px 20px",
    borderRadius: "999px",
    textDecoration: "none",
    boxShadow: "0 4px 24px rgba(245, 185, 66, 0.45)",
    transition: "transform 0.15s ease",
    cursor: "pointer",
  });
  btn.addEventListener("mouseenter", () => { btn.style.transform = "scale(1.06)"; });
  btn.addEventListener("mouseleave", () => { btn.style.transform = "scale(1)"; });

  const mount = () => document.body.appendChild(btn);
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
