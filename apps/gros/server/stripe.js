/* ===== Groš — Stripe integrácia (bez SDK, čistý fetch na Stripe REST API) =====
 * Zapína sa nastavením STRIPE_SECRET_KEY (server/.env alebo env premenná).
 * STRIPE_WEBHOOK_SECRET  — podpis webhookov (whsec_...)
 * STRIPE_API_BASE        — override pre testy (default https://api.stripe.com)
 */
"use strict";

const crypto = require("node:crypto");

const apiBase = () => process.env.STRIPE_API_BASE || "https://api.stripe.com";
const secretKey = () => process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET || "";

const enabled = () => !!secretKey();

async function request(method, path, params) {
  const res = await fetch(apiBase() + path, {
    method,
    headers: {
      Authorization: "Bearer " + secretKey(),
      ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Stripe error ${res.status}`);
  return data;
}

/* Vytvorí Checkout Session — mode=payment (jednorazovo) alebo subscription (mesačne). */
function createCheckoutSession({ creator, tip, origin }) {
  const cents = Math.round(tip.amount * 100);
  const params = {
    mode: tip.monthly ? "subscription" : "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(cents),
    "line_items[0][price_data][product_data][name]":
      `🪙 Groš pre ${creator.name}` + (tip.monthly ? " (mesačne)" : ""),
    success_url: `${origin}/app.html?paid=1&session_id={CHECKOUT_SESSION_ID}#c/${creator.slug}`,
    cancel_url: `${origin}/app.html#c/${creator.slug}`,
    "metadata[slug]": creator.slug,
    "metadata[name]": tip.name,
    "metadata[msg]": tip.msg,
    "metadata[monthly]": tip.monthly ? "1" : "0",
  };
  if (tip.monthly) params["line_items[0][price_data][recurring][interval]"] = "month";
  return request("POST", "/v1/checkout/sessions", params);
}

const getCheckoutSession = (id) =>
  request("GET", "/v1/checkout/sessions/" + encodeURIComponent(id));

/* Overenie podpisu webhooku podľa Stripe schémy: header "t=...,v1=..." ,
 * podpis = HMAC-SHA256(secret, `${t}.${rawBody}`). Tolerancia 5 minút. */
function verifyWebhook(rawBody, sigHeader) {
  const secret = webhookSecret();
  if (!secret || !sigHeader) return false;
  const parts = Object.fromEntries(
    sigHeader.split(",").map((p) => p.split("=").map((s) => s.trim()))
  );
  const t = parseInt(parts.t, 10);
  if (!t || !parts.v1 || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`).digest();
  let given;
  try { given = Buffer.from(parts.v1, "hex"); } catch { return false; }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/* Z dokončenej Checkout Session poskladá tip pre db.addTip. */
function tipFromSession(session) {
  const m = session.metadata || {};
  if (!m.slug || !(session.amount_total > 0)) return null;
  return {
    slug: m.slug,
    tip: {
      name: (m.name || "Anonym").slice(0, 40),
      amount: session.amount_total / 100,
      msg: (m.msg || "").slice(0, 240),
      monthly: m.monthly === "1",
      stripeSession: session.id,
    },
  };
}

module.exports = { enabled, createCheckoutSession, getCheckoutSession, verifyWebhook, tipFromSession };
