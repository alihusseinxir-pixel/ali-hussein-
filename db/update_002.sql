-- 10 BUNZ update 002: callbacks, push subscriptions, bestsellers, delivery ETA
alter table public.bunz_settings add column if not exists eta_text text not null default '30–40 دقيقة';

create table if not exists public.bunz_callbacks (
  id bigserial primary key, created_at timestamptz not null default now(),
  name text not null default '', phone text not null, done boolean not null default false);
create table if not exists public.bunz_push_subs (
  id bigserial primary key, created_at timestamptz not null default now(),
  endpoint text not null unique, p256dh text not null, auth text not null, phone text not null default '');
alter table public.bunz_callbacks enable row level security;
alter table public.bunz_push_subs enable row level security;
revoke all on public.bunz_callbacks, public.bunz_push_subs from anon, authenticated;

create or replace function public.bunz_public_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'store_name', s.store_name, 'whatsapp', s.whatsapp, 'phone_display', s.phone_display,
    'address', s.address, 'rest_lat', s.rest_lat, 'rest_lng', s.rest_lng,
    'delivery_enabled', s.delivery_enabled, 'pickup_enabled', s.pickup_enabled,
    'delivery_mode', s.delivery_mode, 'flat_fee', s.flat_fee, 'tiers', s.tiers,
    'max_km', s.max_km, 'free_delivery_above', s.free_delivery_above, 'min_order', s.min_order,
    'open_time', to_char(s.open_time, 'HH24:MI'), 'close_time', to_char(s.close_time, 'HH24:MI'),
    'is_open', public.bunz_is_open(s), 'announcement', s.announcement, 'eta_text', s.eta_text,
    'bestsellers', coalesce((select jsonb_agg(x.id) from (
        select (l->>'id')::int as id, sum((l->>'qty')::int) as q
        from public.bunz_orders o, jsonb_array_elements(o.items) l
        where o.status <> 'cancelled' and o.created_at > now() - interval '30 days'
        group by 1 order by 2 desc limit 6) x), '[]'::jsonb))
  from public.bunz_settings s where s.id = 1
$$;

create or replace function public.bunz_request_callback(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_phone text := regexp_replace(coalesce(p->>'phone', ''), '[^0-9]', '', 'g');
begin
  if v_phone like '964%' then v_phone := '0' || substr(v_phone, 4); end if;
  if v_phone !~ '^07[0-9]{9}$' then return jsonb_build_object('error', 'phone'); end if;
  if (select count(*) from public.bunz_callbacks where phone = v_phone and created_at > now() - interval '1 hour') >= 3 then
    return jsonb_build_object('error', 'too_many');
  end if;
  insert into public.bunz_callbacks (name, phone) values (left(btrim(coalesce(p->>'name', '')), 60), v_phone);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bunz_push_subscribe(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if coalesce(p->>'endpoint', '') !~ '^https://' or length(p->>'endpoint') > 800 then return jsonb_build_object('error', 'endpoint'); end if;
  insert into public.bunz_push_subs (endpoint, p256dh, auth, phone)
  values (p->>'endpoint', left(p->>'p256dh', 200), left(p->>'auth', 100), left(regexp_replace(coalesce(p->>'phone', ''), '[^0-9]', '', 'g'), 15))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth,
    phone = case when excluded.phone <> '' then excluded.phone else bunz_push_subs.phone end;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bunz_admin_callbacks(pin text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  return jsonb_build_object('callbacks', coalesce((select jsonb_agg(to_jsonb(c) order by c.id desc)
    from (select * from public.bunz_callbacks order by id desc limit 50) c), '[]'),
    'push_count', (select count(*) from public.bunz_push_subs));
end $$;

create or replace function public.bunz_admin_callback_done(pin text, cb_id bigint)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  update public.bunz_callbacks set done = true where id = cb_id;
  return jsonb_build_object('ok', true);
end $$;

-- used by the push sender service (it passes the admin PIN typed in the panel)
create or replace function public.bunz_admin_push_list(pin text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  return jsonb_build_object('subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth))
    from public.bunz_push_subs), '[]'));
end $$;

create or replace function public.bunz_admin_push_remove(pin text, endpoints text[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  delete from public.bunz_push_subs where endpoint = any(endpoints);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bunz_admin_set_eta(pin text, eta text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  update public.bunz_settings set eta_text = left(coalesce(eta, ''), 40) where id = 1;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.bunz_public_settings(), public.bunz_request_callback(jsonb), public.bunz_push_subscribe(jsonb),
  public.bunz_admin_callbacks(text), public.bunz_admin_callback_done(text, bigint), public.bunz_admin_push_list(text),
  public.bunz_admin_push_remove(text, text[]), public.bunz_admin_set_eta(text, text) to anon, authenticated;
