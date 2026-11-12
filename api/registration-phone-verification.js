"use strict";

const crypto = require("crypto");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://khggputlakhupiypybic.supabase.co";

function reply(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8")
    .setHeader("Cache-Control", "no-store").end(JSON.stringify(data));
}
function serverKey() {
  let key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  try {
    const bundle = JSON.parse(process.env.SUPABASE_SECRET_KEYS || "{}");
    key = key || bundle.default || bundle.secret_key || "";
  } catch (_) {}
  return key;
}
function dbHeaders(key) {
  const result = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_secret_")) result.Authorization = "Bearer " + key;
  return result;
}
function pepper() { return process.env.PHONE_OTP_PEPPER || ""; }
function hmac(value) {
  return crypto.createHmac("sha256", pepper()).update(value).digest("hex");
}
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
function normalizePhone(value) {
  return String(value || "").replace(/[\s().-]/g, "");
}
async function rpc(name, body, key) {
  const response = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + name, {
    method: "POST", headers: dbHeaders(key), body: JSON.stringify(body), cache: "no-store"
  });
  const raw = await response.text();
  if (!response.ok) {
    console.error("registration-phone-verification RPC failed", { name, status: response.status });
    throw new Error("Nie udało się wykonać operacji weryfikacji.");
  }
  return raw ? JSON.parse(raw) : null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return reply(res, 405, { error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const email = normalizeEmail(body.email);
    const phone = normalizePhone(body.phone);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return reply(res, 400, { error: "Wpisz poprawny adres e-mail." });
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      return reply(res, 400, { error: "Wpisz numer w formacie międzynarodowym, np. +48500100200." });
    }
    const key = serverKey();
    if (!key) return reply(res, 503, { error: "Weryfikacja SMS nie jest skonfigurowana na serwerze." });
    if (pepper().length < 32) return reply(res, 503, { error: "Weryfikacja SMS nie jest skonfigurowana na serwerze." });

    if (body.action === "start") {
      if (!process.env.SZYBKISMS_API_TOKEN) {
        return reply(res, 503, { error: "Wysyłanie SMS nie jest skonfigurowane na serwerze." });
      }
      const code = String(crypto.randomInt(100000, 1000000));
      const codeHash = hmac(email + "|" + phone + "|" + code);
      const ip = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
        .split(",")[0].trim().slice(0, 100);
      const started = await rpc("phone_registration_start", {
        p_email: email,
        p_phone_e164: phone,
        p_code_hash: codeHash,
        p_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        p_email_limit_key: hmac("email|" + email),
        p_phone_limit_key: hmac("phone|" + phone),
        p_ip_limit_key: hmac("ip|" + ip)
      }, key);
      if (started?.status === "cooldown") {
        return reply(res, 429, { error: "Poczekaj " + started.retry_after + " s przed ponowną próbą." });
      }
      if (started?.status === "rate_limited") {
        return reply(res, 429, { error: "Limit prób został osiągnięty. Spróbuj ponownie później." });
      }
      if (started?.status !== "started") throw new Error("Nie udało się rozpocząć weryfikacji.");

      const smsPayload = {
        recipients: phone,
        message: "Twój kod rejestracyjny LOVE Story: " + code + ". Kod jest ważny 5 minut. Nie udostępniaj go nikomu.",
        type: 1,
        unicode: true
      };
      if (process.env.SZYBKISMS_SENDER) smsPayload.sender = process.env.SZYBKISMS_SENDER;

      let sms;
      try {
        sms = await fetch("https://api.szybkisms.pl/rest/messages/sms", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + process.env.SZYBKISMS_API_TOKEN,
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(smsPayload)
        });
      } catch (error) {
        console.error("SzybkiSMS registration result unknown", { name: error.name || "Error" });
        return reply(res, 502, {
          error: "Nie udało się potwierdzić wyniku wysyłki. Jeśli SMS dotarł, wpisz kod; w przeciwnym razie spróbuj ponownie po upływie blokady."
        });
      }

      let result = null;
      if (sms.ok) {
        try { result = await sms.json(); } catch (_) {}
      }
      const messages = Array.isArray(result) ? result : (Array.isArray(result?.messages) ? result.messages : []);
      const accepted = sms.ok && messages.length > 0 && messages.every(item => item && item.status_code === "QUEUED");
      if (!accepted) {
        try { await rpc("phone_registration_cancel", { p_email: email, p_code_hash: codeHash }, key); } catch (_) {}
        console.error("SzybkiSMS registration send rejected", { status: sms.status });
        return reply(res, 502, { error: "Operator nie przyjął wiadomości do wysłania. Spróbuj ponownie za chwilę." });
      }
      return reply(res, 200, { ok: true, sent: true });
    }

    if (body.action === "verify") {
      const code = String(body.code || "").trim();
      if (!/^\d{6}$/.test(code)) return reply(res, 400, { error: "Wpisz 6-cyfrowy kod z SMS-a." });
      const result = await rpc("phone_registration_verify", {
        p_email: email,
        p_code_hash: hmac(email + "|" + phone + "|" + code)
      }, key);
      if (result?.status === "verified" && result.phone_e164 === phone) {
        return reply(res, 200, { ok: true, verified: true });
      }
      if (result?.status === "invalid") {
        return reply(res, 400, { error: "Kod jest nieprawidłowy. Pozostało prób: " + result.attempts_left + "." });
      }
      if (result?.status === "expired") return reply(res, 400, { error: "Kod wygasł. Wyślij nowy." });
      if (result?.status === "locked") return reply(res, 429, { error: "Wykorzystano limit prób. Wyślij nowy kod później." });
      return reply(res, 400, { error: "Nie znaleziono aktywnego kodu dla tego adresu e-mail i numeru." });
    }

    return reply(res, 400, { error: "Nieznana operacja." });
  } catch (error) {
    console.error("registration-phone-verification", error.message);
    return reply(res, 500, { error: "Weryfikacja nie powiodła się. Spróbuj ponownie." });
  }
};
