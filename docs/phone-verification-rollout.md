# Wdrożenie weryfikacji telefonu — LOVE Story

Ta funkcja jest przygotowana na gałęzi `feature/infobip-phone-verification`. Nie jest aktywna na produkcji.

## Kolejność wdrożenia

1. Sprawdzić konfigurację konta Infobip i zakres klucza API: wymagane uprawnienie wysyłania SMS (`sms:message:send`).
2. Ustawić po stronie serwera Vercel:
   - `INFOBIP_BASE_URL` — istniejąca wartość `https://m9lj62.api.infobip.com`
   - `INFOBIP_API_KEY` — istniejący sekret Infobip
   - `INFOBIP_SENDER` — opcjonalnie; dla konta trial może być wymagane `InfoSMS`
   - `PHONE_OTP_PEPPER` — nowy, losowy sekret o wysokiej entropii, wyłącznie jako Sensitive env var
   - `SUPABASE_SECRET_KEY` lub `SUPABASE_SERVICE_ROLE_KEY` — istniejący sekret serwerowy Supabase
3. Zastosować kolejno migracje `supabase/migrations/20261111204000_phone_verification.sql` oraz `supabase/migrations/20261111220000_phone_verification_enforcement.sql` do środowiska lokalnego/testowego. Sprawdzić tabele, funkcje, RLS, Storage i uprawnienia RPC.
4. Wykonać testy integracyjne na własnym, zweryfikowanym numerze testowym w Infobip. Nie wysyłać SMS-ów do osób postronnych.
5. Sprawdzić osobno: zwykłe konto, konto firmy, współpracownika, administratora oraz konto modułu współpracy (po drugim haśle).
6. Dopiero po przeglądzie bezpieczeństwa i zgodzie opiekuna przygotować wdrożenie produkcyjne.

## Zachowanie

- Weryfikacja jest wymagana po zalogowaniu, jeżeli konto nie ma potwierdzonego numeru.
- Ponowne logowanie nie wymaga ponownego kodu.
- Zmiana numeru wymaga nowego kodu; poprzedni numer pozostaje aktywny do chwili potwierdzenia nowego.
- Zmiana numeru wymaga świeżego logowania (ostatnie 10 minut).
- Kod ma 6 cyfr, wygasa po 5 minutach, ma maksymalnie 5 prób i cooldown 60 sekund.
- Ograniczenia wysyłania są liczone osobno dla konta, numeru i IP.
- Kody są przechowywane wyłącznie jako HMAC z sekretem serwerowym.
- Tabele i funkcje są dostępne wyłącznie dla roli `service_role`; RLS jest włączone, a `anon` i `authenticated` nie mają dostępu.

## Ważne ograniczenia

- Nie wdrażać frontendu, dopóki migracja i `PHONE_OTP_PEPPER` nie są gotowe. Bez nich API zwraca błąd konfiguracji i bramka logowania nie dopuści do panelu.
- Konto Infobip trial może wysyłać wyłącznie na numery zweryfikowane w panelu Infobip i może wymagać nadawcy testowego.
- SMS potwierdza kontrolę nad numerem telefonu; nie zastępuje silnego MFA.
- Nie logować numerów telefonów, kodów OTP ani nagłówka autoryzacji.


## Testy lokalne bez kosztów hostingu

Przed tworzeniem jakiegokolwiek zdalnego środowiska testowego użyj lokalnego Supabase CLI:

- wymagane: Node.js 20+ i Docker-compatible runtime;
- repozytorium obecnie nie ma `supabase/config.toml`, więc wygeneruj go przez `npx supabase init`;
- uruchom `npx supabase start` i `npx supabase db reset` (wyłącznie lokalnie);
- nie wykonuj `supabase link`, nie dodawaj `--remote`, nie używaj danych produkcyjnych i nie konfiguruj wysyłki prawdziwych SMS-ów na tym etapie.

Lokalny stack nie generuje opłat za gałąź/projekt Supabase. Testuje bazę i migracje; nie zastępuje testów pełnego flow auth, Vercel ani Infobip.


## Egzekwowanie po stronie serwera

Druga migracja dodaje restrykcyjne polityki RLS dla wszystkich tabel public, które mają polityki dla roli `authenticated`, oraz dla `storage.objects`. Weryfikacja jest sprawdzana na bieżąco przez `private.is_phone_verified()` i opiera się na `auth.uid()`, a nie na danych przesłanych z przeglądarki.

Zachowane wyjątki publiczne:
- odczyt zatwierdzonych reklam;
- publiczny odczyt ustawień strony;
- publiczne zgłoszenia rekrutacyjne;
- publiczne, ograniczone sprawdzanie statusu rekrutacji i ważności karty.

Migracja dodaje też kontrolę wewnątrz administracyjnych funkcji `SECURITY DEFINER`, ponieważ takie funkcje mogą omijać RLS. Publiczne funkcje weryfikacji kart i statusu rekrutacji pozostają dostępne zgodnie z dotychczasowym przeznaczeniem.

**Ważne:** po dodaniu polityk każde konto z sesją musi przejść bramkę telefonu przed pierwszym zapytaniem do chronionych tabel. Dlatego testuj również przywracanie sesji, passkey i wszystkie dodatkowe podstrony. Nie uruchamiaj migracji na produkcji w ramach testów.
