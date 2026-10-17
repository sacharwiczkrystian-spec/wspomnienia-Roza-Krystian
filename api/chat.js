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

    // Bez klucza API działa lokalny tryb pomocy oparty na gotowych odpowiedziach.
    // Nie udaje generatywnego AI; zapewnia instrukcje strony i podstawowe wskazówki.
    if (!process.env.AI_GATEWAY_API_KEY) {
      const question = messages[messages.length - 1].content.toLocaleLowerCase("pl")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
      let reply;
      if (/samoboj|nie chce zyc|chce umrzec|odebrac sobie zycie|zabic sie|krzywde|suicid|kill myself|end my life|want to die|kryzys|nie daje rady|nie mam sily/.test(question)) {
        reply = "Przykro mi, że jest Ci tak trudno. Dziękuję, że napisałeś/aś. Nie musisz mierzyć się z tym samodzielnie — jeśli możesz, odezwij się teraz do zaufanej osoby i powiedz jej, że potrzebujesz wsparcia.\n\n„Nie musisz dziś mieć siły na wszystko. Wystarczy, że pozwolisz komuś być obok.”\n\nJeśli istnieje bezpośrednie zagrożenie życia lub zdrowia, zadzwoń pod 112. W Polsce dzieci i młodzież mogą bezpłatnie i całodobowo skontaktować się z 116 111: https://116111.pl/ . Dorośli mogą zadzwonić pod 800 70 2222: https://centrumwsparcia.pl/ . Ten chat nie zastępuje pomocy człowieka, ale możesz napisać, czego teraz potrzebujesz.";
      } else if (/cytat|cytaty|depresj|przygnebien|smutek|samotn|motywacj|cos na pocieszenie|slow[aó] otuchy/.test(question)) {
        reply = "Oto kilka krótkich, autorskich cytatów o trudnych chwilach i nadziei:\n\n• „Nie musisz widzieć całej drogi, żeby zrobić jeden mały krok.”\n• „To, że dziś jest ciężko, nie oznacza, że zawsze tak będzie.”\n• „Prośba o pomoc nie jest słabością — to sposób, by nie dźwigać wszystkiego samemu.”\n• „Masz prawo odpocząć, nawet jeśli nie udało Ci się dziś wszystkiego.”\n\nDepresja to nie lenistwo ani wada charakteru. Jeśli ten temat dotyczy Ciebie, warto powiedzieć o tym zaufanej osobie lub specjaliście. Nie musisz radzić sobie sam/sama.";
      } else if (/zle sie czuje|czuje sie zle|jest mi zle|smutno mi|jestem smutn|jestem przygnebion|samotn|czuje sie samotn|mam ciezki dzien|ciezki dzien|stresuje sie|jestem zestresowan|boje sie|martwie sie|nie wiem co robic|mam problem|potrzebuje pogadac|chce pogadac|jest mi ciezko|wszystko mnie przerasta/.test(question)) {
        reply = "Przykro mi, że tak się czujesz. Pamiętaj, że nie jesteś sam/sama — wiele osób przechodzi przez trudniejsze chwile i zasługujesz na życzliwość oraz wsparcie.\n\n„Nie musisz dziś rozwiązać całego życia. Wystarczy jeden mały krok i danie sobie odrobiny życzliwości.”\n\nJeśli możesz, porozmawiaj z kimś, komu ufasz, i powiedz wprost, co się dzieje. Możesz też napisać mi trochę więcej o tym, co Cię martwi — postaram się wysłuchać i pomóc Ci znaleźć następny mały krok.";
      } else if (/instrukcj|jak korzystac|jak uzyc|pomoc|obsluga|wspomnien/.test(question)) {
        reply = "Instrukcja obsługi Love Story:\n1. Zaloguj się na swoje konto lub utwórz konto, jeśli ta opcja jest dostępna.\n2. Otwórz sekcję wspomnień, aby przeglądać dostępne wpisy.\n3. Korzystaj z widocznych na stronie przycisków i formularzy, aby dodawać lub edytować treści, jeśli masz do tego uprawnienia.\n4. Nie udostępniaj nikomu hasła ani kodów logowania.\nNapisz, z którą funkcją masz problem, a podpowiem następny krok.";
      } else if (/czesc|hej|witaj|dzien dobry|dobry wieczor|hello|hi\b/.test(question)) {
        reply = "Cześć! Jestem pomocnikiem Love Story. Mogę podać instrukcję obsługi strony lub podstawowe wskazówki. Napisz, czego szukasz, albo kliknij przycisk „Instrukcja obsługi” lub „Potrzebujesz wsparcia?”.";
      } else {
        reply = "Mogę pomóc w podstawowej obsłudze Love Story, ale pełne odpowiedzi generowane przez AI wymagają konfiguracji usługi AI. Na razie napisz „instrukcja obsługi” lub „potrzebuję wsparcia”, a podam gotowe wskazówki. Jeśli sprawa dotyczy kryzysu, napisz do zaufanej osoby; w bezpośrednim zagrożeniu dzwoń pod 112.";
      }
      return json(res, 200, { reply });
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
            content: "Jesteś przyjaznym, taktownym asystentem strony Love Story. Odpowiadaj w języku użytkownika. Pomagaj w obsłudze strony, codziennych pytaniach i komunikacji. Jeśli użytkownik sygnalizuje rozpacz, kryzys psychiczny lub myśli samobójcze, odpowiedz spokojnie, empatycznie i bez oceniania; podziękuj za zaufanie, nie bagatelizuj uczuć, nie zawstydzaj, nie dawaj poczucia winy i nie udawaj terapeuty. Zachęć do kontaktu z zaufaną osobą oraz profesjonalnym wsparciem. W Polsce podaj 112 przy bezpośrednim zagrożeniu, 116 111 dla dzieci i młodzieży (https://116111.pl/) oraz 800 70 2222 dla dorosłych (https://centrumwsparcia.pl/). Jeśli lokalizacja nie jest znana, zasugeruj lokalny numer alarmowy i lokalną linię kryzysową. Nie obiecuj, że możesz wezwać pomoc ani że rozmowa jest monitorowana. Nie twierdź, że widzisz prywatne wspomnienia, konta ani dane użytkownika — nie masz do nich dostępu. Nie proś o hasła, kody logowania ani wrażliwe dane. Gdy pasuje do sytuacji, możesz dodać krótki, własny (nieprzypisywany znanym osobom) cytat dodający otuchy, szczególnie przy smutku, samotności, depresji lub stresie. Nie romantyzuj depresji ani cierpienia i nie sugeruj, że cytat zastępuje pomoc. Zwykle odpowiadaj zwięźle."
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
