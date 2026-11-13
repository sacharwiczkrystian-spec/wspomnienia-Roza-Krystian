-- REVIEW ONLY: backend MFA enforcement for SECURITY DEFINER RPCs.
-- This file is a migration candidate, not applied to any database.
-- Keep this in sync with mfa-aal2-opt-in-policy-review.sql.
--
-- The helper is SECURITY INVOKER. It checks the signed-in caller's own verified
-- MFA factors and JWT AAL. The SECURITY DEFINER RPCs below call it explicitly
-- because their table reads/writes bypass RLS.
create or replace function private.require_aal2_for_enrolled_mfa()
returns void
language plpgsql
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if exists (
    select 1
    from auth.mfa_factors f
    where f.user_id = (select auth.uid())
      and f.status = 'verified'
  )
  and coalesce((select auth.jwt()->>'aal'), 'aal1') <> 'aal2' then
    raise exception 'mfa_required' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function private.require_aal2_for_enrolled_mfa() from public, anon;
grant execute on function private.require_aal2_for_enrolled_mfa() to authenticated, service_role;

create or replace function public.admin_create_staff_id_card(
  p_audience text,
  p_display_name text,
  p_role_label text,
  p_company_name text default null,
  p_employee_number text default null,
  p_department text default null,
  p_valid_until date default null
)
returns table(
  id uuid, card_number text, display_name text, role_label text, audience text,
  company_name text, employee_number text, department text, valid_until date,
  status text, public_token uuid, created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_number text;
  v_company text := nullif(btrim(p_company_name), '');
begin
  perform private.require_aal2_for_enrolled_mfa();

  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = (select auth.uid())
  ) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  if p_audience not in ('love_story','partner_company') then
    raise exception 'invalid_audience' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_display_name,''))) < 2 or length(btrim(p_display_name)) > 120 then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_role_label,''))) < 2 or length(btrim(p_role_label)) > 100 then
    raise exception 'invalid_role_label' using errcode = '22023';
  end if;
  if p_audience = 'partner_company' and (v_company is null or length(v_company) > 160) then
    raise exception 'company_name_required' using errcode = '22023';
  end if;
  if p_audience = 'love_story' then
    v_company := null;
  end if;
  if p_employee_number is not null and length(btrim(p_employee_number)) > 40 then
    raise exception 'invalid_employee_number' using errcode = '22023';
  end if;
  if p_department is not null and length(btrim(p_department)) > 100 then
    raise exception 'invalid_department' using errcode = '22023';
  end if;

  v_number := case when p_audience = 'love_story' then 'LS-INT-' else 'LS-FIR-' end
    || to_char(current_date, 'YYYY') || '-'
    || lpad(nextval('public.staff_id_card_number_seq')::text, 6, '0');

  insert into public.staff_id_cards
    (card_number, display_name, role_label, audience, company_name, employee_number, department, valid_until, status)
  values
    (v_number, btrim(p_display_name), btrim(p_role_label), p_audience, v_company,
     nullif(btrim(p_employee_number), ''), nullif(btrim(p_department), ''), p_valid_until, 'pending_activation')
  returning public.staff_id_cards.id into v_id;

  return query
    select c.id, c.card_number, c.display_name, c.role_label, c.audience, c.company_name,
           c.employee_number, c.department, c.valid_until, c.status, c.public_token, c.created_at
    from public.staff_id_cards c where c.id = v_id;
end;
$function$;

create or replace function public.admin_list_staff_id_cards()
returns table(
  id uuid, card_number text, display_name text, role_label text,
  status text, created_at timestamptz, updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_aal2_for_enrolled_mfa();

  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = (select auth.uid())
  ) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  return query
    select c.id, c.card_number, c.display_name, c.role_label, c.status, c.created_at, c.updated_at
    from public.staff_id_cards c
    order by c.created_at desc;
end;
$function$;

create or replace function public.admin_list_staff_id_cards_v2()
returns table(
  id uuid, card_number text, display_name text, role_label text, audience text,
  company_name text, employee_number text, department text, valid_until date,
  status text, public_token uuid, created_at timestamptz, updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_aal2_for_enrolled_mfa();

  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = (select auth.uid())
  ) then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  return query
    select c.id, c.card_number, c.display_name, c.role_label, c.audience, c.company_name,
           c.employee_number, c.department, c.valid_until, c.status, c.public_token, c.created_at, c.updated_at
    from public.staff_id_cards c
    order by c.created_at desc;
