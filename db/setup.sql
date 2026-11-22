-- 10 BUNZ direct ordering: schema (all objects prefixed bunz_)
create extension if not exists pgcrypto;

create table if not exists public.bunz_categories (
  id serial primary key,
  name text not null,
  sort int not null default 0,
  active boolean not null default true
);

create table if not exists public.bunz_items (
  id serial primary key,
  category_id int not null references public.bunz_categories(id) on delete cascade,
  name text not null,
  description text not null default '',
  price int not null check (price >= 0),
  image_url text not null default '',
  -- options: [{"name":"اختر نوع اللحم","min":1,"max":1,"mode":"single"|"count","choices":[{"name":"سماش","price":0}]}]
  options jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  sold_out boolean not null default false,
  featured boolean not null default false,
  sort int not null default 0
);

create table if not exists public.bunz_settings (
  id int primary key default 1 check (id = 1),
  store_name text not null default '10 BUNZ',
  whatsapp text not null default '9647755191049',
  phone_display text not null default '',
  address text not null default '',
  rest_lat double precision not null default 35.4402666,
  rest_lng double precision not null default 44.3779594,
  delivery_enabled boolean not null default true,
  pickup_enabled boolean not null default true,
  delivery_mode text not null default 'tiers' check (delivery_mode in ('tiers','flat')),
  flat_fee int not null default 2000,
  tiers jsonb not null default '[{"upto_km":1,"fee":1000},{"upto_km":3,"fee":2000},{"upto_km":5,"fee":3000}]'::jsonb,
  max_km numeric not null default 8,
  free_delivery_above int not null default 0,
  min_order int not null default 0,
  open_time time not null default '10:00',
  close_time time not null default '03:00',
  open_override text not null default 'auto' check (open_override in ('auto','open','closed')),
  announcement text not null default '',
  admin_pin_hash text not null
);

create table if not exists public.bunz_sources (
  code text primary key check (code ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  created_at timestamptz not null default now()
);

create sequence if not exists public.bunz_order_no_seq start 1001;

create table if not exists public.bunz_orders (
  id bigserial primary key,
  token uuid not null default gen_random_uuid() unique,
  order_no int not null default nextval('public.bunz_order_no_seq') unique,
  created_at timestamptz not null default now(),
  customer_name text not null,
  phone text not null,
  order_type text not null check (order_type in ('delivery','pickup')),
  lat double precision,
  lng double precision,
  distance_m int,
  location_label text not null default '',
  address_note text not null default '',
  notes text not null default '',
  items jsonb not null,
  subtotal int not null,
  delivery_fee int not null,
  total int not null,
  source text,
  status text not null default 'new' check (status in ('new','preparing','on_the_way','done','cancelled'))
);
create index if not exists bunz_orders_created_idx on public.bunz_orders (created_at desc);
create index if not exists bunz_orders_phone_idx on public.bunz_orders (phone);

create table if not exists public.bunz_admin_attempts (
  id bigserial primary key,
  at timestamptz not null default now(),
  ok boolean not null
);

alter table public.bunz_categories enable row level security;
alter table public.bunz_items enable row level security;
alter table public.bunz_settings enable row level security;
alter table public.bunz_sources enable row level security;
alter table public.bunz_orders enable row level security;
alter table public.bunz_admin_attempts enable row level security;

-- Public can read the menu only. Everything else goes through functions.
drop policy if exists bunz_categories_read on public.bunz_categories;
create policy bunz_categories_read on public.bunz_categories for select to anon, authenticated using (active);
drop policy if exists bunz_items_read on public.bunz_items;
create policy bunz_items_read on public.bunz_items for select to anon, authenticated using (active);

revoke all on public.bunz_settings, public.bunz_sources, public.bunz_orders, public.bunz_admin_attempts from anon, authenticated;
revoke all on sequence public.bunz_order_no_seq from anon, authenticated;
-- 10 BUNZ direct ordering: functions (public API via PostgREST RPC)

create or replace function public.bunz_is_open(s public.bunz_settings)
returns boolean language sql stable set search_path = public as $$
  select case
    when s.open_override = 'open' then true
    when s.open_override = 'closed' then false
    else (
      with t as (select (now() at time zone 'Asia/Baghdad')::time as n)
      select case
        when s.open_time = s.close_time then true
        when s.open_time < s.close_time then t.n >= s.open_time and t.n < s.close_time
        else t.n >= s.open_time or t.n < s.close_time
      end from t)
  end
$$;

create or replace function public.bunz_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns int language sql immutable as $$
  select round(2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )))::int
