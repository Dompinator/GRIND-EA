-- =====================================================================
-- GRIND-EA · PC Manufacturing Company Migration
-- Run once in your Supabase SQL Editor
-- Adds:
--   1. product_company_pc_cases table + RLS
--   2. product_companies.product_lines & product_company_products.product_line check updates (allowing 'pc')
--   3. product_company_research check constraint including CPU + GPU + CHIP + PC keys
--   4. unlock_company_research RPC (with PC research keys & costs)
--   5. save_pc_product_draft RPC (creates/updates draft PC with Specs, no tiers)
--   6. produce_pc_product RPC (pays every component maker's company + owner listed_price * qty!)
-- =====================================================================

-- 1) Saved PC Cases table
CREATE TABLE IF NOT EXISTS public.product_company_pc_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.product_companies(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  case_name text NOT NULL,
  case_size text NOT NULL DEFAULT 'small',
  case_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_company_pc_cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pc_cases_select_own" ON public.product_company_pc_cases;
CREATE POLICY "pc_cases_select_own"
  ON public.product_company_pc_cases
  FOR SELECT
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "pc_cases_insert_own" ON public.product_company_pc_cases;
CREATE POLICY "pc_cases_insert_own"
  ON public.product_company_pc_cases
  FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "pc_cases_update_own" ON public.product_company_pc_cases;
CREATE POLICY "pc_cases_update_own"
  ON public.product_company_pc_cases
  FOR UPDATE
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "pc_cases_delete_own" ON public.product_company_pc_cases;
CREATE POLICY "pc_cases_delete_own"
  ON public.product_company_pc_cases
  FOR DELETE
  USING (auth.uid() = owner_id);

-- 2) Allow 'pc' in product_companies & product_company_products check constraints if they exist
ALTER TABLE public.product_companies
  DROP CONSTRAINT IF EXISTS product_companies_product_lines_check;
ALTER TABLE public.product_companies
  ADD CONSTRAINT product_companies_product_lines_check
  CHECK (product_lines <@ ARRAY['cpu', 'gpu', 'pc']::text[]);

ALTER TABLE public.product_company_products
  DROP CONSTRAINT IF EXISTS product_company_products_product_line_check;
ALTER TABLE public.product_company_products
  ADD CONSTRAINT product_company_products_product_line_check
  CHECK (product_line IN ('cpu', 'gpu', 'pc'));

ALTER TABLE public.product_company_products
  DROP CONSTRAINT IF EXISTS product_company_products_body_type_check;
ALTER TABLE public.product_company_products
  ADD CONSTRAINT product_company_products_body_type_check
  CHECK (body_type IN (
    'gray', 'silicon', 'carbon', 'titanium',
    'plastic', 'metallic',
    'small', 'medium', 'large'
  ));

-- 3) Update research_key check constraint to allow CPU + GPU + CHIP + PC keys
ALTER TABLE public.product_company_research
  DROP CONSTRAINT IF EXISTS product_company_research_research_key_check;

ALTER TABLE public.product_company_research
  ADD CONSTRAINT product_company_research_research_key_check
  CHECK (research_key IN (
    -- CPU
    'simple_1_core','two_cores','four_cores','eight_cores','sixteen_cores','thirty_two_cores','sixty_four_cores','eighty_six_cores',
    'simple_4_threads','six_threads','eight_threads','twelve_threads','eighteen_threads','thirty_six_threads','sixty_four_threads','eighty_six_threads','one_hundred_eight_threads',
    'silicon_body','carbon_fiber_body','titanium_body',
    'built_in_cooling','great_cooling','vapor_chamber_cooling','ultra_cooling',
    'simple_graphics_integration','advanced_graphics_integration',
    'basic_ai_integration','advanced_ai_integration',
    'basic_v_cache','advanced_v_cache','basic_3d_v_cache','advanced_3d_v_cache',
    -- GPU
    'gpu_metallic_body','gpu_carbon_body','gpu_rgb',
    'gpu_small_fans','gpu_medium_fans','gpu_smart_fans',
    'gpu_backplate_solid','gpu_backplate_expanded',
    -- GPU Chip
    'chip_ok_speed','chip_decent_speed','chip_good_speed','chip_fast_speed','chip_insane_speed','chip_super_speed',
    'chip_decent_power','chip_good_power','chip_strong_power','chip_super_powerful',
    'chip_vram_1gb_simple','chip_vram_2gb_simple','chip_vram_4gb_simple','chip_vram_6gb_simple',
    'chip_vram_4gb_advanced','chip_vram_6gb_advanced','chip_vram_8gb_advanced',
    'chip_vram_12gb_advanced','chip_vram_16gb_advanced','chip_vram_32gb_advanced',
    'chip_custom_pcb_color','chip_emerald_pcb','chip_anti_crush_color','chip_copper_shim',
    -- PC Company
    'pc_rgb_case','pc_medium_case','pc_large_case',
    'pc_small_fans','pc_medium_fans','pc_smart_fans'
  ));

