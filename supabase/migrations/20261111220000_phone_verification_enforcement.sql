-- Enforce phone verification in Postgres, not only in browser UI/API routes.
-- Apply after 20261111204000_phone_verification.sql.
-- Public anonymous flows (approved ads, site settings, recruitment submissions,
-- staff-card QR verification and recruitment-status lookup) remain available.

create or replace function private.is_phone_verified()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.verified_phone_numbers v
    where v.user_id = (select auth.uid())
  );
$function$;

revoke all on function private.is_phone_verified() from public, anon, authenticated;
grant execute on function private.is_phone_verified() to authenticated;

-- Add a restrictive policy on every public table that currently has an
-- authenticated policy, except the three tables with deliberate anonymous
-- access that need narrower command-specific treatment below.
do $migration$
declare
  v_table text;
begin
  for v_table in
    select distinct p.tablename
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and 'authenticated' = any (p.roles)
      and p.tablename not in ('company_ads', 'site_settings', 'recruitment_applications')
  loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using ((select private.is_phone_verified())) with check ((select private.is_phone_verified()))',
      'phone_verification_required',
      v_table
    );
  end loop;
end;
$migration$;

-- Signed-in users may still read approved public ads before verification.
-- Keep that exception SELECT-only: a FOR ALL USING clause also affects DELETE.
create policy phone_verification_ads_select
on public.company_ads
as restrictive
for select
to authenticated
using ((select private.is_phone_verified()) or status = 'approved');

create policy phone_verification_ads_insert
on public.company_ads
as restrictive
for insert
to authenticated
with check ((select private.is_phone_verified()));

create policy phone_verification_ads_update
on public.company_ads
as restrictive
for update
to authenticated
using ((select private.is_phone_verified()))
with check ((select private.is_phone_verified()));

create policy phone_verification_ads_delete
on public.company_ads
as restrictive
for delete
to authenticated
using ((select private.is_phone_verified()));

-- Site settings are public-readable; only authenticated updates are gated.
create policy phone_verification_required
on public.site_settings
as restrictive
for update
to authenticated
using ((select private.is_phone_verified()))
with check ((select private.is_phone_verified()));

-- Recruitment status is intentionally looked up through a public,
-- narrowly-scoped SECURITY DEFINER RPC. Direct authenticated reads are gated.
create policy phone_verification_required
on public.recruitment_applications
as restrictive
for select
to authenticated
using ((select private.is_phone_verified()));

-- Storage objects are private buckets. Gate every authenticated object action,
-- including uploads, downloads, updates and deletes.
create policy phone_verification_required
on storage.objects
as restrictive
for all
to authenticated
using ((select private.is_phone_verified()))
with check ((select private.is_phone_verified()));

-- SECURITY DEFINER RPCs bypass table RLS, so repeat the verification check
-- inside each administrative RPC that is callable by authenticated users.
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
set search_path to ''
as $function$
declare
  v_id uuid;
  v_number text;
  v_company text := nullif(btrim(p_company_name), '');
begin
  if auth.uid() is null or not private.is_phone_verified() or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
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
  returning staff_id_cards.id into v_id;

  return query
    select c.id, c.card_number, c.display_name, c.role_label, c.audience, c.company_name,
           c.employee_number, c.department, c.valid_until, c.status, c.public_token, c.created_at
    from public.staff_id_cards c where c.id = v_id;
end;
$function$;

create or replace function public.admin_list_staff_id_cards()
returns table(
  id uuid, card_number text, display_name text, role_label text, status text,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not private.is_phone_verified() or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
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
set search_path to ''
as $function$
begin
  if auth.uid() is null or not private.is_phone_verified() or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
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
set search_path to 'public'
as $function$
begin
  if auth.uid() is null or not private.is_phone_verified() or not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
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
returns table(
  user_id uuid, display_name text, username text, email text, created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $function$
begin
  if auth.uid() is null or not private.is_phone_verified() or not (
    exists (select 1 from public.admin_users a where a.user_id = auth.uid())
    or exists (select 1 from public.admins a where a.user_id = auth.uid())
  ) then
    raise exception 'Brak uprawnień administratora';
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
set search_path to 'public', 'extensions'
as $function$
begin
  if auth.uid() is null or not private.is_phone_verified() or not (
    exists(select 1 from public.admin_users a where a.user_id=auth.uid())
    or exists(select 1 from public.admins a where a.user_id=auth.uid())
  ) then
    raise exception 'Brak uprawnień administratora';
  end if;
  if p_code is null or btrim(p_code)='' then
    delete from public.training_access where user_id=p_user_id;
  else
    if length(p_code)<6 or length(p_code)>100 then raise exception 'Kod musi mieć od 6 do 100 znaków'; end if;
    insert into public.training_access(user_id,code_hash,granted_by,updated_at)
    values(p_user_id,crypt(p_code,gen_salt('bf')),auth.uid(),now())
    on conflict(user_id) do update set code_hash=excluded.code_hash,granted_by=excluded.granted_by,updated_at=now();
  end if;
end;
$function$;

create or replace function public.get_my_training_materials(p_code text)
returns table(title text, content text)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Zaloguj się, aby otworzyć szkolenia';
  end if;
  if not private.is_phone_verified() then
    raise exception 'Najpierw potwierdź numer telefonu' using errcode = '42501';
  end if;
  if not exists(select 1 from public.training_access a where a.user_id=auth.uid() and a.code_hash=crypt(p_code,a.code_hash)) then
    raise exception 'Nieprawidłowy kod lub brak przydzielonego dostępu';
  end if;
  return query select m.title,m.content from public.training_materials m where m.id=1;
end;
$function$;


-- CREATE OR REPLACE preserves existing function ACLs. Explicitly remove the
-- default PUBLIC/anon access from privileged SECURITY DEFINER RPCs and expose
-- them only to signed-in clients; each function still performs its own checks.
revoke all on function public.admin_create_staff_id_card(text,text,text,text,text,text,date) from public, anon;
revoke all on function public.admin_list_staff_id_cards() from public, anon;
revoke all on function public.admin_list_staff_id_cards_v2() from public, anon;
revoke all on function public.admin_set_staff_id_card_status(uuid,text) from public, anon;
revoke all on function public.admin_list_training_users() from public, anon;
revoke all on function public.admin_set_training_code(uuid,text) from public, anon;
revoke all on function public.get_my_training_materials(text) from public, anon;

grant execute on function public.admin_create_staff_id_card(text,text,text,text,text,text,date) to authenticated;
grant execute on function public.admin_list_staff_id_cards() to authenticated;
grant execute on function public.admin_list_staff_id_cards_v2() to authenticated;
grant execute on function public.admin_set_staff_id_card_status(uuid,text) to authenticated;
grant execute on function public.admin_list_training_users() to authenticated;
grant execute on function public.admin_set_training_code(uuid,text) to authenticated;
grant execute on function public.get_my_training_materials(text) to authenticated;