$$;

-- returns fee in IQD, or null when outside the delivery area
create or replace function public.bunz_fee(s public.bunz_settings, dist_m int, subtotal int)
returns int language plpgsql stable set search_path = public as $$
declare t jsonb; km numeric := dist_m / 1000.0;
begin
  if s.max_km > 0 and km > s.max_km then return null; end if;
  if s.free_delivery_above > 0 and subtotal >= s.free_delivery_above then return 0; end if;
  if s.delivery_mode = 'flat' then return s.flat_fee; end if;
  for t in select value from jsonb_array_elements(s.tiers) order by (value->>'upto_km')::numeric loop
    if km <= (t->>'upto_km')::numeric then return (t->>'fee')::int; end if;
  end loop;
  return null;
end $$;

create or replace function public.bunz_public_settings()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'store_name', s.store_name, 'whatsapp', s.whatsapp, 'phone_display', s.phone_display,
    'address', s.address, 'rest_lat', s.rest_lat, 'rest_lng', s.rest_lng,
    'delivery_enabled', s.delivery_enabled, 'pickup_enabled', s.pickup_enabled,
    'delivery_mode', s.delivery_mode, 'flat_fee', s.flat_fee, 'tiers', s.tiers,
    'max_km', s.max_km, 'free_delivery_above', s.free_delivery_above, 'min_order', s.min_order,
    'open_time', to_char(s.open_time, 'HH24:MI'), 'close_time', to_char(s.close_time, 'HH24:MI'),
    'is_open', public.bunz_is_open(s), 'announcement', s.announcement)
  from public.bunz_settings s where s.id = 1
$$;

