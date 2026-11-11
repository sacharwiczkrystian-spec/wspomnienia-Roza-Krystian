# Audyt weryfikacji telefonu — 11.11.2026

## Zakres

Przejrzano gałąź `feature/infobip-phone-verification`, w tym:
- endpoint SMS `api/phone-verification.js` i wspólny skrypt `phone-verification.js`;
- migrację OTP `20261111204000_phone_verification.sql`;
- nową migrację egzekwowania `20261111220000_phone_verification_enforcement.sql`;
- integracje logowania w pięciu panelach;
- endpointy API korzystające z klucza serwerowego;
- katalogowe metadane produkcyjnego Supabase (polityki RLS, uprawnienia funkcji, widoki i ustawienia bucketów). Odczytano wyłącznie metadane schematu/polityk, nie treści prywatnych rekordów użytkowników.

## Zmiany w gałęzi

1. **OTP i Infobip:** 6-cyfrowy kod, 5 minut ważności, maksymalnie 5 prób, cooldown 60 sekund, HMAC z sekretem serwerowym, limity użytkownik/numer/IP.
2. **Nieudane wysłanie SMS:** endpoint próbuje anulować challenge, gdy Infobip zwraca błąd HTTP lub występuje błąd sieci.
3. **Wspólny helper serwerowy:** `lib/phone-verification.js` sprawdza rekord w `verified_phone_numbers` przy użyciu klucza serwerowego; nie ufa wartościom przesłanym przez przeglądarkę.
4. **API:** bramka serwerowa jest używana w `company-accounts`, administracyjnych akcjach `service-accounts`, `admin-premium-requests`, `company-premium` i `create-checkout-session`. Akcja `verify_second` w `service-accounts` pozostaje dostępna przed OTP, ponieważ stanowi drugi etap logowania do konta służb; dopiero po nim użytkownik przechodzi do SMS.
5. **RLS:** nowa migracja dodaje `private.is_phone_verified()` i restrykcyjne polityki dla tabel public z istniejącymi politykami roli `authenticated`. Wyjątki z publicznym dostępem obsłużono osobno:
   - `company_ads`: niezalogowani i niezweryfikowani nadal mogą odczytać zatwierdzone reklamy; operacje konta wymagają weryfikacji;
   - `site_settings`: publiczny odczyt pozostaje dostępny, aktualizacja przez authenticated wymaga weryfikacji;
   - `recruitment_applications`: publiczne zgłoszenia pozostają dostępne, odczyt przez authenticated wymaga weryfikacji;
   - `storage.objects`: wszystkie operacje roli authenticated wymagają zweryfikowanego numeru.
6. **SECURITY DEFINER:** RLS nie chroni przed funkcjami SECURITY DEFINER, które omijają RLS. Dlatego migracja dodaje jawny warunek weryfikacji do administracyjnych RPC kart identyfikacyjnych, administracyjnych RPC szkoleniowych oraz `get_my_training_materials`. Publiczne, wąsko ograniczone funkcje `lookup_recruitment_status`, `verify_staff_id_card` i `verify_staff_id_card_v2` pozostają publiczne zgodnie z ich przeznaczeniem.
7. **Kolejność logowania:** weryfikacja musi odbyć się przed pierwszym zapytaniem do tabel objętych RLS. W sprawdzonych flow głównej aplikacji, panelu firmy, panelu administratora i panelu zarządzania współpracą ze służbami bramka znajduje się przed danymi panelu; moduł służb przechodzi ją po drugim haśle.

## Odczytany stan schematu Supabase

- W produkcyjnym schemacie public znaleziono 41 tabel z politykami dla `authenticated`; żadna z tych tabel nie miała wyłączonego RLS.
- `storage.objects` ma włączone RLS; pięć bucketów widocznych w metadanych jest oznaczonych jako prywatne.
- Nie znaleziono widoków ani materialized views w schemacie public.
- Wykryto funkcje SECURITY DEFINER omijające RLS. Te, które są dostępne użytkownikom i wykonują administracyjne/chronione operacje, uwzględniono w nowej migracji. Publiczne funkcje weryfikacji kart i statusu rekrutacji pozostawiono bez bramki.
- `private` ma już wzorzec funkcji `private.is_admin()`; nowy helper korzysta z tego samego modelu funkcji w prywatnym schemacie.

## Blokery przed wdrożeniem

- **Migracje nie zostały uruchomione lokalnie ani na środowisku testowym.** Nowy SQL jest zapisany w PR, ale nie ma jeszcze potwierdzenia wykonania.
- **Brak `PHONE_OTP_PEPPER` w znanej konfiguracji Vercel.** Bez niego endpoint weryfikacji zwraca 503.
- **Niepotwierdzona nazwa sekretu Supabase w Vercel.** Należy potwierdzić nazwę i zakres bez odczytywania wartości.
- **Infobip nie został przetestowany.** Nie potwierdzono zakresu `sms:message:send`, nadawcy ani ograniczeń trial.
- **Brak testów runtime i end-to-end.** Parsowanie JavaScript nie dowodzi poprawności działania API, RLS, Storage ani logowania.
- **Nie uruchomiono automatycznego testu SQL ani advisorów** dla nowej migracji.
- **Nie testowano wszystkich stron** po założeniu, że zapytania RLS mogą być blokowane przed OTP. Należy sprawdzić także strony dodatkowe, które korzystają z Supabase bez wspólnej bramki.

## Testy wymagane lokalnie

1. Użyć lokalnego Supabase CLI i kontenera Docker; bez `supabase link`, bez `--remote` i bez kopiowania danych produkcyjnych.
2. Wykonać migracje w kolejności i sprawdzić, czy obie przechodzą bez błędów.
3. Przygotować dwa konta testowe: jedno z wpisem w `verified_phone_numbers`, drugie bez wpisu.
4. Sprawdzić bezpośrednio przez klienta Supabase, że konto niezweryfikowane nie może czytać ani modyfikować tabel chronionych ani obiektów Storage; konto zweryfikowane zachowuje tylko swoje dotychczasowe uprawnienia.
5. Sprawdzić wyjątki publiczne: zatwierdzone reklamy, publiczny odczyt ustawień, publiczne zgłoszenia rekrutacyjne i publiczną weryfikację karty.
6. Wywołać bezpośrednio administracyjne RPC jako konto niezweryfikowane i potwierdzić odmowę; jako zweryfikowany administrator potwierdzić działanie.
7. Przejść pełne ścieżki: zwykłe konto, firma, współpracownik, administrator, konto służb po drugim haśle, sesja przywrócona i passkey.
8. Sprawdzić zmianę numeru, błędy Infobip, limity i unieważnienie kodu.

## Werdykt

**NIE MERGOWAĆ I NIE WDRAŻAĆ NA PRODUKCJĘ.** Wprowadzono warstwę egzekwowania po stronie API, RLS, Storage i wybranych funkcji SECURITY DEFINER, ale nowa migracja nie została uruchomiona ani zweryfikowana. Nie wysłano SMS, nie sprawdzono klucza Infobip i nie wykonano wdrożenia. Kolejny krok to lokalne testy migracji i testy kont; produkcyjne wdrożenie wymaga pełnego review oraz udziału i zgody opiekuna.
