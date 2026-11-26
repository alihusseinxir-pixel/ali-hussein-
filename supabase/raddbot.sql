-- التخزين الدائم على Supabase: جدول بمخطط خاص (ما ينقري من الخارج) ودالتين محميتين برمز سري.
create schema if not exists raddbot;
revoke all on schema raddbot from public, anon, authenticated;
create table raddbot.state (id int primary key, data jsonb not null, updated_at timestamptz not null default now());
create table raddbot.access (token_hash text primary key);
alter table raddbot.state enable row level security;
alter table raddbot.access enable row level security;

create or replace function public.raddbot_load(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from raddbot.access where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (select data from raddbot.state where id = 1);
end $$;

create or replace function public.raddbot_save(p_token text, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from raddbot.access where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into raddbot.state (id, data, updated_at) values (1, p_data, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
end $$;

revoke all on function public.raddbot_load(text) from public;
revoke all on function public.raddbot_save(text, jsonb) from public;
grant execute on function public.raddbot_load(text) to anon, authenticated;
grant execute on function public.raddbot_save(text, jsonb) to anon, authenticated;

-- بعدها أضف بصمة الرمز السري (لا تحط الرمز نفسه):
-- insert into raddbot.access values (encode(extensions.digest('<STORAGE_TOKEN>', 'sha256'), 'hex'));