create or replace function public.bunz_place_order(p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  s public.bunz_settings;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_phone text := regexp_replace(coalesce(p->>'phone', ''), '[^0-9]', '', 'g');
  v_type text := coalesce(p->>'type', 'delivery');
  v_lat double precision; v_lng double precision; v_dist int; v_fee int := 0;
  v_sub int := 0; v_lines jsonb := '[]'::jsonb;
  it jsonb; r_item public.bunz_items; qty int; unit int; grp jsonb; gi int; sel jsonb; pick jsonb;
  cnt int; ch jsonb; labels text[]; glabel text[]; v_order public.bunz_orders; v_src text;
begin
  select * into s from public.bunz_settings where id = 1;
  if not public.bunz_is_open(s) then return jsonb_build_object('error', 'closed'); end if;
  if length(v_name) < 2 or length(v_name) > 60 then return jsonb_build_object('error', 'name'); end if;
  if v_phone like '964%' then v_phone := '0' || substr(v_phone, 4); end if;
  if v_phone !~ '^07[0-9]{9}$' then return jsonb_build_object('error', 'phone'); end if;
  if v_type not in ('delivery', 'pickup') then return jsonb_build_object('error', 'type'); end if;
  if v_type = 'delivery' and not s.delivery_enabled then return jsonb_build_object('error', 'type'); end if;
  if v_type = 'pickup' and not s.pickup_enabled then return jsonb_build_object('error', 'type'); end if;
  if (select count(*) from public.bunz_orders where phone = v_phone and created_at > now() - interval '10 minutes') >= 4 then
    return jsonb_build_object('error', 'too_many');
  end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 or jsonb_array_length(p->'items') > 40 then
    return jsonb_build_object('error', 'items');
  end if;

  for it in select value from jsonb_array_elements(p->'items') loop
    select * into r_item from public.bunz_items where id = (it->>'id')::int and active and not sold_out;
    if not found then return jsonb_build_object('error', 'item_unavailable', 'id', it->>'id'); end if;
    qty := coalesce((it->>'qty')::int, 0);
    if qty < 1 or qty > 20 then return jsonb_build_object('error', 'qty'); end if;
    unit := r_item.price; labels := '{}';
    gi := 0;
    for grp in select value from jsonb_array_elements(r_item.options) loop
      sel := coalesce(it->'sel'->gi, '[]'::jsonb);
      cnt := 0; glabel := '{}';
      for pick in select value from jsonb_array_elements(sel) loop
        ch := grp->'choices'->((pick->>'i')::int);
        if ch is null or coalesce((pick->>'n')::int, 0) < 1 then return jsonb_build_object('error', 'option'); end if;
        cnt := cnt + (pick->>'n')::int;
        unit := unit + coalesce((ch->>'price')::int, 0) * (pick->>'n')::int;
        glabel := glabel || (case when (pick->>'n')::int > 1 then (pick->>'n') || '× ' else '' end || (ch->>'name'));
      end loop;
      if cnt < coalesce((grp->>'min')::int, 0) or cnt > coalesce((grp->>'max')::int, 1) then
        return jsonb_build_object('error', 'option', 'item', r_item.name, 'group', grp->>'name');
      end if;
      if array_length(glabel, 1) > 0 then labels := labels || array_to_string(glabel, '، '); end if;
      gi := gi + 1;
    end loop;
    v_sub := v_sub + unit * qty;
    v_lines := v_lines || jsonb_build_object('id', r_item.id, 'name', r_item.name, 'qty', qty, 'unit', unit,
      'options', array_to_string(labels, ' / '), 'line_total', unit * qty);
  end loop;

  if s.min_order > 0 and v_sub < s.min_order then return jsonb_build_object('error', 'min_order', 'min', s.min_order); end if;

  if v_type = 'delivery' then
    v_lat := (p->>'lat')::double precision; v_lng := (p->>'lng')::double precision;
    if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      return jsonb_build_object('error', 'location');
    end if;
    v_dist := public.bunz_distance_m(s.rest_lat, s.rest_lng, v_lat, v_lng);
    v_fee := public.bunz_fee(s, v_dist, v_sub);
    if v_fee is null then return jsonb_build_object('error', 'out_of_range', 'distance_m', v_dist); end if;
  end if;

  v_src := nullif(lower(btrim(coalesce(p->>'source', ''))), '');
  if v_src is not null and not exists (select 1 from public.bunz_sources where code = v_src) then v_src := 'other:' || left(v_src, 40); end if;

  insert into public.bunz_orders (customer_name, phone, order_type, lat, lng, distance_m, location_label, address_note, notes, items, subtotal, delivery_fee, total, source)
  values (v_name, v_phone, v_type, v_lat, v_lng, v_dist, left(coalesce(p->>'location_label', ''), 200), left(coalesce(p->>'address_note', ''), 200), left(coalesce(p->>'notes', ''), 500),
          v_lines, v_sub, v_fee, v_sub + v_fee, v_src)
  returning * into v_order;

  return jsonb_build_object('order_no', v_order.order_no, 'token', v_order.token, 'subtotal', v_sub, 'delivery_fee', v_fee, 'total', v_sub + v_fee,
    'distance_m', v_dist, 'lines', v_lines, 'whatsapp', s.whatsapp);
end $$;

-- receipt page: anyone holding the unguessable token can view that one order (read-only)
create or replace function public.bunz_get_order(t uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('order_no', o.order_no, 'created_at', o.created_at, 'customer_name', o.customer_name, 'phone', o.phone,
    'order_type', o.order_type, 'lat', o.lat, 'lng', o.lng, 'distance_m', o.distance_m, 'address_note', o.address_note, 'notes', o.notes,
    'items', o.items, 'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee, 'total', o.total, 'status', o.status, 'location_label', o.location_label)
  from public.bunz_orders o where o.token = t
$$;

-- ---------- admin ----------
create or replace function public.bunz_admin_ok(pin text)
returns boolean language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_ok boolean;
begin
  if (select count(*) from public.bunz_admin_attempts a where not a.ok and a.at > now() - interval '15 minutes') >= 8 then
    return false;
  end if;
  select s.admin_pin_hash = crypt(coalesce(pin, ''), s.admin_pin_hash) into v_ok from public.bunz_settings s where s.id = 1;
  insert into public.bunz_admin_attempts (ok) values (coalesce(v_ok, false));
  delete from public.bunz_admin_attempts a where a.at < now() - interval '1 day';
  return coalesce(v_ok, false);
end $$;

create or replace function public.bunz_admin_data(pin text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'admin_pin_hash' || jsonb_build_object('is_open', public.bunz_is_open(s),
       'open_time', to_char(s.open_time, 'HH24:MI'), 'close_time', to_char(s.close_time, 'HH24:MI'))
       from public.bunz_settings s where id = 1),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort, c.id) from public.bunz_categories c), '[]'),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort, i.id) from public.bunz_items i), '[]'),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('code', so.code, 'name', so.name,
        'orders', (select count(*) from public.bunz_orders o where o.source = so.code and o.status <> 'cancelled'),
        'revenue', (select coalesce(sum(total), 0) from public.bunz_orders o where o.source = so.code and o.status <> 'cancelled'))
        order by so.created_at) from public.bunz_sources so), '[]'),
    'stats', (select jsonb_build_object(
        'today_orders', count(*) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Baghdad') at time zone 'Asia/Baghdad'),
        'today_revenue', coalesce(sum(total) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Baghdad') at time zone 'Asia/Baghdad'), 0),
        'week_orders', count(*) filter (where created_at >= now() - interval '7 days'),
        'week_revenue', coalesce(sum(total) filter (where created_at >= now() - interval '7 days'), 0),
        'customers', count(distinct phone))
      from public.bunz_orders where status <> 'cancelled'));
