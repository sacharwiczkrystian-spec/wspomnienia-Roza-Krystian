// Vercel serverless function: create a Stripe Checkout subscription session.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://khggputlakhupiypybic.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_NKmlxY9hjAVDeSD4FEhZhQ_8_AOunOe";
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || "price_1UWZrYC074K6xfn90Qn34mCM";
const APP_URL = process.env.APP_URL || "https://love-story-nowa.vercel.app";

function reply(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { error: "Method not allowed" });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey || !SUPABASE_PUBLISHABLE_KEY) {
    return reply(res, 503, { error: "Płatności nie są jeszcze skonfigurowane." });
  }

  const authHeader = req.headers.authorization || "";
  const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!accessToken) return reply(res, 401, { error: "Zaloguj się, aby kupić Premium." });

  try {
    // Validate the session with Supabase Auth; never trust a user ID from the browser.
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` }
    });
    if (!authResponse.ok) return reply(res, 401, { error: "Sesja wygasła. Zaloguj się ponownie." });
    const account = await authResponse.json();
    if (!account.id || !account.email) return reply(res, 400, { error: "Konto nie ma zweryfikowanego adresu e-mail." });

    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("line_items[0][price]", STRIPE_PRICE_ID);
    form.set("line_items[0][quantity]", "1");
    form.set("success_url", `${APP_URL}/premium.html?checkout=success&session_id={CHECKOUT_SESSION_ID}`);
    form.set("cancel_url", `${APP_URL}/premium.html?checkout=cancelled`);
    form.set("client_reference_id", account.id);
    form.set("customer_email", account.email);
    form.set("metadata[supabase_user_id]", account.id);
    form.set("subscription_data[metadata][supabase_user_id]", account.id);
    form.set("billing_address_collection", "auto");

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": `love-story-checkout-${account.id}-${Date.now()}`
      },
      body: form
    });
    const session = await stripeResponse.json();
    if (!stripeResponse.ok || !session.url) {
      console.error("Stripe Checkout session creation failed:", session.error?.type || stripeResponse.status);
      return reply(res, 502, { error: "Nie udało się rozpocząć płatności. Spróbuj później." });
    }
    return reply(res, 200, { url: session.url });
  } catch (error) {
    console.error("Checkout endpoint error:", error.message);
    return reply(res, 500, { error: "Wystąpił błąd podczas przygotowywania płatności." });
  }
};
