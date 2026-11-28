const { requirePhoneVerified } = require("../lib/phone-verification");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://khggputlakhupiypybic.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_NKmlxY9hjAVDeSD4FEhZhQ_8_AOunOe";
const PRICE_ID = process.env.STRIPE_PREMIUM_PRICE_ID || "price_1UaATHC074K6xfn9pPQfJ33F";
const APP_URL = process.env.APP_URL || "https://love-story-nowa.vercel.app";

function reply(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
function serverKey() {
  let key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  try { const bundle = JSON.parse(process.env.SUPABASE_SECRET_KEYS || "{}"); key = key || bundle.default || bundle.secret_key || ""; } catch (_) {}
  return key;
}
function supabaseHeaders(key, extra = {}) {
  const h = { apikey: key, ...extra };
  if (!key.startsWith("sb_secret_")) h.Authorization = "Bearer " + key;
  return h;
}
async function db(path, key, options = {}) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers: supabaseHeaders(key, { "Content-Type": "application/json", ...(options.headers || {}) })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error("Database request failed: " + response.status);
  return raw ? JSON.parse(raw) : [];
}
async function authUser(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\\s+/i, "");
  if (!token) return null;
  const response = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token }
  });
  return response.ok ? response.json() : null;
}
async function stripeRequest(path, params, idempotencyKey) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not configured");
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + secret,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
    body: params
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error?.message || "Stripe request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { error: "Method not allowed" });
  }
  const key = serverKey();
  if (!key || !SUPABASE_PUBLISHABLE_KEY) return reply(res, 503, { error: "Brak konfiguracji serwera." });
  try {
    const user = await authUser(req);
    if (!user?.id || !user.email) return reply(res, 401, { error: "Zaloguj się ponownie." });
    if (!await requirePhoneVerified(user.id, key)) return reply(res, 403, { error: "Najpierw potwierdź numer telefonu." });
    const accounts = await db("partner_company_accounts?user_id=eq." + encodeURIComponent(user.id) + "&select=user_id,company_name,account_status&limit=1", key);
    if (!accounts.length || accounts[0].account_status !== "active") {
      return reply(res, 403, { error: "Abonament Premium jest dostępny tylko dla aktywnego konta firmy." });
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const action = body.action || "status";
    const rows = await db(
      "partner_company_subscriptions?user_id=eq." + encodeURIComponent(user.id) +
      "&select=stripe_customer_id,stripe_subscription_id,status,current_period_end,cancel_at_period_end,created_at&order=created_at.desc&limit=10",
      key
    );
    const latest = rows[0] || null;
    if (action === "status") {
      return reply(res, 200, {
        subscribed: !!latest && ["active", "trialing"].includes(latest.status) &&
          (!latest.current_period_end || new Date(latest.current_period_end).getTime() > Date.now()),
        status: latest?.status || "none",
        current_period_end: latest?.current_period_end || null,
        cancel_at_period_end: !!latest?.cancel_at_period_end
      });
    }
    if (action === "checkout") {
      if (latest && ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(latest.status)) {
        return reply(res, 409, { error: "Masz już subskrypcję lub rozpoczętą płatność. Użyj zarządzania subskrypcją." });
      }
      if (!PRICE_ID) return reply(res, 503, { error: "Brak skonfigurowanej ceny Premium." });
      const form = new URLSearchParams();
      form.set("mode", "subscription");
      form.set("line_items[0][price]", PRICE_ID);
      form.set("line_items[0][quantity]", "1");
      form.set("success_url", APP_URL + "/panel-firmy.html?premium=success");
      form.set("cancel_url", APP_URL + "/panel-firmy.html?premium=cancelled");
      form.set("client_reference_id", user.id);
      form.set("customer_email", user.email);
      form.set("metadata[supabase_user_id]", user.id);
      form.set("metadata[company_name]", String(accounts[0].company_name || "").slice(0, 160));
      form.set("subscription_data[metadata][supabase_user_id]", user.id);
      form.set("subscription_data[metadata][plan]", "company_premium");
      const session = await stripeRequest("checkout/sessions", form, "ls-company-premium-" + user.id + "-" + Math.floor(Date.now() / 600000));
      if (!session.url) return reply(res, 502, { error: "Stripe nie zwrócił adresu płatności." });
      return reply(res, 200, { url: session.url });
    }
    if (action === "portal") {
      const customerRow = rows.find(row => row.stripe_customer_id);
      if (!customerRow) return reply(res, 404, { error: "Nie znaleziono klienta Stripe dla tego konta." });
      const form = new URLSearchParams();
      form.set("customer", customerRow.stripe_customer_id);
      form.set("return_url", APP_URL + "/panel-firmy.html");
      const portal = await stripeRequest("billing_portal/sessions", form);
      if (!portal.url) return reply(res, 502, { error: "Stripe nie zwrócił adresu panelu subskrypcji." });
      return reply(res, 200, { url: portal.url });
    }
    return reply(res, 400, { error: "Nieznana operacja." });
  } catch (error) {
    console.error("Company Premium API:", error.message);
    const status = error.status && error.status >= 400 && error.status < 500 ? 400 : 503;
    return reply(res, status, { error: status === 400 ? "Nie udało się wykonać operacji Stripe." : "Płatności są jeszcze konfigurowane." });
  }
};