-- 4) Unified unlock_company_research RPC (GPU + CHIP + PC)
CREATE OR REPLACE FUNCTION public.unlock_company_research(
  p_company_id uuid,
  p_research_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_cash numeric;
  v_cost numeric;
  v_pre text := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT owner_id INTO v_owner
  FROM public.product_companies
  WHERE id = p_company_id;

  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'Not authorized for this company';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.product_company_research
    WHERE company_id = p_company_id AND research_key = p_research_key
  ) THEN
    SELECT cash INTO v_cash FROM public.profiles WHERE id = v_uid;
    RETURN jsonb_build_object('already_unlocked', true, 'cost', 0, 'cash_remaining', COALESCE(v_cash, 0));
  END IF;

  CASE p_research_key
    -- GPU
    WHEN 'gpu_metallic_body' THEN v_cost := 650;
    WHEN 'gpu_carbon_body' THEN v_cost := 4500; v_pre := 'gpu_metallic_body';
    WHEN 'gpu_rgb' THEN v_cost := 1400;
    WHEN 'gpu_small_fans' THEN v_cost := 450;
    WHEN 'gpu_medium_fans' THEN v_cost := 1800; v_pre := 'gpu_small_fans';
    WHEN 'gpu_smart_fans' THEN v_cost := 8000; v_pre := 'gpu_medium_fans';
    WHEN 'gpu_backplate_solid' THEN v_cost := 600;
    WHEN 'gpu_backplate_expanded' THEN v_cost := 1200; v_pre := 'gpu_backplate_solid';
    -- CHIP
    WHEN 'chip_ok_speed' THEN v_cost := 200;
    WHEN 'chip_decent_speed' THEN v_cost := 550; v_pre := 'chip_ok_speed';
    WHEN 'chip_good_speed' THEN v_cost := 1200; v_pre := 'chip_decent_speed';
    WHEN 'chip_fast_speed' THEN v_cost := 2800; v_pre := 'chip_good_speed';
    WHEN 'chip_insane_speed' THEN v_cost := 6000; v_pre := 'chip_fast_speed';
    WHEN 'chip_super_speed' THEN v_cost := 12000; v_pre := 'chip_insane_speed';
    WHEN 'chip_decent_power' THEN v_cost := 400;
    WHEN 'chip_good_power' THEN v_cost := 1100; v_pre := 'chip_decent_power';
    WHEN 'chip_strong_power' THEN v_cost := 3000; v_pre := 'chip_good_power';
    WHEN 'chip_super_powerful' THEN v_cost := 7500; v_pre := 'chip_strong_power';
    WHEN 'chip_vram_1gb_simple' THEN v_cost := 200;
    WHEN 'chip_vram_2gb_simple' THEN v_cost := 450; v_pre := 'chip_vram_1gb_simple';
    WHEN 'chip_vram_4gb_simple' THEN v_cost := 950; v_pre := 'chip_vram_2gb_simple';
    WHEN 'chip_vram_6gb_simple' THEN v_cost := 1800; v_pre := 'chip_vram_4gb_simple';
    WHEN 'chip_vram_4gb_advanced' THEN v_cost := 1400;
    WHEN 'chip_vram_6gb_advanced' THEN v_cost := 2600; v_pre := 'chip_vram_4gb_advanced';
    WHEN 'chip_vram_8gb_advanced' THEN v_cost := 4200; v_pre := 'chip_vram_6gb_advanced';
    WHEN 'chip_vram_12gb_advanced' THEN v_cost := 7000; v_pre := 'chip_vram_8gb_advanced';
    WHEN 'chip_vram_16gb_advanced' THEN v_cost := 11500; v_pre := 'chip_vram_12gb_advanced';
    WHEN 'chip_vram_32gb_advanced' THEN v_cost := 19000; v_pre := 'chip_vram_16gb_advanced';
    WHEN 'chip_custom_pcb_color' THEN v_cost := 125;
    WHEN 'chip_emerald_pcb' THEN v_cost := 125; v_pre := 'chip_custom_pcb_color';
    WHEN 'chip_anti_crush_color' THEN v_cost := 125;
    WHEN 'chip_copper_shim' THEN v_cost := 125; v_pre := 'chip_anti_crush_color';
    -- PC Company
    WHEN 'pc_rgb_case' THEN v_cost := 500;
    WHEN 'pc_medium_case' THEN v_cost := 600;
    WHEN 'pc_large_case' THEN v_cost := 2800; v_pre := 'pc_medium_case';
    WHEN 'pc_small_fans' THEN v_cost := 225;
    WHEN 'pc_medium_fans' THEN v_cost := 600; v_pre := 'pc_small_fans';
    WHEN 'pc_smart_fans' THEN v_cost := 1800; v_pre := 'pc_medium_fans';
    ELSE
      RAISE EXCEPTION 'Unknown research upgrade: %', p_research_key;
  END CASE;

  IF v_pre IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.product_company_research
    WHERE company_id = p_company_id AND research_key = v_pre
  ) THEN
    RAISE EXCEPTION 'Prerequisite % required first', v_pre;
  END IF;

  SELECT cash INTO v_cash FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF COALESCE(v_cash, 0) < v_cost THEN
    RAISE EXCEPTION 'Not enough cash ($% required)', v_cost;
  END IF;

  INSERT INTO public.product_company_research (company_id, owner_id, research_key)
  VALUES (p_company_id, v_uid, p_research_key);

  UPDATE public.profiles
  SET cash = ROUND((COALESCE(cash, 0) - v_cost)::numeric, 2)
  WHERE id = v_uid
  RETURNING cash INTO v_cash;

  UPDATE public.product_companies
  SET total_costs = COALESCE(total_costs, 0) + v_cost
  WHERE id = p_company_id;

  RETURN jsonb_build_object('cost', v_cost, 'cash_remaining', v_cash);
