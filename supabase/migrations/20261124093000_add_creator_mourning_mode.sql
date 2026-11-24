alter table public.site_settings
  add column if not exists creator_mourning_mode boolean not null default false;

alter table public.site_settings
  add column if not exists creator_mourning_message text not null
  default 'Z szacunkiem i pamięcią. Dziękujemy za wszystkie chwile i dobro, które pozostają z nami.';
