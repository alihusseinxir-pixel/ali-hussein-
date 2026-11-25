-- 10 BUNZ update 004: customers list for the admin panel (CRM)
create or replace function public.bunz_admin_customers(pin text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.bunz_admin_ok(pin) then return jsonb_build_object('error', 'bad_pin'); end if;
  return jsonb_build_object('customers', coalesce((select jsonb_agg(c order by c.last_at desc) from (
    select o.phone,
      (array_agg(o.customer_name order by o.created_at desc))[1] as name,
      count(*) as orders,
      sum(o.total) as spent,
      min(o.created_at) as first_at,
      max(o.created_at) as last_at,
      (array_agg(o.location_label order by o.created_at desc) filter (where coalesce(o.location_label, '') <> ''))[1] as area,
      (array_agg(o.source order by o.created_at) filter (where o.source is not null))[1] as source,
      (select jsonb_agg(x.name) from (select l->>'name' as name, sum((l->>'qty')::int) q
          from public.bunz_orders o2, jsonb_array_elements(o2.items) l
          where o2.phone = o.phone and o2.status <> 'cancelled' group by 1 order by 2 desc limit 3) x) as favorites,
      (select jsonb_agg(l->>'qty' || '× ' || (l->>'name')) from public.bunz_orders o3, jsonb_array_elements(o3.items) l
          where o3.id = max(o.id)) as last_items,
      exists (select 1 from public.bunz_push_subs p where p.phone = o.phone) as has_push
    from public.bunz_orders o where o.status <> 'cancelled'
    group by o.phone) c), '[]'::jsonb),
    'callbacks', coalesce((select jsonb_agg(jsonb_build_object('phone', cb.phone, 'name', cb.name, 'at', cb.created_at) order by cb.id desc)
      from public.bunz_callbacks cb where not exists (select 1 from public.bunz_orders o where o.phone = cb.phone)), '[]'::jsonb));
end $$;
grant execute on function public.bunz_admin_customers(text) to anon, authenticated;
