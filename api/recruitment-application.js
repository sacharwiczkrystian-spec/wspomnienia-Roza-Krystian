const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 5;
const requestsByIp = new Map();

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function clean(value, max = 200) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Dozwolona jest tylko metoda POST." });
  }

  const ip = clean(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown", 100).split(",")[0].trim();
  const now = Date.now();
  const recent = (requestsByIp.get(ip) || []).filter(ts => now - ts < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) return json(res, 429, { error: "Za dużo prób. Spróbuj ponownie za kilka minut." });
  recent.push(now);
  requestsByIp.set(ip, recent);

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return json(res, 400, { error: "Nieprawidłowy format zgłoszenia." }); }
  }
  if (!body || typeof body !== "object") return json(res, 400, { error: "Brak danych zgłoszenia." });
  if (clean(body.website, 500)) return json(res, 200, { ok: true });
  const applicantName = clean(body.applicantName, 120);
  const applicantEmail = clean(body.applicantEmail, 254);
  const role = clean(body.role, 100);
  const pdfBase64 = String(body.pdfBase64 || "");
  if (!applicantName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(applicantEmail) || !role) {
    return json(res, 400, { error: "Sprawdź imię, adres e-mail i wybrane stanowisko." });
  }
  if (!pdfBase64 || pdfBase64.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(pdfBase64)) {
    return json(res, 400, { error: "Załącznik PDF jest nieprawidłowy lub zbyt duży." });
  }
  if (!process.env.RESEND_API_KEY || !process.env.APPLICATIONS_EMAIL || !process.env.RESEND_FROM_EMAIL) {
    return json(res, 503, { error: "Wysyłka e-mail nie jest jeszcze skonfigurowana. Administrator musi ustawić RESEND_API_KEY, APPLICATIONS_EMAIL i RESEND_FROM_EMAIL w zmiennych środowiskowych Vercel." });
  }

  const recipient = clean(process.env.APPLICATIONS_EMAIL, 254);
  const from = clean(process.env.RESEND_FROM_EMAIL, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || !from.includes("@")) {
    return json(res, 503, { error: "Konfiguracja adresu skrzynki rekrutacyjnej jest nieprawidłowa." });
  }

  const filename = "Love-Story-zgloszenie-" + new Date().toISOString().slice(0, 10) + ".pdf";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        reply_to: applicantEmail,
        subject: "Nowe zgłoszenie rekrutacyjne Love Story — " + role,
        text: "Nowe zgłoszenie rekrutacyjne Love Story.\nKandydat: " + applicantName + "\nStanowisko: " + role + "\nW załączniku znajduje się PDF z odpowiedziami kandydata. Otwieraj go wyłącznie, jeśli masz uprawnienia do przeglądania zgłoszeń.",
        attachments: [{ filename, content: pdfBase64 }]
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Recruitment email provider error:", response.status, result?.message || result?.name || "unknown");
      return json(res, 502, { error: "Usługa pocztowa nie przyjęła wiadomości. Sprawdź konfigurację Resend i adres nadawcy." });
    }
    return json(res, 200, { ok: true });
  } catch (error) {
    console.error("Recruitment email request failed:", error?.message || "unknown");
    return json(res, 502, { error: "Nie udało się połączyć z usługą pocztową. Spróbuj ponownie później." });
  }
};
