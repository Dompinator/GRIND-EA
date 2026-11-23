-- Store exact component quantities for PC production purchase events.
ALTER TABLE public.product_company_product_purchases
  ADD COLUMN IF NOT EXISTS purchase_quantity integer;

CREATE OR REPLACE FUNCTION public.produce_pc_product(p_product_id uuid, p_quantity integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pc public.product_company_products;
  v_case_cost numeric := 0;
  v_parts_cost numeric := 0;
  v_unit_cost numeric := 0;
  v_total_cost numeric := 0;
  v_buyer_cash numeric := 0;
  v_part record;
  v_comp_item record;
  v_req_qty integer := 0;
  v_part_payout numeric := 0;
  v_payouts jsonb := '[]'::jsonb;
  v_qty integer := GREATEST(1, LEAST(100000, COALESCE(p_quantity, 1)));
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_pc
  FROM public.product_company_products
  WHERE id = p_product_id
  FOR UPDATE;

  IF v_pc.id IS NULL OR v_pc.owner_id <> v_uid THEN
    RAISE EXCEPTION 'PC product not found or unauthorized';
  END IF;

  IF v_pc.status <> 'published' THEN
    RAISE EXCEPTION 'Publish your PC before producing units';
  END IF;

  v_case_cost := GREATEST(0, COALESCE((v_pc.design_data->>'case_build_cost')::numeric, 0));

  FOR v_comp_item IN
    WITH raw_ids AS (
      SELECT (elem #>> '{}')::uuid AS part_id
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_pc.design_data->'component_ids') = 'array'
          THEN v_pc.design_data->'component_ids'
          ELSE '[]'::jsonb
        END
      ) AS elem
      WHERE (elem #>> '{}') ~ '^[0-9a-fA-F-]{36}$'
      UNION ALL
      SELECT (v_pc.design_data->'components'->'cpu'->>'id')::uuid AS part_id
      WHERE jsonb_typeof(v_pc.design_data->'component_ids') IS DISTINCT FROM 'array'
        AND COALESCE(v_pc.design_data->'components'->'cpu'->>'id', '') ~ '^[0-9a-fA-F-]{36}$'
      UNION ALL
      SELECT (v_pc.design_data->'components'->'gpu'->>'id')::uuid AS part_id
      WHERE jsonb_typeof(v_pc.design_data->'component_ids') IS DISTINCT FROM 'array'
        AND COALESCE(v_pc.design_data->'components'->'gpu'->>'id', '') ~ '^[0-9a-fA-F-]{36}$'
    )
    SELECT part_id, COUNT(*)::integer AS per_pc_qty
    FROM raw_ids
    GROUP BY part_id
    ORDER BY part_id
  LOOP
    SELECT p.id, p.product_name, p.company_id, p.owner_id, p.listed_price, p.stock, p.status, c.company_name
    INTO v_part
    FROM public.product_company_products p
    JOIN public.product_companies c ON c.id = p.company_id
    WHERE p.id = v_comp_item.part_id
    FOR UPDATE OF p;

    IF v_part.id IS NULL THEN
      RAISE EXCEPTION 'A component used in this PC no longer exists';
    END IF;

    IF v_part.status <> 'published' THEN
      RAISE EXCEPTION '% is no longer published and cannot be used to produce PCs', v_part.product_name;
    END IF;

    v_req_qty := v_comp_item.per_pc_qty * v_qty;
    IF COALESCE(v_part.stock, 0) < v_req_qty THEN
      RAISE EXCEPTION 'Not enough stock of % (% in stock, % needed to produce % PCs)',
        v_part.product_name, COALESCE(v_part.stock, 0), v_req_qty, v_qty;
    END IF;

    v_parts_cost := v_parts_cost + (GREATEST(0, COALESCE(v_part.listed_price, 0)) * v_comp_item.per_pc_qty);
  END LOOP;

  v_unit_cost := v_case_cost + v_parts_cost;
  IF v_unit_cost <= 0 THEN
    v_unit_cost := GREATEST(0, COALESCE(v_pc.product_value, v_pc.production_cost, 0));
  END IF;

  v_total_cost := ROUND((v_unit_cost * v_qty)::numeric, 2);

  SELECT cash INTO v_buyer_cash FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF COALESCE(v_buyer_cash, 0) < v_total_cost THEN
    RAISE EXCEPTION 'Not enough cash ($% required to produce %)', v_total_cost, v_qty;
  END IF;

  UPDATE public.profiles
  SET cash = ROUND((COALESCE(cash, 0) - v_total_cost)::numeric, 2)
  WHERE id = v_uid
  RETURNING cash INTO v_buyer_cash;

  FOR v_comp_item IN
    WITH raw_ids AS (
      SELECT (elem #>> '{}')::uuid AS part_id
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_pc.design_data->'component_ids') = 'array'
          THEN v_pc.design_data->'component_ids'
          ELSE '[]'::jsonb
        END
      ) AS elem
      WHERE (elem #>> '{}') ~ '^[0-9a-fA-F-]{36}$'
      UNION ALL
      SELECT (v_pc.design_data->'components'->'cpu'->>'id')::uuid AS part_id
      WHERE jsonb_typeof(v_pc.design_data->'component_ids') IS DISTINCT FROM 'array'
        AND COALESCE(v_pc.design_data->'components'->'cpu'->>'id', '') ~ '^[0-9a-fA-F-]{36}$'
      UNION ALL
      SELECT (v_pc.design_data->'components'->'gpu'->>'id')::uuid AS part_id
      WHERE jsonb_typeof(v_pc.design_data->'component_ids') IS DISTINCT FROM 'array'
        AND COALESCE(v_pc.design_data->'components'->'gpu'->>'id', '') ~ '^[0-9a-fA-F-]{36}$'
    )
    SELECT part_id, COUNT(*)::integer AS per_pc_qty
    FROM raw_ids
    GROUP BY part_id
    ORDER BY part_id
  LOOP
    SELECT p.id, p.product_name, p.company_id, p.owner_id, p.listed_price, p.stock, c.company_name
    INTO v_part
    FROM public.product_company_products p
    JOIN public.product_companies c ON c.id = p.company_id
    WHERE p.id = v_comp_item.part_id;

    IF v_part.id IS NOT NULL THEN
      v_req_qty := v_comp_item.per_pc_qty * v_qty;
      v_part_payout := ROUND((GREATEST(0, COALESCE(v_part.listed_price, 0)) * v_req_qty)::numeric, 2);

      UPDATE public.product_company_products
      SET purchase_count = COALESCE(purchase_count, 0) + v_req_qty,
          stock = COALESCE(stock, 0) - v_req_qty
      WHERE id = v_part.id
      RETURNING stock INTO v_part.stock;

      INSERT INTO public.product_company_product_purchases (
        product_id, buyer_id, buyer_company_id, purchase_price, purchase_quantity
      ) VALUES (
        v_part.id, v_uid, v_pc.company_id, v_part_payout, v_req_qty
      );

      IF v_part_payout > 0 THEN
        UPDATE public.profiles
        SET cash = ROUND((COALESCE(cash, 0) + v_part_payout)::numeric, 2)
        WHERE id = v_part.owner_id;

        UPDATE public.product_companies
        SET total_revenue = COALESCE(total_revenue, 0) + v_part_payout
        WHERE id = v_part.company_id;
      END IF;

      v_payouts := v_payouts || jsonb_build_object(
        'product_id', v_part.id,
        'product_name', v_part.product_name,
        'company_name', v_part.company_name,
        'quantity_used', v_req_qty,
        'stock_remaining', v_part.stock,
        'payout', v_part_payout
      );
    END IF;
  END LOOP;

  UPDATE public.product_company_products
  SET stock = COALESCE(stock, 0) + v_qty
  WHERE id = v_pc.id
  RETURNING stock INTO v_pc.stock;

  UPDATE public.product_companies
  SET total_costs = COALESCE(total_costs, 0) + v_total_cost
  WHERE id = v_pc.company_id;

  SELECT cash INTO v_buyer_cash FROM public.profiles WHERE id = v_uid;

  RETURN jsonb_build_object(
    'stock', v_pc.stock,
    'quantity_added', v_qty,
    'total_cost', v_total_cost,
    'cash_remaining', v_buyer_cash,
    'payouts', v_payouts
  );
END;
$function$
;

DROP FUNCTION IF EXISTS public.get_grindworld_product_purchases();

CREATE FUNCTION public.get_grindworld_product_purchases()
RETURNS TABLE (
  product_id uuid,
  buyer_id uuid,
  buyer_company_id uuid,
  purchase_price numeric,
  purchase_quantity integer,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT purchase.product_id, purchase.buyer_id, purchase.buyer_company_id,
         purchase.purchase_price, purchase.purchase_quantity, purchase.created_at
  FROM public.product_company_product_purchases AS purchase
  JOIN public.product_company_products AS product
    ON product.id = purchase.product_id AND product.status = 'published'
  JOIN public.product_companies AS seller_company ON seller_company.id = product.company_id
  JOIN public.profiles AS seller
    ON seller.id = seller_company.owner_id AND seller.is_test_account = false
  JOIN public.profiles AS buyer
    ON buyer.id = purchase.buyer_id AND buyer.is_test_account = false
  LEFT JOIN public.product_companies AS buyer_company
    ON buyer_company.id = purchase.buyer_company_id AND buyer_company.owner_id = purchase.buyer_id
  WHERE auth.uid() IS NOT NULL
    AND purchase.created_at >= now() - interval '24 hours'
    AND (purchase.buyer_company_id IS NULL OR buyer_company.id IS NOT NULL)
  ORDER BY purchase.created_at DESC
  LIMIT 3000;
$function$;

REVOKE ALL ON FUNCTION public.get_grindworld_product_purchases() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_grindworld_product_purchases() TO authenticated;
