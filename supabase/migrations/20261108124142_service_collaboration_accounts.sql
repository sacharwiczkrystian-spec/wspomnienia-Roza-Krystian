create table if not exists public.service_collaboration_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  login text not null unique check (login ~ '^[a-z0-9._-]{3,32}$'),
  display_name text not null check (char_length(display_name) between 2 and 120),
  institution_label text not null check (char_length(institution_label) between 2 and 160),
  second_password_salt text not null,
  second_password_hash text not null,
  account_status text not null default 'active' check (account_status in ('active','disabled')),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.service_collaboration_accounts enable row level security;
revoke all on public.service_collaboration_accounts from anon, authenticated;
grant all on public.service_collaboration_accounts to service_role;
