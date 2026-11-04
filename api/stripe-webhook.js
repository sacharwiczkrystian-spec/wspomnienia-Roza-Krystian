// Vercel serverless function: verify Stripe webhooks and queue manual Premium activation.
const crypto = require("crypto");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://khggputlakhupiypybic.supabase.co";

module.exports.config = { api: { bodyParser: false } };

function reply(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
function verifyStripeSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = header.split(",").map(part => part.split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();
  return signatures.some(signature => {
    try {
      const supplied = Buffer.from(signature, "hex");
      return supplied.length === expected.length && crypto.timingSafeEqual(expected, supplied);
    } catch (_) { return false; }
  });
}
function validUserId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id || "");
}
function serviceHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}
async function supabaseRequest(path, options = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing Supabase server secret");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: serviceHeaders(key, { "Content-Type": "application/json", ...(options.headers || {}) })
  });
  const body = await response.text();
  if (!response.ok) {
    console.error("Supabase Premium request failed:", response.status, body.slice(0, 300));
    throw new Error("Premium request could not be synchronized");
  }
  return body ? JSON.parse(body) : [];
}
async function expirePremium(userId) {
  await supabaseRequest(`premium_users?user_id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ expires_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  });
}
async function createActivationRequest(session, subscription) {
  const userId = session.metadata?.supabase_user_id || subscription.metadata?.supabase_user_id || session.client_reference_id;
  if (!validUserId(userId)) throw new Error("Invalid Supabase user id in Stripe metadata");
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  if (!subscriptionId) throw new Error("Checkout session has no subscription id");
  const subscriptionActive = subscription.status === "active" || subscription.status === "trialing";
  const expiresAt = subscriptionActive && subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : new Date().toISOString();
  const existing = await supabaseRequest(`premium_access_requests?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=id,status`);
  if (existing.length) {
    await supabaseRequest(`premium_access_requests?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ expires_at: expiresAt, updated_at: new Date().toISOString() })
    });
    return;
  }
  await supabaseRequest("premium_access_requests", {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: userId,
      customer_email: session.customer_details?.email || session.customer_email || "",
      checkout_session_id: session.id,
      stripe_subscription_id: subscriptionId,
      paid_at: new Date().toISOString(),
      expires_at: expiresAt,
      status: "pending"
    })
  });
}
async function updateSubscriptionRequest(subscription) {
  const subscriptionId = subscription.id;
  if (!subscriptionId) return;
  const rows = await supabaseRequest(`premium_access_requests?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=id,user_id,status`);
  const active = subscription.status === "active" || subscription.status === "trialing";
  const expiresAt = active && subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : new Date().toISOString();
  if (!rows.length) return;
  await supabaseRequest(`premium_access_requests?id=eq.${encodeURIComponent(rows[0].id)}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ expires_at: expiresAt, updated_at: new Date().toISOString() })
  });
  if (!active) await expirePremium(rows[0].user_id);
  else if (rows[0].status === "approved") {
    await supabaseRequest("premium_users?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: rows[0].user_id, expires_at: expiresAt, updated_at: new Date().toISOString() })
    });
  }
}
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { error: "Method not allowed" });
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return reply(res, 503, { error: "Webhook is not configured" });
  }
  try {
    const rawBody = await readRawBody(req);
    if (!verifyStripeSignature(rawBody, req.headers["stripe-signature"], webhookSecret)) {
      return reply(res, 400, { error: "Invalid Stripe signature" });
    }
    const event = JSON.parse(rawBody.toString("utf8"));
    const object = event.data?.object;
    if (event.type === "checkout.session.completed" && object?.mode === "subscription" && object.subscription) {
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) return reply(res, 503, { error: "Stripe server key is not configured" });
      const subResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(typeof object.subscription === "string" ? object.subscription : object.subscription.id)}`, {
        headers: { Authorization: `Bearer ${stripeKey}` }
      });
      const subscription = await subResponse.json();
      if (!subResponse.ok) throw new Error("Could not retrieve Stripe subscription");
      if (!subscription.metadata?.supabase_user_id && object.metadata?.supabase_user_id) {
        subscription.metadata = { ...(subscription.metadata || {}), supabase_user_id: object.metadata.supabase_user_id };
      }
      await createActivationRequest(object, subscription);
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await updateSubscriptionRequest(object);
    }
    return reply(res, 200, { received: true });
  } catch (error) {
    console.error("Stripe webhook processing error:", error.message);
    return reply(res, 500, { error: "Webhook processing failed" });
  }
};