end $$;

create or replace function public.bunz_admin_orders(pin text, lim int default 100)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  return jsonb_build_object('orders', coalesce((select jsonb_agg(to_jsonb(o) order by o.id desc)
    from (select o.*, (select count(*) from public.bunz_orders x where x.phone = o.phone and x.id <= o.id) as customer_order_count
          from public.bunz_orders o order by o.id desc limit least(greatest(lim, 1), 500)) o), '[]'));
end $$;

create or replace function public.bunz_admin_set_status(pin text, order_id bigint, new_status text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  update public.bunz_orders set status = new_status where id = order_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bunz_admin_save_settings(pin text, v jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  update public.bunz_settings s set
    store_name = coalesce(v->>'store_name', s.store_name),
    whatsapp = coalesce(regexp_replace(v->>'whatsapp', '[^0-9]', '', 'g'), s.whatsapp),
    phone_display = coalesce(v->>'phone_display', s.phone_display),
    address = coalesce(v->>'address', s.address),
    rest_lat = coalesce((v->>'rest_lat')::double precision, s.rest_lat),
    rest_lng = coalesce((v->>'rest_lng')::double precision, s.rest_lng),
    delivery_enabled = coalesce((v->>'delivery_enabled')::boolean, s.delivery_enabled),
    pickup_enabled = coalesce((v->>'pickup_enabled')::boolean, s.pickup_enabled),
    delivery_mode = coalesce(v->>'delivery_mode', s.delivery_mode),
    flat_fee = coalesce((v->>'flat_fee')::int, s.flat_fee),
    tiers = coalesce(v->'tiers', s.tiers),
    max_km = coalesce((v->>'max_km')::numeric, s.max_km),
    free_delivery_above = coalesce((v->>'free_delivery_above')::int, s.free_delivery_above),
    min_order = coalesce((v->>'min_order')::int, s.min_order),
    open_time = coalesce((v->>'open_time')::time, s.open_time),
    close_time = coalesce((v->>'close_time')::time, s.close_time),
    open_override = coalesce(v->>'open_override', s.open_override),
    announcement = coalesce(v->>'announcement', s.announcement),
    admin_pin_hash = case when length(coalesce(v->>'new_pin', '')) >= 6 then crypt(v->>'new_pin', gen_salt('bf')) else s.admin_pin_hash end
  where id = 1;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bunz_admin_save_item(pin text, v jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare new_id int;
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  if coalesce((v->>'delete')::boolean, false) then
    delete from public.bunz_items where id = (v->>'id')::int;
    return jsonb_build_object('ok', true);
  end if;
  if v->>'id' is null then
    insert into public.bunz_items (category_id, name, description, price, image_url, options, active, sold_out, featured, sort)
    values ((v->>'category_id')::int, v->>'name', coalesce(v->>'description', ''), (v->>'price')::int, coalesce(v->>'image_url', ''),
      coalesce(v->'options', '[]'), coalesce((v->>'active')::boolean, true), coalesce((v->>'sold_out')::boolean, false),
      coalesce((v->>'featured')::boolean, false), coalesce((v->>'sort')::int, 999))
    returning id into new_id;
  else
    update public.bunz_items i set
      category_id = coalesce((v->>'category_id')::int, i.category_id), name = coalesce(v->>'name', i.name),
      description = coalesce(v->>'description', i.description), price = coalesce((v->>'price')::int, i.price),
      image_url = coalesce(v->>'image_url', i.image_url), options = coalesce(v->'options', i.options),
      active = coalesce((v->>'active')::boolean, i.active), sold_out = coalesce((v->>'sold_out')::boolean, i.sold_out),
      featured = coalesce((v->>'featured')::boolean, i.featured), sort = coalesce((v->>'sort')::int, i.sort)
    where id = (v->>'id')::int returning id into new_id;
  end if;
  return jsonb_build_object('ok', true, 'id', new_id);
end $$;

create or replace function public.bunz_admin_save_category(pin text, v jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  if v->>'id' is null then
    insert into public.bunz_categories (name, sort) values (v->>'name', coalesce((v->>'sort')::int, 999));
  elsif coalesce((v->>'delete')::boolean, false) then
    if exists (select 1 from public.bunz_items where category_id = (v->>'id')::int) then
      return jsonb_build_object('error', 'not_empty');
    end if;
    delete from public.bunz_categories where id = (v->>'id')::int;
  else
    update public.bunz_categories c set name = coalesce(v->>'name', c.name), sort = coalesce((v->>'sort')::int, c.sort),
      active = coalesce((v->>'active')::boolean, c.active) where id = (v->>'id')::int;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bunz_admin_save_source(pin text, v jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  if coalesce((v->>'delete')::boolean, false) then
    delete from public.bunz_sources where code = v->>'code';
  else
    insert into public.bunz_sources (code, name) values (lower(v->>'code'), v->>'name')
    on conflict (code) do update set name = excluded.name;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Lock down: only the intended entry points are callable by the public.
revoke all on function public.bunz_is_open(public.bunz_settings), public.bunz_fee(public.bunz_settings, int, int),
  public.bunz_admin_ok(text) from public, anon, authenticated;
grant execute on function public.bunz_public_settings(), public.bunz_place_order(jsonb), public.bunz_get_order(uuid),
  public.bunz_admin_data(text), public.bunz_admin_orders(text, int), public.bunz_admin_set_status(text, bigint, text),
  public.bunz_admin_save_settings(text, jsonb), public.bunz_admin_save_item(text, jsonb),
  public.bunz_admin_save_category(text, jsonb), public.bunz_admin_save_source(text, jsonb) to anon, authenticated;
truncate public.bunz_items, public.bunz_categories restart identity cascade;
insert into public.bunz_categories (id,name,sort) values (1,'بركر لحم',1);
insert into public.bunz_categories (id,name,sort) values (2,'وجبات بركر لحم',2);
insert into public.bunz_categories (id,name,sort) values (3,'بركر دجاج',3);
insert into public.bunz_categories (id,name,sort) values (4,'وجبات دجاج',4);
insert into public.bunz_categories (id,name,sort) values (5,'البوكسات',5);
insert into public.bunz_categories (id,name,sort) values (6,'فرايز',6);
insert into public.bunz_categories (id,name,sort) values (7,'سوفت درينك',7);
insert into public.bunz_categories (id,name,sort) values (8,'صوصات',8);
select setval('public.bunz_categories_id_seq', 8);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (1,'هوم بركر','',6000,'https://api.foodifypos.com/rificafe/images/4a01d8e8-2e6f-4c93-9944-bcbc6a0806a7.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,0,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (1,'بركر 10 بنز','',6500,'https://api.foodifypos.com/rificafe/images/70386d3c-7b73-48c4-bbf1-ac5d6c8db074.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,1,true);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (1,'اونيون بركر','',7000,'https://api.foodifypos.com/rificafe/images/7e2871d4-ef7b-4b2a-958c-e2038a5272c1.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,2,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (1,'بركر جيزي','',7000,'https://api.foodifypos.com/rificafe/images/69de8ada-2589-4548-a251-06a2baa5aee3.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,3,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (1,'بركر فاير سلايز','',7000,'https://api.foodifypos.com/rificafe/images/ebfe3b57-39cb-40a1-96b2-1597170f9451.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,4,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (1,'بركر سويس مشروم','',7500,'https://api.foodifypos.com/rificafe/images/7b85d43a-3020-4bc5-ad08-95740b3c6e2d.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,5,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (1,'بركر برسكت','',8500,'https://api.foodifypos.com/rificafe/images/bb1ff9cd-aa93-4a26-ab85-a97482566c12.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,6,true);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (1,'بركر سويت جيلي','',7000,'https://api.foodifypos.com/rificafe/images/e6a78f02-52de-48a5-9f07-582884506cc6.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,7,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (1,'بركر 80S','',7500,'https://api.foodifypos.com/rificafe/images/c7be61a8-ce60-4425-9b0e-ee91f7a43cf0.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,8,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (2,'وجبة هوم بركر','بركر + فرايز + مشروب',8000,'https://api.foodifypos.com/rificafe/images/676bf559-c09c-4bdc-8372-d625032565d4.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,0,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (2,'وجبة 10 بنز بركر','بركر + فرايز + مشروب',8500,'https://api.foodifypos.com/rificafe/images/a2b01af0-ecec-4e6b-b55a-f3ae5eede1c3.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,1,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (2,'وجبة اونيون بركر','بركر + فرايز + مشروب',9000,'https://api.foodifypos.com/rificafe/images/a622c0f0-17ba-41e2-a8b9-cd8e8683b752.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,2,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (2,'وجبة جيزي بركر','بركر + فرايز + مشروب',9000,'https://api.foodifypos.com/rificafe/images/353cec56-f639-4576-98c3-f7dc8aa3ad66.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,3,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (2,'وجبة بركر فاير سلايز','بركر + فرايز + مشروب',9000,'https://api.foodifypos.com/rificafe/images/9d26741e-cd43-427a-b995-ad0952353403.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,4,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (2,'وجبة بركر سويس مشروم','بركر + فرايز + مشروب',9500,'https://api.foodifypos.com/rificafe/images/ff09af41-cd23-4a50-a425-a6faa9864324.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,5,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (2,'وجبة بركر برسكت','بركر + فرايز + مشروب',10500,'https://api.foodifypos.com/rificafe/images/bca66030-d378-4f2e-ba39-6e8c0da9b234.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,6,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (2,'وجبة بركر سويت جيلي','بركر + فرايز + مشروب',9000,'https://api.foodifypos.com/rificafe/images/bfd48df9-8c50-4ab6-8262-cc0978bc9d1e.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,7,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (2,'وجبة 80S بركر','بركر + فرايز + مشروب',9500,'https://api.foodifypos.com/rificafe/images/c7be61a8-ce60-4425-9b0e-ee91f7a43cf0.webp','[{"name": "اختر نوع اللحم", "min": 1, "max": 1, "mode": "single", "choices": [{"name": "سماش", "price": 0}, {"name": "كلاسيك", "price": 0}]}]'::jsonb,8,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (2,'كومبو 80S','كومبو',13750,'https://api.foodifypos.com/rificafe/images/c7be61a8-ce60-4425-9b0e-ee91f7a43cf0.webp','[]'::jsonb,9,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (3,'كلاسك 10 بنز دجاج','',6500,'https://api.foodifypos.com/rificafe/images/c410e597-7cb7-4a0b-9b79-ccebdceb1cac.webp','[]'::jsonb,0,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (3,'اورجنال كولسلو دجاج','',6500,'https://api.foodifypos.com/rificafe/images/12b959da-435c-4eb3-b4ca-03f0879feb82.webp','[]'::jsonb,1,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (3,'سبايسي 10 بنز دجاج','',6500,'https://api.foodifypos.com/rificafe/images/0381fc8d-ffec-4eea-b769-d87e6883bd99.webp','[]'::jsonb,2,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (3,'سيزر كرانش بركر دجاج','',6500,'https://api.foodifypos.com/rificafe/images/e9bf0616-9550-441b-8f2d-072908ba37d0.webp','[]'::jsonb,3,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (4,'وجبة كلاسك 10 بنز دجاج','بركر + فرايز + مشروب',8500,'https://api.foodifypos.com/rificafe/images/6883eb91-ae26-41d5-a9ef-36db51436bd6.webp','[]'::jsonb,0,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (4,'وجبة اورجنال كولسلو دجاج','بركر + فرايز + مشروب',8500,'https://api.foodifypos.com/rificafe/images/1da6286c-978a-49dd-bc9d-1af762a48ba3.webp','[]'::jsonb,1,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (4,'وجبة سبايسي 10 بنز دجاج','بركر + فرايز + مشروب',8500,'https://api.foodifypos.com/rificafe/images/e6fbb9b0-0f8a-493d-a39c-2d05b4f304ff.webp','[]'::jsonb,2,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (4,'وجبة سيزر بركر دجاج','بركر + فرايز + مشروب',8500,'https://api.foodifypos.com/rificafe/images/e9bf0616-9550-441b-8f2d-072908ba37d0.webp','[]'::jsonb,3,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (5,'بوكس الاصدقاء','5 بركر (3 لحم + 2 دجاج) + كلاسك فنكر + بيبسي عائلي',34750,'https://api.foodifypos.com/rificafe/images/6618daea-fbca-4b41-ae76-19bc025a805b.webp','[{"name": "اختر 3 بركر لحم", "min": 3, "max": 3, "mode": "count", "choices": [{"name": "سماش 10 بنز", "price": 0}, {"name": "سماش سويت جيلي", "price": 0}, {"name": "سماش سويس مشروم", "price": 0}, {"name": "سماش هوم بركر", "price": 0}, {"name": "سماش جيزي", "price": 0}, {"name": "سماش اونيون", "price": 0}, {"name": "سماش فاير سلايز", "price": 0}]}, {"name": "اختر 2 بركر دجاج", "min": 2, "max": 2, "mode": "count", "choices": [{"name": "اورجنال كولسلو دجاج", "price": 0}, {"name": "كلاسك 10 بنز دجاج", "price": 0}, {"name": "سبايسي 10 بنز دجاج", "price": 0}]}]'::jsonb,0,true);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (5,'بوكس الاصدقاء (برسكت)','5 بركر (3 لحم + 2 دجاج) + كلاسك فنكر + بيبسي عائلي',35750,'https://api.foodifypos.com/rificafe/images/f9e91ba4-f58a-45b3-96c0-83dfa271a96e.webp','[{"name": "اختر 3 بركر لحم", "min": 3, "max": 3, "mode": "count", "choices": [{"name": "سماش 10 بنز", "price": 0}, {"name": "سماش سويت جيلي", "price": 0}, {"name": "سماش سويس مشروم", "price": 0}, {"name": "سماش هوم بركر", "price": 0}, {"name": "سماش جيزي", "price": 0}, {"name": "سماش اونيون", "price": 0}, {"name": "سماش فاير سلايز", "price": 0}, {"name": "برسكت", "price": 0}]}, {"name": "اختر 2 بركر دجاج", "min": 2, "max": 2, "mode": "count", "choices": [{"name": "اورجنال كولسلو دجاج", "price": 0}, {"name": "كلاسك 10 بنز دجاج", "price": 0}, {"name": "سبايسي 10 بنز دجاج", "price": 0}]}]'::jsonb,1,true);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (6,'كرنشي جيزي كاب','',7750,'https://api.foodifypos.com/rificafe/images/32f1d92b-eedc-451b-9eac-6807d9c6b14c.webp','[]'::jsonb,0,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (6,'بيف فرايز كاب','',7750,'https://api.foodifypos.com/rificafe/images/1fa9bb28-ae94-49ec-96bf-0c5065e30dc6.webp','[]'::jsonb,1,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (6,'جيزي مني كاب','',7500,'https://api.foodifypos.com/rificafe/images/6f25a034-0330-4587-8f54-346ae50939e4.webp','[]'::jsonb,2,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (6,'كلاسك فنكر','',3000,'https://api.foodifypos.com/rificafe/images/b6418366-c52f-4b02-b5e8-453e567131f4.webp','[]'::jsonb,3,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (6,'وافل فنكر','',3000,'https://api.foodifypos.com/rificafe/images/0512b6d6-785d-48ed-877b-31488d91a233.webp','[]'::jsonb,4,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (6,'كلاسك فنكر سمول','',2000,'https://api.foodifypos.com/rificafe/images/b6418366-c52f-4b02-b5e8-453e567131f4.webp','[]'::jsonb,5,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (7,'ببسي','',500,'https://api.foodifypos.com/rificafe/images/eac4cfb0-0877-455a-af28-593918d93771.webp','[]'::jsonb,0,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (7,'بيبسي دايت','',500,'https://api.foodifypos.com/rificafe/images/3178f92c-5812-461d-bb94-3026f727c89b.webp','[]'::jsonb,1,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (7,'بيبسي عائلي','',750,'https://api.foodifypos.com/rificafe/images/efa1c9b2-2812-4964-846d-cc26f3a44dc0.webp','[]'::jsonb,2,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (7,'مياه معدنية بنز','',500,'https://api.foodifypos.com/rificafe/images/5f9ba10c-9ffb-422a-a793-d45a3a454ea6.webp','[]'::jsonb,3,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (8,'صوص هاني ماسترد','',500,'https://api.foodifypos.com/rificafe/images/a2a8b24f-df9a-4ffc-aac2-3d77c1972647.webp','[]'::jsonb,0,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (8,'صوص باربيكيو','',500,'https://api.foodifypos.com/rificafe/images/0d1158f5-9e4d-46ec-a083-50b3802ccaa3.webp','[]'::jsonb,1,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (8,'صوص تشيدر','',500,'https://api.foodifypos.com/rificafe/images/433b986e-5e6f-4ecd-9d56-5f0a8cae7590.webp','[]'::jsonb,2,false);
insert into public.bunz_items (category_id,name,description,price,image_url,options,sort,featured) values (8,'صوص ثومية','',500,'https://api.foodifypos.com/rificafe/images/0e8bf972-6e00-4cfc-b291-265e371c6a4a.webp','[]'::jsonb,3,false);
insert into public.bunz_settings (id, tiers, admin_pin_hash, address, phone_display) values (1, '[{"upto_km":1,"fee":1000},{"upto_km":3,"fee":2000},{"upto_km":5,"fee":3000},{"upto_km":8,"fee":4000}]'::jsonb, 'pending', 'كركوك، شارع القدس، مجاور O3', '07750801010') on conflict (id) do nothing;
insert into public.bunz_sources (code,name) values ('instagram','إنستغرام'),('tiktok','تيك توك'),('car','إعلان السيارة') on conflict do nothing;
