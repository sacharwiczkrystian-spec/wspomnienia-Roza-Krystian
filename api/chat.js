const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 12;
const requestsByIp = new Map();

function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Ta metoda nie jest obsługiwana." });
  }

  // Accept same-origin requests only when the browser provides an Origin header.
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return json(res, 403, { error: "Żądanie zostało odrzucone." });
      }
    } catch {
      return json(res, 403, { error: "Nieprawidłowe źródło żądania." });
    }
  }

  const now = Date.now();
  const forwarded = req.headers["x-forwarded-for"];
  const ip = (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "") || "unknown";
  const recent = (requestsByIp.get(ip) || []).filter(time => now - time < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    return json(res, 429, { error: "Wysłano zbyt wiele wiadomości. Odczekaj chwilę i spróbuj ponownie." });
  }
  recent.push(now);
  requestsByIp.set(ip, recent);

  if (!process.env.AI_GATEWAY_API_KEY) {
    return json(res, 503, {
      error: "Czat AI jest już dodany, ale wymaga skonfigurowania klucza AI Gateway w ustawieniach środowiska Vercel."
    });
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 12) {
      return json(res, 400, { error: "Nieprawidłowa historia rozmowy." });
    }

    const messages = [];
    for (const item of body.messages) {
      if (!item || !["user", "assistant"].includes(item.role) || typeof item.content !== "string") {
        return json(res, 400, { error: "Nieprawidłowa wiadomość." });
      }
      const content = item.content.trim();
      if (!content || content.length > 2000) {
        return json(res, 400, { error: "Wiadomość musi mieć od 1 do 2000 znaków." });
      }
      messages.push({ role: item.role, content });
    }
    if (messages[messages.length - 1].role !== "user") {
      return json(res, 400, { error: "Ostatnia wiadomość musi pochodzić od użytkownika." });
    }

    const upstream = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.AI_GATEWAY_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "openai/gpt-5.6-sol",
        messages: [
          {
            role: "system",
            content: "Jesteś przyjaznym, taktownym asystentem strony Love Story. Odpowiadaj w języku użytkownika. Pomagaj w obsłudze strony, codziennych pytaniach i komunikacji. Jeśli użytkownik sygnalizuje rozpacz, kryzys psychiczny lub myśli samobójcze, odpowiedz spokojnie, empatycznie i bez oceniania; podziękuj za zaufanie, nie bagatelizuj uczuć, nie zawstydzaj, nie dawaj poczucia winy i nie udawaj terapeuty. Zachęć do kontaktu z zaufaną osobą oraz profesjonalnym wsparciem. W Polsce podaj 112 przy bezpośrednim zagrożeniu, 116 111 dla dzieci i młodzieży (https://116111.pl/) oraz 800 70 2222 dla dorosłych (https://centrumwsparcia.pl/). Jeśli lokalizacja nie jest znana, zasugeruj lokalny numer alarmowy i lokalną linię kryzysową. Nie obiecuj, że możesz wezwać pomoc ani że rozmowa jest monitorowana. Nie twierdź, że widzisz prywatne wspomnienia, konta ani dane użytkownika — nie masz do nich dostępu. Nie proś o hasła, kody logowania ani wrażliwe dane. Zwykle odpowiadaj zwięźle."
          },
          ...messages
        ],
        max_tokens: 600,
        temperature: 0.7
      })
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("AI Gateway request failed:", upstream.status, data && data.error ? data.error.message : "unknown error");
      return json(res, 502, { error: "Asystent chwilowo nie może odpowiedzieć. Spróbuj ponownie za chwilę." });
    }

    const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof reply !== "string" || !reply.trim()) {
      return json(res, 502, { error: "Asystent nie zwrócił odpowiedzi. Spróbuj ponownie." });
    }
    return json(res, 200, { reply: reply.trim() });
  } catch (error) {
    console.error("AI chat error:", error && error.message ? error.message : "unknown error");
    return json(res, 500, { error: "Wystąpił błąd czatu. Spróbuj ponownie." });
  }
};
