-- 10 BUNZ update 005: optional note per item
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
      'options', array_to_string(labels, ' / '), 'line_total', unit * qty,
      'note', left(btrim(regexp_replace(coalesce(it->>'note', ''), '\s+', ' ', 'g')), 120));
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

