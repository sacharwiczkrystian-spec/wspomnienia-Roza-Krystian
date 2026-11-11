# Audyt weryfikacji telefonu — 11.11.2026

## Zakres

Przejrzano gałąź `feature/infobip-phone-verification`, w szczególności:
- `api/phone-verification.js`
- `phone-verification.js`
- migrację `supabase/migrations/20261111204000_phone_verification.sql`
- integracje w `index.html`, `panel-firmy.html`, `admin.html`, `panel-wspolpracy.html` i `admin-wspolpraca-sluzby.html`
- dokument wdrożeniowy i stan draft PR.

## Poprawki wykonane na tej gałęzi

1. **Nieudane wysłanie SMS** — endpoint próbuje teraz unieważnić wyzwanie OTP, gdy żądanie do Infobip kończy się błędem HTTP albo wyjątkiem sieciowym. Unieważnienie wymaga zgodności identyfikatora użytkownika i HMAC kodu, więc nie powinno usuwać nowszego wyzwania.
2. **Nowa funkcja SQL** — dodano `phone_verification_cancel`, z odebraniem EXECUTE dla `public`, `anon` i `authenticated`, oraz przyznaniem go wyłącznie `service_role`.
3. **Normalizacja numeru** — poprawiono niespójny zapis wyrażenia regularnego przy porównaniu z wcześniej zweryfikowanym numerem.
4. **Sekret OTP** — API odrzuca konfigurację, jeśli `PHONE_OTP_PEPPER` ma mniej niż 32 znaki.

## Wyniki przeglądu

### Blokery przed wdrożeniem

- **Brak środowiska testowego Supabase.** Migracja nie może być bezpiecznie zweryfikowana na produkcyjnej bazie.
- **Brak `PHONE_OTP_PEPPER` w znanej konfiguracji Vercel.** Po wdrożeniu frontendu bez tego sekretu endpoint zwraca 503, a bramka może zatrzymać dostęp do paneli.
- **Niepotwierdzony format/nazwa sekretu Supabase po stronie Vercel.** API obsługuje `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` i ograniczony zestaw pól z `SUPABASE_SECRET_KEYS`; trzeba potwierdzić rzeczywistą nazwę bez odczytywania wartości.
- **Brak testów integracyjnych i automatycznego testu w repozytorium.** Nie znaleziono `package.json` ani typowych workflow CI pod sprawdzonymi ścieżkami. Nie oznacza to, że żaden workflow nie istnieje.
- **Niezweryfikowany Infobip.** Nie potwierdzono uprawnień klucza, nadawcy ani ograniczeń konta trial.

### Ryzyka wymagające testów

- Główna aplikacja, panel firmy/współpracownika, administrator i moduły kont współpracy mają różne ścieżki logowania. Samo dodanie wspólnego skryptu nie dowodzi poprawności wszystkich ścieżek.
- Trzeba przetestować odnowienie i przywracanie sesji, logowanie passkey, zmianę hasła, logowanie dwuetapowe kont współpracy oraz zmianę numeru.
- W przypadku błędu konfiguracji lub sieci zachowanie interfejsu różni się między panelami; trzeba sprawdzić, czy użytkownik otrzymuje czytelny komunikat i czy nie pozostaje w niejednoznacznym stanie zalogowania.
- Ograniczenie IP bazuje na nagłówkach przekazywanych przez platformę. Przed produkcją należy potwierdzić, że używany nagłówek jest ustawiany przez Vercel i nie może być dowolnie podmieniany przez klienta.
- Wywołanie anulowania wyzwania po błędzie Infobip jest best-effort. Jeśli również RPC anulujące nie zadziała, wyzwanie może pozostać do upływu cooldownu/ważności.


## Uzupełnienie audytu — 11.11.2026

W dodatkowym przeglądzie gałęzi znaleziono i poprawiono dwa błędy składniowe:

1. **Migracja SQL:** funkcja `phone_verification_cancel` miała nieprawidłowy delimiter bloku PL/pgSQL (`$;` zamiast `$;`). Poprawiono zamknięcie funkcji.
2. **Panel firmy:** w dwóch miejscach wstawiono literalne znaki `\\n` poza łańcuchem JavaScript, co mogło powodować błąd parsowania skryptu. Zastąpiono je rzeczywistymi podziałami linii.

Wykonano kontrolę składni JavaScript bez uruchamiania kodu: plik API, wspólny skrypt klienta oraz skrypty inline we wszystkich pięciu panelach przechodzą parsowanie. Sprawdzono też, że cztery bloki funkcji SQL mają parzyste i poprawne delimitery dollar-quote. **Nie jest to test wykonania SQL ani test integracyjny.**

### Bezpłatny następny etap testów

W repozytorium nie znaleziono `supabase/config.toml` ani `package.json`. Można więc przygotować lokalny stack Supabase bez tworzenia płatnej gałęzi i bez łączenia z projektem produkcyjnym:

1. Zainstalować Node.js 20+ oraz Docker Desktop (lub zgodny runtime kontenerów), a następnie Supabase CLI jako zależność developerską.
2. W katalogu repozytorium uruchomić `npx supabase init`, aby wygenerować brakującą konfigurację lokalną.
3. Uruchomić `npx supabase start`, a następnie `npx supabase db reset` — bez flag `--remote` i bez wcześniejszego `supabase link`.
4. Sprawdzić, czy lokalny Postgres przyjmuje migrację. Nie kopiować danych produkcyjnych i nie konfigurować lokalnego testu do wysyłania prawdziwych SMS-ów.

Lokalny stack Supabase jest bezpłatny i nie zużywa limitu projektu hostowanego. Wymaga jednak komputera z Dockerem; nie został uruchomiony w ramach tego przeglądu.

## Werdykt

**NIE MERGOWAĆ I NIE WDRAŻAĆ NA PRODUKCJĘ.** Wykonano poprawki statyczne, ale nie uruchomiono migracji, nie wysłano SMS, nie przetestowano klucza Infobip i nie wykonano wdrożenia. Kolejny bezpieczny krok to przygotowanie osobnego projektu Supabase staging, konfiguracja testowych sekretów i testy end-to-end na kontrolowanym numerze.