end;
$function$;

create or replace function public.admin_set_staff_id_card_status(p_card_id uuid, p_status text)
returns table(id uuid, status text, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_aal2_for_enrolled_mfa();

  if auth.uid() is null or not exists (
    select 1 from public.admin_users au where au.user_id = (select auth.uid())
  ) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_status not in ('active','suspended','revoked','pending_activation') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  return query
    update public.staff_id_cards c
       set status = p_status, updated_at = now()
     where c.id = p_card_id
     returning c.id, c.status, c.updated_at;
  if not found then
    raise exception 'card_not_found' using errcode = 'P0002';
  end if;
end;
$function$;

create or replace function public.admin_list_training_users()
returns table(user_id uuid, display_name text, username text, email text, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_aal2_for_enrolled_mfa();

  if auth.uid() is null or not (
    exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
    or exists (select 1 from public.admins a where a.user_id = (select auth.uid()))
  ) then
    raise exception 'Brak uprawnień administratora' using errcode = '42501';
  end if;

  return query
    select u.id,
           coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.username), ''), split_part(coalesce(u.email, ''), '@', 1), 'Użytkownik')::text,
           p.username::text,
           u.email::text,
           coalesce(p.created_at, u.created_at)
    from auth.users u
    left join public.profiles p on p.id = u.id
    order by coalesce(p.created_at, u.created_at) desc;
end;
$function$;

create or replace function public.admin_set_training_code(p_user_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_aal2_for_enrolled_mfa();

  if auth.uid() is null or not (
    exists (select 1 from public.admin_users a where a.user_id = (select auth.uid()))
    or exists (select 1 from public.admins a where a.user_id = (select auth.uid()))
  ) then
    raise exception 'Brak uprawnień administratora' using errcode = '42501';
  end if;

  if p_code is null or btrim(p_code) = '' then
    delete from public.training_access where user_id = p_user_id;
  else
    if length(p_code) < 6 or length(p_code) > 100 then
      raise exception 'Kod musi mieć od 6 do 100 znaków' using errcode = '22023';
    end if;
    insert into public.training_access(user_id, code_hash, granted_by, updated_at)
    values (p_user_id, extensions.crypt(p_code, extensions.gen_salt('bf')), (select auth.uid()), now())
    on conflict(user_id) do update
      set code_hash = excluded.code_hash, granted_by = excluded.granted_by, updated_at = now();
  end if;
end;
$function$;

create or replace function public.get_my_training_materials(p_code text)
returns table(title text, content text)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.require_aal2_for_enrolled_mfa();

  if auth.uid() is null then
    raise exception 'Zaloguj się, aby otworzyć szkolenia' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.training_access a
    where a.user_id = (select auth.uid())
      and a.code_hash = extensions.crypt(p_code, a.code_hash)
  ) then
    raise exception 'Nieprawidłowy kod lub brak przydzielonego dostępu' using errcode = '42501';
  end if;
  return query select m.title, m.content from public.training_materials m where m.id = 1;
end;
$function$;

-- These RPCs expose account email lists or mutate training access. They are
-- authenticated-user/admin functions, never anonymous endpoints.
revoke all on function public.admin_list_training_users() from public, anon;
grant execute on function public.admin_list_training_users() to authenticated, service_role;
revoke all on function public.admin_set_training_code(uuid, text) from public, anon;
grant execute on function public.admin_set_training_code(uuid, text) to authenticated, service_role;
revoke all on function public.get_my_training_materials(text) from public, anon;
grant execute on function public.get_my_training_materials(text) to authenticated, service_role;

-- Intentionally public endpoints kept out of this change:
-- lookup_recruitment_status(text,text) requires application number + email;
-- verify_staff_id_card(uuid) and verify_staff_id_card_v2(uuid) require a random public token.
-- Trigger-only SECURITY DEFINER functions are not RPC endpoints and are audited separately.
