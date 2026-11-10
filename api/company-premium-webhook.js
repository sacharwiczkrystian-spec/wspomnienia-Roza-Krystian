const crypto = require("crypto");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://khggputlakhupiypybic.supabase.co";
module.exports.config = { api: { bodyParser: false } };

function reply(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
function serverKey() {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}
function serviceHeaders(key, extra = {}) {
  const h = { apikey: key, ...extra };
  if (!key.startsWith("sb_secret_")) h.Authorization = "Bearer " + key;
  return h;
}
async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
function validSignature(body, header, secret) {
  if (!header || !secret) return false;
  const parts = header.split(",").map(part => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(timestamp + ".").update(body).digest();
  return signatures.some(value => {
    try {
      const supplied = Buffer.from(value, "hex");
      return supplied.length === expected.length && crypto.timingSafeEqual(expected, supplied);
    } catch (_) { return false; }
  });
}
async function db(path, key, options = {}) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers: serviceHeaders(key, { "Content-Type": "application/json", ...(options.headers || {}) })
  });
  const raw = await response.text();
  if (!response.ok) throw new Error("Supabase sync failed: " + response.status);
  return raw ? JSON.parse(raw) : [];
}
async function getStripeSubscription(id) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Stripe secret key missing");
  const response = await fetch("https://api.stripe.com/v1/subscriptions/" + encodeURIComponent(id), {
    headers: { Authorization: "Bearer " + secret }
  });
  const data = await response.json();
  if (!response.ok) throw new Error("Could not retrieve subscription from Stripe");
  return data;
}
async function syncSubscription(subscription, userIdOverride, sessionId) {
  const key = serverKey();
  const userId = userIdOverride || subscription.metadata?.supabase_user_id;
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId || "")) {
    throw new Error("Subscription is missing a valid company user id");
  }
  const customer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id;
  const priceId = subscription.items?.data?.[0]?.price?.id || process.env.STRIPE_PREMIUM_PRICE_ID || "price_1UaATHC074K6xfn9pPQfJ33F";
  const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;
  const payload = {
    user_id: userId,
    stripe_customer_id: customer || null,
    stripe_subscription_id: subscription.id,
    checkout_session_id: sessionId || null,
    price_id: priceId,
    status: subscription.status || "incomplete",
    current_period_end: periodEnd,
    cancel_at_period_end: !!subscription.cancel_at_period_end,
    updated_at: new Date().toISOString()
  };
  await db("partner_company_subscriptions?on_conflict=stripe_subscription_id", key, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(payload)
  });
}
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { error: "Method not allowed" });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !serverKey()) return reply(res, 503, { error: "Webhook is not configured." });
  try {
    const body = await rawBody(req);
    if (!validSignature(body, req.headers["stripe-signature"], secret)) {
      return reply(res, 400, { error: "Invalid Stripe signature." });
    }
    const event = JSON.parse(body.toString("utf8"));
    const object = event.data?.object || {};
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      if (object.mode === "subscription" && object.subscription) {
        const subscriptionId = typeof object.subscription === "string" ? object.subscription : object.subscription.id;
        const subscription = await getStripeSubscription(subscriptionId);
        const userId = object.metadata?.supabase_user_id || object.client_reference_id || subscription.metadata?.supabase_user_id;
        await syncSubscription(subscription, userId, object.id);
      }
    } else if (event.type?.startsWith("customer.subscription.")) {
      await syncSubscription(object);
    } else if (event.type === "invoice.paid" || event.type === "invoice.payment_failed") {
      const subscriptionId = object.subscription ||
        object.parent?.subscription_details?.subscription ||
        object.lines?.data?.[0]?.parent?.subscription_item_details?.subscription;
      if (subscriptionId) await syncSubscription(await getStripeSubscription(typeof subscriptionId === "string" ? subscriptionId : subscriptionId.id));
    }
    return reply(res, 200, { received: true });
  } catch (error) {
    console.error("Company Premium webhook:", error.message);
    return reply(res, 500, { error: "Webhook processing failed." });
  }
};
