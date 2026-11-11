// Admin-only API for manual Premium activation approvals.
const { requirePhoneVerified } = require("../lib/phone-verification");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://khggputlakhupiypybic.supabase.co";
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_NKmlxY9hjAVDeSD4FEhZhQ_8_AOunOe";

function reply(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}
function headers(key, extra = {}) {
  const value = String(key || "");
  const result = { apikey: value, ...extra };
  if (!value.startsWith("sb_secret_")) result.Authorization = `Bearer ${value}`;
  return result;
}
async function adminContext(req) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: [401, "Zaloguj się ponownie."] };
  const auth = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}` }
  });
  if (!auth.ok) return { error: [401, "Sesja wygasła. Zaloguj się ponownie."] };
  const user = await auth.json();
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { error: [503, "Brak konfiguracji serwera."] };
  try { if (!await requirePhoneVerified(user.id, key)) return { error: [403, "Najpierw potwierdź numer telefonu."] }; }
  catch (error) { return { error: [error.status || 503, "Nie udało się sprawdzić weryfikacji telefonu."] }; }
  const checks = await Promise.all(["admin_users", "admins"].map(async table => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?user_id=eq.${encodeURIComponent(user.id)}&select=user_id&limit=1`, {
      headers: headers(key)
    });
    if (!r.ok) throw new Error("Nie udało się zweryfikować uprawnień administratora.");
    return (await r.json()).length > 0;
  }));
  if (!checks.some(Boolean)) return { error: [403, "Brak uprawnień administratora."] };
  return { user, key };
}
async function db(path, key, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: headers(key, { "Content-Type": "application/json", ...(options.headers || {}) })
  });
  const raw = await r.text();
  if (!r.ok) throw new Error("Operacja w bazie danych nie powiodła się.");
  return raw ? JSON.parse(raw) : [];
}
async function syncPremium(userId, expiresAt, key) {
  await db("premium_users?on_conflict=user_id", key, {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, expires_at: expiresAt, updated_at: new Date().toISOString() })
  });
}
async function expirePremium(userId, key) {
  await db(`premium_users?user_id=eq.${encodeURIComponent(userId)}`, key, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ expires_at: new Date().toISOString(), updated_at: new Date().toISOString() })
  });
}
module.exports = async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return reply(res, 405, { error: "Method not allowed" });
  }
  try {
    const context = await adminContext(req);
    if (context.error) return reply(res, context.error[0], { error: context.error[1] });
    const { user, key } = context;
    if (req.method === "GET") {
      const status = ["pending", "approved", "rejected"].includes(req.query?.status) ? req.query.status : "pending";
      const rows = await db(`premium_access_requests?status=eq.${status}&select=id,user_id,customer_email,checkout_session_id,stripe_subscription_id,paid_at,expires_at,status,admin_note,reviewed_at&order=created_at.desc&limit=100`, key);
      return reply(res, 200, { requests: rows });
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const id = String(body.id || "");
    const action = body.action;
    if (!/^[0-9a-f-]{36}$/i.test(id) || !["approve", "reject"].includes(action)) {
      return reply(res, 400, { error: "Nieprawidłowe zgłoszenie lub decyzja." });
    }
    const rows = await db(`premium_access_requests?id=eq.${encodeURIComponent(id)}&select=id,user_id,status,expires_at,stripe_subscription_id&limit=1`, key);
    if (!rows.length) return reply(res, 404, { error: "Nie znaleziono zgłoszenia." });
    const request = rows[0];
    if (action === "approve") {
      if (!request.expires_at || new Date(request.expires_at).getTime() <= Date.now()) {
        return reply(res, 409, { error: "Subskrypcja nie jest obecnie aktywna. Nie można przyznać Premium." });
      }
      await syncPremium(request.user_id, request.expires_at, key);
    } else {
      await expirePremium(request.user_id, key);
    }
    await db(`premium_access_requests?id=eq.${encodeURIComponent(id)}`, key, {
      method: "PATCH", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        status: action === "approve" ? "approved" : "rejected",
        admin_note: typeof body.note === "string" ? body.note.slice(0, 1000) : null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
        updated_at: new Date().toISOString()
      })
    });
    return reply(res, 200, { ok: true, status: action === "approve" ? "approved" : "rejected" });
  } catch (error) {
    console.error("Premium admin API error:", error.message);
    return reply(res, 500, { error: error.message || "Wystąpił błąd serwera." });
  }
};
