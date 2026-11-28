# Wdrożenie weryfikacji telefonu przez SzybkiSMS — LOVE Story

## Stan wydania (2026-11-12)

- Kod znajduje się na gałęzi `feature/szybkisms-phone-verification`, PR #3 do `main`.
- PR pozostaje wersją roboczą (draft); nie jest scalony.
- GitHub Actions: testy mockowane i statyczne Node.js zakończyły się sukcesem.
- Nie wykonano jeszcze lokalnych testów PostgreSQL, runtime RLS/Storage ani testów E2E.
- Migracje OTP nie są zastosowane w produkcyjnym Supabase.
- Produkcja `lovestory.szczecin.pl` nadal korzysta z `main`.

Ten dokument jest checklistą przygotowania wydania, a nie potwierdzeniem wdrożenia.

## Co zawiera wydanie

1. Endpoint `api/phone-verification.js` wysyłający SMS przez SzybkiSMS.
2. Trzy tabele OTP: `phone_verification_challenges`, `verified_phone_numbers`, `phone_verification_rate_limits`.
3. Serwerowe RPC do rozpoczęcia, sprawdzenia i anulowania wyzwania.
4. Egzekwowanie potwierdzenia numeru przez RLS, Storage i wybrane administracyjne RPC.
5. Interfejs weryfikacji telefonu.

## Wymagane zmienne środowiskowe

Ustawiane wyłącznie po stronie serwera Vercel, jako zmienne Sensitive/Secret:

- `SZYBKISMS_API_TOKEN` — token API SzybkiSMS.
- `PHONE_OTP_PEPPER` — nowy losowy sekret o wysokiej entropii, co najmniej 32 znaki; nie używać starej, wcześniej ujawnionej wartości.
- `SUPABASE_SECRET_KEY` albo `SUPABASE_SERVICE_ROLE_KEY` — istniejący sekret serwerowy Supabase.
- `SZYBKISMS_SENDER` — opcjonalna nazwa nadawcy, jeśli konto dostawcy ma ją skonfigurowaną.

Nie umieszczać tych wartości w kodzie, repozytorium, logach ani zmiennych `NEXT_PUBLIC_*`. Nie kopiować produkcyjnych sekretów do Preview. Do testów lokalnych używać wyłącznie atrap/mocków i fikcyjnych danych.

## Etap 1 — lokalne testy bez płatnego środowiska

Wymagane: Node.js oraz Docker-compatible runtime. Pracować na osobnym lokalnym klonie repozytorium.

1. Sprawdzić `node --version`, `npm --version` i `docker --version`.
2. Repozytorium nie ma obecnie `supabase/config.toml`; w lokalnym klonie wykonać `npx supabase init`.
3. Uruchomić `npx supabase start`.
4. Uruchomić `npx supabase db reset` — wyłącznie wobec lokalnego kontenera.
5. Potwierdzić, że obie migracje wykonują się w kolejności bez błędów.
6. Uruchomić read-only test strukturalny z `supabase/tests/phone_verification_security_structure.sql` na tej lokalnej bazie.
7. Dodatkowo wykonać testy runtime: role `anon`, `authenticated`, `service_role`; operacje SELECT/INSERT/UPDATE/DELETE; Storage; RPC; wyjątki publiczne; konta zwykłe, firmowe, współpracownika i administratora.
8. Uruchomić testy aplikacji i przeglądarkowe dla świeżego logowania, przywróconej sesji, passkey, zmiany numeru, wylogowania i wszystkich paneli.

Nie używać `supabase link`, `--remote`, produkcyjnego connection stringa ani danych produkcyjnych. Nie wysyłać prawdziwych SMS-ów na tym etapie.

## Etap 2 — przegląd przed wydaniem

Wymagane przed zmianą statusu PR z draft:

- niezależny przegląd obu migracji i endpointu;
- wynik lokalnego PostgreSQL/RLS/Storage bez błędów;
- wyjaśnienie ostrzeżeń Security Advisor, zwłaszcza trzech tabel RLS bez polityk oraz funkcji SECURITY DEFINER dostępnych dla ról klienckich;
- potwierdzenie, że `x-forwarded-for` jest wiarygodnie ustawiany przez Vercel;
- test pełnego logowania wszystkich typów kont, aby bramka nie odcięła istniejących użytkowników;
- potwierdzenie zachowania SzybkiSMS dla odpowiedzi `QUEUED` i `REJECTED`, bez ujawniania tokenu.

Obecny sukces CI dotyczy wyłącznie mockowanych i statycznych testów Node.js. Nie zastępuje powyższych kontroli.

## Etap 3 — zatwierdzone wdrożenie produkcyjne

Dopiero po pozytywnym przeglądzie i zatwierdzeniu przez opiekuna:

1. Wykonać kopię/backup i potwierdzić możliwość odtworzenia.
2. Ustawić i zweryfikować wymagane sekrety serwerowe Vercel; nie ujawniać ich w logach.
3. Zastosować migrację `20261111204000_phone_verification.sql`.
4. Sprawdzić utworzenie trzech tabel, RLS, grants i funkcji RPC.
5. Zastosować migrację `20261111220000_phone_verification_enforcement.sql`.
6. Ponownie sprawdzić polityki RLS, Storage, uprawnienia funkcji i wyjątki publiczne.
7. Dopiero wtedy scalić PR i wdrożyć produkcyjny commit.
8. Wykonać smoke test bez masowej wysyłki SMS: status weryfikacji, dostęp do strony, logowanie i zachowanie istniejących kont.
9. Wykonać pojedynczy kontrolowany test SMS na numerze testowym należącym do osoby testującej, po osobnym zatwierdzeniu kosztu i użycia usługi.

Nie stosować migracji produkcyjnych jako testu. Nie scalać PR ani nie uruchamiać produkcyjnych migracji przed ukończeniem etapów 1–2.

## Plan awaryjny

- Przed migracjami musi istnieć sprawdzony backup i osoba odpowiedzialna za odtworzenie.
- Jeśli migracja lub smoke test zakończy się błędem, zatrzymać dalsze kroki i zachować logi bez sekretów i danych OTP.
- Nie usuwać ręcznie tabel ani nie cofać polityk RLS „na szybko”. Przygotować poprawkę/forward migration po analizie przyczyny.
- W razie problemu z dostawcą SMS nie wyłączać kontroli dostępu do bazy; przywrócić poprawne działanie endpointu i konfiguracji w kontrolowany sposób.

## Kryteria gotowości

Wydanie może być oznaczone jako gotowe dopiero, gdy:
- lokalne migracje i strukturalny test SQL przechodzą;
- runtime RLS/Storage/RPC oraz E2E przechodzą;
- Security Advisor został przejrzany, a nowe problemy wyjaśnione;
- sekrety są skonfigurowane wyłącznie po stronie serwera;
- opiekun zatwierdził plan i okno wdrożenia.