END;
$$;

-- 5) Save / Edit PC Draft RPC
CREATE OR REPLACE FUNCTION public.save_pc_product_draft(
  p_product_id uuid,
  p_company_id uuid,
  p_product_name text,
  p_body_type text,
  p_production_cost numeric,
  p_product_value numeric,
  p_listed_price numeric,
  p_design_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_row public.product_company_products;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT owner_id INTO v_owner
  FROM public.product_companies
  WHERE id = p_company_id;

  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'Not authorized for this company';
  END IF;

  IF p_product_id IS NOT NULL THEN
    UPDATE public.product_company_products
    SET product_name = p_product_name,
        body_type = COALESCE(p_body_type, 'small'),
        production_cost = GREATEST(0, COALESCE(p_production_cost, 0)),
        product_value = GREATEST(0, COALESCE(p_product_value, 0)),
        listed_price = GREATEST(1, COALESCE(p_listed_price, 1)),
        design_data = COALESCE(p_design_data, '{}'::jsonb)
    WHERE id = p_product_id
      AND company_id = p_company_id
      AND owner_id = v_uid
      AND status = 'draft'
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Draft PC not found or already published';
    END IF;
  ELSE
    INSERT INTO public.product_company_products (
      company_id, owner_id, product_line, product_name, body_type,
      production_cost, product_value, listed_price,
      cpu_score, cpu_tier, stock, status, design_data
    ) VALUES (
      p_company_id, v_uid, 'pc', p_product_name, COALESCE(p_body_type, 'small'),
      GREATEST(0, COALESCE(p_production_cost, 0)),
      GREATEST(0, COALESCE(p_product_value, 0)),
      GREATEST(1, COALESCE(p_listed_price, 1)),
      0, 'F', 0, 'draft', COALESCE(p_design_data, '{}'::jsonb)
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

-- 6) Produce PC Units + Pay Component Maker Companies RPC
CREATE OR REPLACE FUNCTION public.produce_pc_product(
  p_product_id uuid,
  p_quantity integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_pc public.product_company_products;
  v_case_cost numeric := 0;
  v_parts_cost numeric := 0;
  v_unit_cost numeric := 0;
  v_total_cost numeric := 0;
  v_buyer_cash numeric := 0;
  v_part_id uuid;
  v_part record;
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

  -- Compute live prices from every component referenced in design_data->'component_ids'
  IF jsonb_typeof(v_pc.design_data->'component_ids') = 'array' THEN
    FOR v_part_id IN
      SELECT (elem #>> '{}')::uuid
      FROM jsonb_array_elements(v_pc.design_data->'component_ids') AS elem
      WHERE (elem #>> '{}') ~ '^[0-9a-fA-F-]{36}$'
    LOOP
      SELECT p.id, p.product_name, p.company_id, p.owner_id, p.listed_price, c.company_name
      INTO v_part
      FROM public.product_company_products p
      JOIN public.product_companies c ON c.id = p.company_id
      WHERE p.id = v_part_id;

      IF v_part.id IS NOT NULL THEN
        v_parts_cost := v_parts_cost + GREATEST(0, COALESCE(v_part.listed_price, 0));
      END IF;
    END LOOP;
  END IF;

  v_unit_cost := v_case_cost + v_parts_cost;
  IF v_unit_cost <= 0 THEN
    v_unit_cost := GREATEST(0, COALESCE(v_pc.product_value, v_pc.production_cost, 0));
  END IF;

  v_total_cost := ROUND((v_unit_cost * v_qty)::numeric, 2);

  SELECT cash INTO v_buyer_cash FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF COALESCE(v_buyer_cash, 0) < v_total_cost THEN
    RAISE EXCEPTION 'Not enough cash ($% required to produce %)', v_total_cost, v_qty;
  END IF;

  -- Deduct PC build cost from producing player's cash
  UPDATE public.profiles
  SET cash = ROUND((COALESCE(cash, 0) - v_total_cost)::numeric, 2)
  WHERE id = v_uid
  RETURNING cash INTO v_buyer_cash;

  -- Credit every included component maker company & owner + record sale
  IF jsonb_typeof(v_pc.design_data->'component_ids') = 'array' THEN
    FOR v_part_id IN
      SELECT (elem #>> '{}')::uuid
      FROM jsonb_array_elements(v_pc.design_data->'component_ids') AS elem
      WHERE (elem #>> '{}') ~ '^[0-9a-fA-F-]{36}$'
    LOOP
      SELECT p.id, p.product_name, p.company_id, p.owner_id, p.listed_price, c.company_name
      INTO v_part
      FROM public.product_company_products p
      JOIN public.product_companies c ON c.id = p.company_id
      WHERE p.id = v_part_id
      FOR UPDATE OF p;

      IF v_part.id IS NOT NULL THEN
        v_part_payout := ROUND((GREATEST(0, COALESCE(v_part.listed_price, 0)) * v_qty)::numeric, 2);

        IF v_part_payout > 0 THEN
          UPDATE public.profiles
          SET cash = ROUND((COALESCE(cash, 0) + v_part_payout)::numeric, 2)
          WHERE id = v_part.owner_id;

          UPDATE public.product_companies
          SET total_revenue = COALESCE(total_revenue, 0) + v_part_payout
          WHERE id = v_part.company_id;
        END IF;

        UPDATE public.product_company_products
        SET purchase_count = COALESCE(purchase_count, 0) + v_qty,
            stock = GREATEST(0, COALESCE(stock, 0) - v_qty)
        WHERE id = v_part.id;

        v_payouts := v_payouts || jsonb_build_object(
          'product_id', v_part.id,
          'product_name', v_part.product_name,
          'company_name', v_part.company_name,
          'payout', v_part_payout
        );
      END IF;
    END LOOP;
  END IF;

  -- Update PC stock & builder company total_costs
  UPDATE public.product_company_products
  SET stock = COALESCE(stock, 0) + v_qty
  WHERE id = v_pc.id
  RETURNING stock INTO v_pc.stock;

  UPDATE public.product_companies
  SET total_costs = COALESCE(total_costs, 0) + v_total_cost
  WHERE id = v_pc.company_id;

  -- Refresh buyer cash in case any own component was paid back to self
  SELECT cash INTO v_buyer_cash FROM public.profiles WHERE id = v_uid;

  RETURN jsonb_build_object(
    'stock', v_pc.stock,
    'quantity_added', v_qty,
    'total_cost', v_total_cost,
    'cash_remaining', v_buyer_cash,
    'payouts', v_payouts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlock_company_research(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_pc_product_draft(uuid, uuid, text, text, numeric, numeric, numeric, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.produce_pc_product(uuid, integer) TO authenticated;

