-- 10 BUNZ update 003: driver handover (ready status, drivers, status times)
alter table public.bunz_orders drop constraint if exists bunz_orders_status_check;
alter table public.bunz_orders add constraint bunz_orders_status_check
  check (status in ('new','preparing','ready','on_the_way','done','cancelled'));
alter table public.bunz_orders add column if not exists driver_name text not null default '';
alter table public.bunz_orders add column if not exists driver_phone text not null default '';
alter table public.bunz_orders add column if not exists status_at jsonb not null default '{}'::jsonb;
alter table public.bunz_settings add column if not exists drivers jsonb not null default '[]'::jsonb;

create or replace function public.bunz_admin_set_status(pin text, order_id bigint, new_status text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  if new_status not in ('new','preparing','ready','on_the_way','done','cancelled') then return jsonb_build_object('error', 'status'); end if;
  update public.bunz_orders set status = new_status, status_at = status_at || jsonb_build_object(new_status, now()) where id = order_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bunz_admin_assign_driver(pin text, order_id bigint, d_name text, d_phone text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  update public.bunz_orders set driver_name = left(coalesce(d_name, ''), 40),
    driver_phone = left(regexp_replace(coalesce(d_phone, ''), '[^0-9]', '', 'g'), 15) where id = order_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bunz_admin_save_drivers(pin text, d jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  if jsonb_typeof(d) <> 'array' or jsonb_array_length(d) > 30 then return jsonb_build_object('error', 'drivers'); end if;
  update public.bunz_settings set drivers = (select coalesce(jsonb_agg(jsonb_build_object(
      'name', left(coalesce(x->>'name', ''), 40), 'phone', left(regexp_replace(coalesce(x->>'phone', ''), '[^0-9]', '', 'g'), 15))), '[]'::jsonb)
    from jsonb_array_elements(d) x where coalesce(x->>'name', '') <> '') where id = 1;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bunz_get_order(t uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('order_no', o.order_no, 'created_at', o.created_at, 'customer_name', o.customer_name, 'phone', o.phone,
    'order_type', o.order_type, 'lat', o.lat, 'lng', o.lng, 'distance_m', o.distance_m, 'address_note', o.address_note, 'notes', o.notes,
    'items', o.items, 'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee, 'total', o.total, 'status', o.status, 'location_label', o.location_label,
    'driver_name', o.driver_name, 'status_at', o.status_at)
  from public.bunz_orders o where o.token = t
$$;

grant execute on function public.bunz_admin_set_status(text, bigint, text), public.bunz_admin_assign_driver(text, bigint, text, text),
  public.bunz_admin_save_drivers(text, jsonb), public.bunz_get_order(uuid) to anon, authenticated;
