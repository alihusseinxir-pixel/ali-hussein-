-- 10 BUNZ update 006: staff notifications for new orders + late-order alerts.
-- New order -> instant push to the restaurant's phones (via the push service).
-- Every minute -> push a reminder for orders not accepted / not ready / not picked up in time.

create extension if not exists pg_net;
create extension if not exists pg_cron;

alter table public.bunz_settings add column if not exists alert_accept_min int not null default 3;
alter table public.bunz_settings add column if not exists alert_ready_min int not null default 20;
alter table public.bunz_settings add column if not exists alert_pickup_min int not null default 10;
alter table public.bunz_orders add column if not exists alerts text[] not null default '{}';

-- Restaurant devices that receive order notifications (separate from customers).
create table if not exists public.bunz_staff_subs (
  endpoint text primary key, p256dh text not null, auth text not null,
  device text not null default '', created_at timestamptz not null default now());
-- Shared secret between the database and the push service (value never leaves the DB except to Render env).
create table if not exists public.bunz_secrets (k text primary key, v text not null);
alter table public.bunz_staff_subs enable row level security;
alter table public.bunz_secrets enable row level security;
revoke all on public.bunz_staff_subs, public.bunz_secrets from anon, authenticated;
insert into public.bunz_secrets (k, v)
  values ('notify', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (k) do nothing;

create or replace function public.bunz_admin_staff_subscribe(pin text, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  if coalesce(p->>'endpoint', '') !~ '^https://' or length(p->>'endpoint') > 600 then return jsonb_build_object('error', 'endpoint'); end if;
  insert into public.bunz_staff_subs (endpoint, p256dh, auth, device)
  values (p->>'endpoint', left(p->>'p256dh', 200), left(p->>'auth', 100), left(coalesce(p->>'device', ''), 60))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device;
  return jsonb_build_object('ok', true, 'count', (select count(*) from public.bunz_staff_subs));
end $$;

create or replace function public.bunz_admin_staff_unsubscribe(pin text, ep text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  delete from public.bunz_staff_subs where endpoint = ep;
  return jsonb_build_object('ok', true, 'count', (select count(*) from public.bunz_staff_subs));
end $$;

create or replace function public.bunz_admin_staff_info(pin text, ep text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  return jsonb_build_object('count', (select count(*) from public.bunz_staff_subs),
    'this', exists(select 1 from public.bunz_staff_subs where endpoint = ep));
end $$;

create or replace function public.bunz_admin_set_alerts(pin text, accept_min int, ready_min int, pickup_min int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  update public.bunz_settings set alert_accept_min = greatest(1, least(coalesce(accept_min, 3), 60)),
    alert_ready_min = greatest(5, least(coalesce(ready_min, 20), 120)),
    alert_pickup_min = greatest(3, least(coalesce(pickup_min, 10), 120)) where id = 1;
  return jsonb_build_object('ok', true);
end $$;

-- Called by the push service with the shared secret.
create or replace function public.bunz_staff_subs_for(secret text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when secret = (select v from public.bunz_secrets where k = 'notify')
    then jsonb_build_object('subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)) from public.bunz_staff_subs), '[]'))
    else jsonb_build_object('error', 'secret') end
$$;
create or replace function public.bunz_staff_subs_remove(secret text, endpoints text[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if secret is distinct from (select v from public.bunz_secrets where k = 'notify') then return jsonb_build_object('error', 'secret'); end if;
  delete from public.bunz_staff_subs where endpoint = any(endpoints);
  return jsonb_build_object('ok', true);
end $$;

-- Sends one notification to all restaurant devices (async HTTP, never blocks the order).
create or replace function public.bunz_staff_notify(title text, body text, tag text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from public.bunz_staff_subs) then return; end if;
  perform net.http_post(
    url := 'https://one0bunz-push.onrender.com/staff',
    body := jsonb_build_object('secret', (select v from public.bunz_secrets where k = 'notify'),
      'title', title, 'body', body, 'tag', tag),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 60000);
exception when others then null;
end $$;

create or replace function public.bunz_order_items_txt(items jsonb)
returns text language sql immutable as $$
  select left(coalesce(string_agg((l->>'qty') || '× ' || (l->>'name'), '، '), ''), 110) from jsonb_array_elements(items) l
$$;

create or replace function public.bunz_orders_new_trg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.bunz_staff_notify(
    '🔔 طلب جديد #' || new.order_no || ' · ' || to_char(new.total, 'FM999,999,999') || ' د.ع',
    case when new.order_type = 'delivery' then '🛵 توصيل' else '🏃 استلام' end || ' · ' || new.customer_name || E'\n' || public.bunz_order_items_txt(new.items),
    'order-' || new.order_no);
  return new;
end $$;
drop trigger if exists bunz_orders_new on public.bunz_orders;
create trigger bunz_orders_new after insert on public.bunz_orders for each row execute function public.bunz_orders_new_trg();

-- Runs every minute: reminders for late orders + keeps the push service awake during opening hours.
create or replace function public.bunz_order_alerts()
returns void language plpgsql volatile security definer set search_path = public as $$
declare s public.bunz_settings; o record; t int;
begin
  select * into s from public.bunz_settings where id = 1;
  if public.bunz_is_open(s) and extract(minute from now())::int % 10 = 0 then
    perform net.http_get('https://one0bunz-push.onrender.com/', timeout_milliseconds := 60000);
  end if;
  for o in select * from public.bunz_orders where created_at > now() - interval '6 hours' and status in ('new', 'preparing', 'ready') loop
    t := floor(extract(epoch from now() - o.created_at) / 60);
    if o.status = 'new' and t >= s.alert_accept_min and not ('accept' = any(o.alerts)) then
      perform public.bunz_staff_notify('⚠️ طلب #' || o.order_no || ' بعده ما انقبل', 'صارله ' || t || ' دقيقة. افتح لوحة التحكم واضغط "قبول".', 'late-' || o.order_no);
      update public.bunz_orders set alerts = alerts || 'accept' where id = o.id;
    elsif o.status in ('new', 'preparing') and t >= s.alert_ready_min and not ('ready' = any(o.alerts)) then
      perform public.bunz_staff_notify('⏰ طلب #' || o.order_no || ' متأخر', 'صارله ' || t || ' دقيقة وبعده ما جاهز. ' || o.customer_name, 'late-' || o.order_no);
      update public.bunz_orders set alerts = alerts || 'ready' where id = o.id;
    elsif o.status = 'ready' and o.order_type = 'delivery' and not ('pickup' = any(o.alerts))
      and coalesce((o.status_at->>'ready')::timestamptz, o.created_at) < now() - make_interval(mins => s.alert_pickup_min) then
      perform public.bunz_staff_notify('🛵 طلب #' || o.order_no || ' جاهز وما طلع', 'جاهز من ' || s.alert_pickup_min || ' دقايق أو أكثر. تابع الدلفري.', 'late-' || o.order_no);
      update public.bunz_orders set alerts = alerts || 'pickup' where id = o.id;
    end if;
  end loop;
end $$;

select cron.unschedule('bunz-order-alerts') where exists (select 1 from cron.job where jobname = 'bunz-order-alerts');
select cron.schedule('bunz-order-alerts', '* * * * *', 'select public.bunz_order_alerts()');

revoke all on function public.bunz_staff_notify(text, text, text), public.bunz_order_alerts(), public.bunz_orders_new_trg() from public, anon, authenticated;
grant execute on function public.bunz_admin_staff_subscribe(text, jsonb), public.bunz_admin_staff_unsubscribe(text, text),
  public.bunz_admin_staff_info(text, text), public.bunz_admin_set_alerts(text, int, int, int),
  public.bunz_staff_subs_for(text), public.bunz_staff_subs_remove(text, text[]) to anon, authenticated;
notify pgrst, 'reload schema';
