const crypto = require("crypto");
const URL = process.env.SUPABASE_URL || "https://khggputlakhupiypybic.supabase.co";
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_NKmlxY9hjAVDeSD4FEhZhQ_8_AOunOe";
const reply = (res, status, data) => res.status(status).setHeader("Content-Type", "application/json; charset=utf-8").setHeader("Cache-Control", "no-store").end(JSON.stringify(data));
const headers = (key, extra = {}) => ({ apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", ...extra });
const pepper = () => process.env.PHONE_OTP_PEPPER || "";
const hmac = value => crypto.createHmac("sha256", pepper()).update(value).digest("hex");
const mask = phone => phone ? phone.slice(0, 4) + "••••" + phone.slice(-3) : null;

async function authUser(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw Object.assign(Error("Zaloguj się ponownie."), { status: 401 });
  const r = await fetch(URL + "/auth/v1/user", { headers: { apikey: PUB, Authorization: "Bearer " + token } });
  if (!r.ok) throw Object.assign(Error("Sesja wygasła."), { status: 401 });
  return r.json();
}
async function db(path, key, options = {}) {
  const r = await fetch(URL + "/rest/v1/" + path, { ...options, headers: headers(key, options.headers || {}) });
  const raw = await r.text();
  if (!r.ok) throw Error("Operacja weryfikacji nie powiodła się.");
  return raw ? JSON.parse(raw) : [];
}
async function rpc(name, body, key) {
  const r = await fetch(URL + "/rest/v1/rpc/" + name, { method: "POST", headers: headers(key), body: JSON.stringify(body) });
  const raw = await r.text();
  if (!r.ok) throw Error("Nie udało się wykonać operacji weryfikacji.");
  return raw ? JSON.parse(raw) : null;
}
module.exports = async (req, res) => {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return reply(res, 405, { error: "Method not allowed" }); }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const user = await authUser(req);
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key || !process.env.INFOBIP_API_KEY || !process.env.INFOBIP_BASE_URL || !pepper()) {
      return reply(res, 503, { error: "Weryfikacja SMS nie jest jeszcze skonfigurowana na serwerze." });
    }

    if (body.action === "status") {
      const rows = await db("verified_phone_numbers?user_id=eq." + encodeURIComponent(user.id) + "&select=phone_e164,verified_at&limit=1", key);
      return reply(res, 200, { verified: !!rows.length, phone: rows[0] ? mask(rows[0].phone_e164) : null, verified_at: rows[0]?.verified_at || null });
    }

    if (body.action === "start") {
      const current = await db("verified_phone_numbers?user_id=eq." + encodeURIComponent(user.id) + "&select=phone_e164&limit=1", key);
      if (current.length && current[0].phone_e164 !== String(body.phone || "").replace(/[\\s().-]/g, "")) {
        const signedInAt = user.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
        if (!signedInAt || Date.now() - signedInAt > 10 * 60 * 1000) return reply(res, 403, { error: "Przed zmianą numeru wyloguj się i zaloguj ponownie." });
      }
      const phone = String(body.phone || "").replace(/[\s().-]/g, "");
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) return reply(res, 400, { error: "Wpisz numer w formacie międzynarodowym, np. +48500100200." });
      const code = String(crypto.randomInt(100000, 1000000));
      const codeHash = hmac(user.id + "|" + phone + "|" + code);
      const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim().slice(0, 100);
      const result = await rpc("phone_verification_start", {
        p_user_id: user.id,
        p_phone_e164: phone,
        p_code_hash: codeHash,
        p_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        p_user_limit_key: hmac("user|" + user.id),
        p_phone_limit_key: hmac("phone|" + phone),
        p_ip_limit_key: hmac("ip|" + ip)
      }, key);
      if (result?.status === "already_verified") return reply(res, 200, { ok: true, already_verified: true });
      if (result?.status === "cooldown") return reply(res, 429, { error: "Poczekaj " + result.retry_after + " s przed ponowną próbą." });
      if (result?.status === "rate_limited") return reply(res, 429, { error: "Limit prób został osiągnięty. Spróbuj ponownie później." });
      if (result?.status === "number_unavailable") return reply(res, 400, { error: "Nie można użyć tego numeru. Sprawdź go lub skontaktuj się z pomocą." });
      if (result?.status !== "started") throw Error("Nie udało się rozpocząć weryfikacji.");

      const base = String(process.env.INFOBIP_BASE_URL).replace(/\/+$/, "");
      const sender = process.env.INFOBIP_SENDER || "InfoSMS";
      const sms = await fetch(base + "/sms/3/messages", {
        method: "POST",
        headers: { Authorization: "App " + process.env.INFOBIP_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ messages: [{ destinations: [{ to: phone }], from: sender, content: { text: "Twój kod weryfikacyjny LOVE Story: " + code + ". Kod jest ważny 5 minut. Nie udostępniaj go nikomu." } }] })
      });
      if (!sms.ok) {
        console.error("Infobip SMS send failed", { status: sms.status });
        return reply(res, 502, { error: "Nie udało się wysłać SMS-a. Spróbuj ponownie za chwilę." });
      }
      return reply(res, 200, { ok: true, sent: true });
    }

    if (body.action === "verify") {
      const code = String(body.code || "");
      if (!/^\d{6}$/.test(code)) return reply(res, 400, { error: "Wpisz 6-cyfrowy kod z SMS-a." });
      const result = await rpc("phone_verification_check", { p_user_id: user.id, p_code_hash: hmac(user.id + "|" + String(body.phone || "") + "|" + code) }, key);
      // Numer jest przechowywany wyłącznie w rekordzie wyzwania; statusy nie ujawniają go osobom postronnym.
      if (result?.status === "verified") return reply(res, 200, { ok: true, verified: true });
      if (result?.status === "invalid") return reply(res, 400, { error: "Kod jest nieprawidłowy. Pozostało prób: " + result.attempts_left + "." });
      if (result?.status === "expired") return reply(res, 400, { error: "Kod wygasł. Wyślij nowy." });
      if (result?.status === "locked") return reply(res, 429, { error: "Wykorzystano limit prób. Wyślij nowy kod później." });
      if (result?.status === "number_unavailable") return reply(res, 400, { error: "Nie można użyć tego numeru. Skontaktuj się z pomocą." });
      return reply(res, 400, { error: "Nie znaleziono aktywnego kodu. Wyślij nowy." });
    }
    return reply(res, 400, { error: "Nieznana operacja." });
  } catch (e) {
    console.error("phone-verification", e.message);
    return reply(res, e.status || 500, { error: e.status ? e.message : "Weryfikacja nie powiodła się." });
  }
};
