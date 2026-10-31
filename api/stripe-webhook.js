// Vercel serverless function: verify Stripe webhooks and sync premium_users.
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
      return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    } catch (_) { return false; }
  });
}

async function savePremium(userId, expiresAt) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId || "")) {
    throw new Error("Invalid Supabase user id in Stripe metadata");
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("Missing Supabase server secret");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/premium_users?on_conflict=user_id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ user_id: userId, expires_at: expiresAt, updated_at: new Date().toISOString() })
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error("Supabase premium sync failed:", response.status, detail.slice(0, 300));
    throw new Error("Premium access could not be synchronized");
  }
}

async function syncSubscription(subscription) {
  const userId = subscription.metadata?.supabase_user_id;
  if (!userId) throw new Error("Subscription missing Supabase user metadata");
  const active = subscription.status === "active" || subscription.status === "trialing";
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : new Date().toISOString();
  await savePremium(userId, active ? periodEnd : new Date().toISOString());
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
      const subResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(object.subscription)}`, {
        headers: { Authorization: `Bearer ${stripeKey}` }
      });
      const subscription = await subResponse.json();
      if (!subResponse.ok) throw new Error("Could not retrieve Stripe subscription");
      if (!subscription.metadata?.supabase_user_id && object.metadata?.supabase_user_id) {
        subscription.metadata = { ...(subscription.metadata || {}), supabase_user_id: object.metadata.supabase_user_id };
      }
      await syncSubscription(subscription);
    } else if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncSubscription(object);
    }

    return reply(res, 200, { received: true });
  } catch (error) {
    console.error("Stripe webhook processing error:", error.message);
    return reply(res, 500, { error: "Webhook processing failed" });
  }
};
