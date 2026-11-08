alter table public.staff_id_cards
  add column if not exists audience text not null default 'love_story',
  add column if not exists company_name text,
  add column if not exists employee_number text,
  add column if not exists department text,
  add column if not exists valid_until date;

alter table public.staff_id_cards drop constraint if exists staff_id_cards_audience_check;
alter table public.staff_id_cards add constraint staff_id_cards_audience_check
  check (audience in ('love_story','partner_company'));

create sequence if not exists public.staff_id_card_number_seq;

create or replace function public.admin_create_staff_id_card(
  p_audience text, p_display_name text, p_role_label text,
  p_company_name text default null, p_employee_number text default null,
  p_department text default null, p_valid_until date default null
)
returns table (
  id uuid, card_number text, display_name text, role_label text, audience text,
  company_name text, employee_number text, department text, valid_until date,
  status text, public_token uuid, created_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_number text; v_company text := nullif(btrim(p_company_name), '');
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if p_audience not in ('love_story','partner_company') then raise exception 'invalid_audience' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_display_name,''))) < 2 or length(btrim(p_display_name)) > 120 then raise exception 'invalid_display_name' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_role_label,''))) < 2 or length(btrim(p_role_label)) > 100 then raise exception 'invalid_role_label' using errcode = '22023'; end if;
  if p_audience = 'partner_company' and (v_company is null or length(v_company) > 160) then raise exception 'company_name_required' using errcode = '22023'; end if;
  if p_audience = 'love_story' then v_company := null; end if;
  if p_employee_number is not null and length(btrim(p_employee_number)) > 40 then raise exception 'invalid_employee_number' using errcode = '22023'; end if;
  if p_department is not null and length(btrim(p_department)) > 100 then raise exception 'invalid_department' using errcode = '22023'; end if;
  v_number := case when p_audience = 'love_story' then 'LS-INT-' else 'LS-FIR-' end || to_char(current_date, 'YYYY') || '-' || lpad(nextval('public.staff_id_card_number_seq')::text, 6, '0');
  insert into public.staff_id_cards (card_number,display_name,role_label,audience,company_name,employee_number,department,valid_until,status)
  values (v_number,btrim(p_display_name),btrim(p_role_label),p_audience,v_company,nullif(btrim(p_employee_number),''),nullif(btrim(p_department),''),p_valid_until,'pending_activation')
  returning public.staff_id_cards.id into v_id;
  return query select c.id,c.card_number,c.display_name,c.role_label,c.audience,c.company_name,c.employee_number,c.department,c.valid_until,c.status,c.public_token,c.created_at
  from public.staff_id_cards c where c.id=v_id;
end;
$$;

create or replace function public.admin_list_staff_id_cards_v2()
returns table (
  id uuid, card_number text, display_name text, role_label text, audience text,
  company_name text, employee_number text, department text, valid_until date,
  status text, public_token uuid, created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then raise exception 'admin_required' using errcode = '42501'; end if;
  return query select c.id,c.card_number,c.display_name,c.role_label,c.audience,c.company_name,c.employee_number,c.department,c.valid_until,c.status,c.public_token,c.created_at,c.updated_at
  from public.staff_id_cards c order by c.created_at desc;
end;
$$;

create or replace function public.verify_staff_id_card_v2(card_token uuid)
returns table (
  card_number text, display_name text, role_label text, audience text,
  company_name text, employee_number text, department text, valid_until date,
  status text, updated_at timestamptz
)
language sql security definer set search_path = ''
as $$
  select c.card_number,c.display_name,c.role_label,c.audience,c.company_name,c.employee_number,c.department,c.valid_until,c.status,c.updated_at
  from public.staff_id_cards c where c.public_token=card_token limit 1;
$$;

revoke all on function public.admin_create_staff_id_card(text,text,text,text,text,text,date) from public, anon;
revoke all on function public.admin_list_staff_id_cards_v2() from public, anon;
revoke all on function public.verify_staff_id_card_v2(uuid) from public;
grant execute on function public.admin_create_staff_id_card(text,text,text,text,text,text,date) to authenticated;
grant execute on function public.admin_list_staff_id_cards_v2() to authenticated;
grant execute on function public.verify_staff_id_card_v2(uuid) to anon, authenticated;
