-- =====================================================================
-- GRIND-EA · PC Company + Company Stock Investing Migration
-- Run once in your Supabase SQL Editor
-- Includes:
--   A) Fixes product_companies.product_lines check constraint (adds 'pc')
--   B) PC Cases table + PC Research Keys + PC Draft & Producer Payout RPCs
--   C) Company Investing ("Companies" Stock Market):
--      - company_stocks, company_stock_holdings, company_stock_trades, company_stock_payouts
--      - Sales-driven price multiplier + gentle investor curve (STOCK_K = 0.002)
--      - buy_company_stock, sell_company_stock, claim_company_stock_payout (00:00 UTC daily owner payout)
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

-- 2) Dynamically drop any old CHECK constraints on product_lines, product_line, body_type, and research_key,
--    then recreate them with NOT VALID so existing rows never block the migration.
DO $$
DECLARE
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public'
      AND c.contype = 'c'
      AND (
        (cl.relname = 'product_companies' AND pg_get_constraintdef(c.oid) ILIKE '%product_lines%')
        OR (cl.relname = 'product_company_products' AND (
          pg_get_constraintdef(c.oid) ILIKE '%product_line%'
          OR pg_get_constraintdef(c.oid) ILIKE '%body_type%'
        ))
        OR (cl.relname = 'product_company_research' AND pg_get_constraintdef(c.oid) ILIKE '%research_key%')
      )
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', v_rec.tbl, v_rec.conname);
  END LOOP;
END $$;

ALTER TABLE public.product_companies
  ADD CONSTRAINT product_companies_product_lines_check
  CHECK (product_lines <@ ARRAY['cpu', 'gpu', 'pc', 'motherboard']::text[]) NOT VALID;

-- Allow infinite companies per owner, max 1 company per manufacturing type
DO $$
DECLARE
  v_idx record;
BEGIN
  -- Drop any unique constraint on product_companies(owner_id) only
  FOR v_idx IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class cl ON cl.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public'
      AND cl.relname = 'product_companies'
      AND c.contype = 'u'
      AND array_length(c.conkey, 1) = 1
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = cl.oid AND a.attnum = c.conkey[1] AND a.attname = 'owner_id'
      )
  LOOP
    EXECUTE format('ALTER TABLE public.product_companies DROP CONSTRAINT IF EXISTS %I', v_idx.conname);
  END LOOP;

  -- Drop any standalone unique index on product_companies(owner_id) only
  FOR v_idx IN
    SELECT i.relname AS idx_name
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class cl ON cl.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'public'
      AND cl.relname = 'product_companies'
      AND ix.indisunique
      AND NOT ix.indisprimary
      AND ix.indnkeyatts = 1
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = cl.oid AND a.attnum = ix.indkey[0] AND a.attname = 'owner_id'
      )
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', v_idx.idx_name);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_companies_owner_line
  ON public.product_companies (owner_id, (COALESCE(product_lines[1], 'cpu')));

ALTER TABLE public.product_company_products
  ADD CONSTRAINT product_company_products_product_line_check
  CHECK (product_line IN ('cpu', 'gpu', 'pc', 'motherboard')) NOT VALID;

ALTER TABLE public.product_company_products
  ADD CONSTRAINT product_company_products_body_type_check
  CHECK (body_type IS NULL OR body_type IN (
    'gray', 'silicon', 'carbon', 'carbon_fiber', 'titanium', 'standard', 'default', 'none',
    'plastic', 'metallic', 'custom',
    'small', 'medium', 'large'
  )) NOT VALID;

-- 3) Update research_key check constraint to allow CPU + GPU + CHIP + PC keys
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
    'pc_small_fans','pc_medium_fans','pc_smart_fans',
    -- Motherboard Company
    'mobo_medium_board','mobo_large_board',
    'mobo_ram_1','mobo_ram_2','mobo_ram_4','mobo_ram_6'
  )) NOT VALID;

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
    WHEN 'gpu_metallic_body' THEN v_cost := 3500;
    WHEN 'gpu_carbon_body' THEN v_cost := 7800; v_pre := 'gpu_metallic_body';
    WHEN 'gpu_rgb' THEN v_cost := 4800;
    WHEN 'gpu_small_fans' THEN v_cost := 125;
    WHEN 'gpu_medium_fans' THEN v_cost := 800; v_pre := 'gpu_small_fans';
    WHEN 'gpu_smart_fans' THEN v_cost := 2800; v_pre := 'gpu_medium_fans';
    WHEN 'gpu_backplate_solid' THEN v_cost := 600;
    WHEN 'gpu_backplate_expanded' THEN v_cost := 1200; v_pre := 'gpu_backplate_solid';
    -- CHIP
    WHEN 'chip_ok_speed' THEN v_cost := 75;
    WHEN 'chip_decent_speed' THEN v_cost := 150; v_pre := 'chip_ok_speed';
    WHEN 'chip_good_speed' THEN v_cost := 300; v_pre := 'chip_decent_speed';
    WHEN 'chip_fast_speed' THEN v_cost := 650; v_pre := 'chip_good_speed';
    WHEN 'chip_insane_speed' THEN v_cost := 1500; v_pre := 'chip_fast_speed';
    WHEN 'chip_super_speed' THEN v_cost := 4500; v_pre := 'chip_insane_speed';
    WHEN 'chip_decent_power' THEN v_cost := 250;
    WHEN 'chip_good_power' THEN v_cost := 800; v_pre := 'chip_decent_power';
    WHEN 'chip_strong_power' THEN v_cost := 2600; v_pre := 'chip_good_power';
    WHEN 'chip_super_powerful' THEN v_cost := 6800; v_pre := 'chip_strong_power';
    WHEN 'chip_vram_1gb_simple' THEN v_cost := 80;
    WHEN 'chip_vram_2gb_simple' THEN v_cost := 190; v_pre := 'chip_vram_1gb_simple';
    WHEN 'chip_vram_4gb_simple' THEN v_cost := 450; v_pre := 'chip_vram_2gb_simple';
    WHEN 'chip_vram_6gb_simple' THEN v_cost := 1800; v_pre := 'chip_vram_4gb_simple';
    WHEN 'chip_vram_4gb_advanced' THEN v_cost := 2600; v_pre := 'chip_vram_6gb_simple';
    WHEN 'chip_vram_6gb_advanced' THEN v_cost := 3600; v_pre := 'chip_vram_4gb_advanced';
    WHEN 'chip_vram_8gb_advanced' THEN v_cost := 5400; v_pre := 'chip_vram_6gb_advanced';
    WHEN 'chip_vram_12gb_advanced' THEN v_cost := 8600; v_pre := 'chip_vram_8gb_advanced';
    WHEN 'chip_vram_16gb_advanced' THEN v_cost := 9800; v_pre := 'chip_vram_12gb_advanced';
    WHEN 'chip_vram_32gb_advanced' THEN v_cost := 12800; v_pre := 'chip_vram_16gb_advanced';
    WHEN 'chip_custom_pcb_color' THEN v_cost := 125;
    WHEN 'chip_emerald_pcb' THEN v_cost := 250; v_pre := 'chip_custom_pcb_color';
    WHEN 'chip_anti_crush_color' THEN v_cost := 125;
    WHEN 'chip_copper_shim' THEN v_cost := 250; v_pre := 'chip_anti_crush_color';
    -- PC Company
    WHEN 'pc_rgb_case' THEN v_cost := 500;
    WHEN 'pc_medium_case' THEN v_cost := 600;
    WHEN 'pc_large_case' THEN v_cost := 2800; v_pre := 'pc_medium_case';
    WHEN 'pc_small_fans' THEN v_cost := 225;
    WHEN 'pc_medium_fans' THEN v_cost := 600; v_pre := 'pc_small_fans';
    WHEN 'pc_smart_fans' THEN v_cost := 1800; v_pre := 'pc_medium_fans';
    -- Motherboard Company
    WHEN 'mobo_medium_board' THEN v_cost := 75;
    WHEN 'mobo_large_board' THEN v_cost := 150; v_pre := 'mobo_medium_board';
    WHEN 'mobo_ram_1' THEN v_cost := 200;
    WHEN 'mobo_ram_2' THEN v_cost := 280; v_pre := 'mobo_ram_1';
    WHEN 'mobo_ram_4' THEN v_cost := 680; v_pre := 'mobo_ram_2';
    WHEN 'mobo_ram_6' THEN v_cost := 1200; v_pre := 'mobo_ram_4';
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

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'product_company_research'
      AND column_name = 'owner_id'
  ) THEN
    EXECUTE 'INSERT INTO public.product_company_research (company_id, owner_id, research_key) VALUES ($1, $2, $3)'
      USING p_company_id, v_uid, p_research_key;
  ELSE
    INSERT INTO public.product_company_research (company_id, research_key)
    VALUES (p_company_id, p_research_key);
  END IF;

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
      AND status IN ('draft', 'published')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'PC product not found or unauthorized';
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

-- 5B) Save / Edit Motherboard Draft RPC
CREATE OR REPLACE FUNCTION public.save_mobo_product_draft(
  p_product_id uuid,
  p_company_id uuid,
  p_product_name text,
  p_body_type text,
  p_production_cost numeric,
  p_product_value numeric,
  p_listed_price numeric,
  p_score integer,
  p_tier text,
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
        cpu_score = GREATEST(0, COALESCE(p_score, 0)),
        cpu_tier = COALESCE(p_tier, 'F'),
        design_data = COALESCE(p_design_data, '{}'::jsonb)
    WHERE id = p_product_id
      AND company_id = p_company_id
      AND owner_id = v_uid
      AND status IN ('draft', 'published')
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'Motherboard product not found or unauthorized';
    END IF;
  ELSE
    INSERT INTO public.product_company_products (
      company_id, owner_id, product_line, product_name, body_type,
      production_cost, product_value, listed_price,
      cpu_score, cpu_tier, stock, status, design_data
    ) VALUES (
      p_company_id, v_uid, 'motherboard', p_product_name, COALESCE(p_body_type, 'small'),
      GREATEST(0, COALESCE(p_production_cost, 0)),
      GREATEST(0, COALESCE(p_product_value, 0)),
      GREATEST(1, COALESCE(p_listed_price, 1)),
      GREATEST(0, COALESCE(p_score, 0)), COALESCE(p_tier, 'F'), 0, 'draft', COALESCE(p_design_data, '{}'::jsonb)
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

-- 6) Produce PC Units + Validate & Deduct Component Stock + Pay Component Maker Companies RPC
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

  -- Pass 1: Aggregate component IDs (from component_ids array or components.cpu/gpu fallback),
  -- lock component rows FOR UPDATE, validate published status & sufficient stock, and compute parts cost.
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
      SELECT (v_pc.design_data->'components'->'motherboard'->>'id')::uuid AS part_id
      WHERE jsonb_typeof(v_pc.design_data->'component_ids') IS DISTINCT FROM 'array'
        AND COALESCE(v_pc.design_data->'components'->'motherboard'->>'id', '') ~ '^[0-9a-fA-F-]{36}$'
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

  -- Pass 2: Deduct component stock, increment purchase_count, and pay component makers.
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
      SELECT (v_pc.design_data->'components'->'motherboard'->>'id')::uuid AS part_id
      WHERE jsonb_typeof(v_pc.design_data->'component_ids') IS DISTINCT FROM 'array'
        AND COALESCE(v_pc.design_data->'components'->'motherboard'->>'id', '') ~ '^[0-9a-fA-F-]{36}$'
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
$$;

-- =====================================================================
-- 7) COMPANY STOCK MARKET ("Companies" Feed + 00:00 Daily Owner Payouts)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.company_stocks (
  company_id uuid PRIMARY KEY REFERENCES public.product_companies(id) ON DELETE CASCADE,
  curve_price numeric NOT NULL DEFAULT 1.00,
  open_price_today numeric NOT NULL DEFAULT 1.00,
  open_price_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
  last_payout_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date),
  last_payout_amount numeric NOT NULL DEFAULT 0,
  total_stock_payouts numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_stock_holdings (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.product_companies(id) ON DELETE CASCADE,
  shares numeric NOT NULL DEFAULT 0,
  total_spent_usd numeric NOT NULL DEFAULT 0,
  total_returned_usd numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS public.company_stock_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.product_companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('buy', 'sell', 'sales')),
  amount_usd numeric NOT NULL DEFAULT 0,
  shares numeric NOT NULL DEFAULT 0,
  price_after numeric NOT NULL DEFAULT 1.00,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_stock_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.product_companies(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payout_date date NOT NULL,
  owned_stock_usd numeric NOT NULL DEFAULT 0,
  payout_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, payout_date)
);

CREATE INDEX IF NOT EXISTS idx_company_stock_trades_company_time
  ON public.company_stock_trades (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_company_stock_payouts_company_date
  ON public.company_stock_payouts (company_id, payout_date DESC);

ALTER TABLE public.company_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_stock_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_stock_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_stock_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_stocks_select_all" ON public.company_stocks;
CREATE POLICY "company_stocks_select_all"
  ON public.company_stocks FOR SELECT USING (true);

DROP POLICY IF EXISTS "company_stock_holdings_select_all" ON public.company_stock_holdings;
CREATE POLICY "company_stock_holdings_select_all"
  ON public.company_stock_holdings FOR SELECT USING (true);

DROP POLICY IF EXISTS "company_stock_trades_select_all" ON public.company_stock_trades;
CREATE POLICY "company_stock_trades_select_all"
  ON public.company_stock_trades FOR SELECT USING (true);

DROP POLICY IF EXISTS "company_stock_payouts_select_all" ON public.company_stock_payouts;
CREATE POLICY "company_stock_payouts_select_all"
  ON public.company_stock_payouts FOR SELECT USING (true);

-- Sales/revenue multiplier: sales drive share prices up cleanly while investor impact stays 4x softer than Coins
CREATE OR REPLACE FUNCTION public.calc_company_sales_multiplier(p_revenue numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 1.00 + GREATEST(0, COALESCE(p_revenue, 0)) * 0.0025;
$$;

-- Trigger to auto-create stock rows for new companies & log sales milestones onto the stock chart
CREATE OR REPLACE FUNCTION public.trg_sync_company_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_curve numeric := 1.00;
  v_price numeric := 1.00;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.company_stocks (company_id, curve_price, open_price_today, open_price_date, last_payout_date)
    VALUES (NEW.id, 1.00, 1.00, v_today, v_today)
    ON CONFLICT (company_id) DO NOTHING;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(NEW.total_revenue, 0) > COALESCE(OLD.total_revenue, 0) THEN
    INSERT INTO public.company_stocks (company_id, curve_price, open_price_today, open_price_date, last_payout_date)
    VALUES (NEW.id, 1.00, 1.00, v_today, v_today)
    ON CONFLICT (company_id) DO NOTHING;

    SELECT curve_price INTO v_curve FROM public.company_stocks WHERE company_id = NEW.id;
    v_price := ROUND((COALESCE(v_curve, 1.00) * public.calc_company_sales_multiplier(NEW.total_revenue))::numeric, 4);

    INSERT INTO public.company_stock_trades (company_id, user_id, type, amount_usd, shares, price_after)
    VALUES (NEW.id, NEW.owner_id, 'sales', ROUND((NEW.total_revenue - OLD.total_revenue)::numeric, 2), 0, v_price);

    UPDATE public.company_stocks SET updated_at = now() WHERE company_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_companies_stock_sync ON public.product_companies;
CREATE TRIGGER trg_product_companies_stock_sync
  AFTER INSERT OR UPDATE OF total_revenue ON public.product_companies
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_company_stock();

-- Backfill stock rows for existing companies
INSERT INTO public.company_stocks (company_id, curve_price, open_price_today, open_price_date, last_payout_date)
SELECT id, 1.00, ROUND(public.calc_company_sales_multiplier(total_revenue)::numeric, 4), (now() AT TIME ZONE 'UTC')::date, (now() AT TIME ZONE 'UTC')::date
FROM public.product_companies
ON CONFLICT (company_id) DO NOTHING;

-- Buy Company Stock RPC (STOCK_K = 0.002 — 4x gentler trade price swing than Coins)
CREATE OR REPLACE FUNCTION public.buy_company_stock(
  p_company_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_amt numeric := ROUND(COALESCE(p_amount, 0)::numeric, 2);
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_comp record;
  v_stock public.company_stocks;
  v_mult numeric;
  v_old_price numeric;
  v_curve_delta numeric;
  v_new_curve numeric;
  v_shares numeric;
  v_new_price numeric;
  v_cash numeric;
  v_owned_usd numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF v_amt < 0.01 THEN
    RAISE EXCEPTION 'Minimum investment is $0.01';
  END IF;

  SELECT id, owner_id, company_name, total_revenue
  INTO v_comp
  FROM public.product_companies
  WHERE id = p_company_id;

  IF v_comp.id IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;
  IF v_comp.owner_id = v_uid THEN
    RAISE EXCEPTION 'Company owners cannot buy their own stock. Grow sales to attract investors!';
  END IF;

  SELECT cash INTO v_cash FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF COALESCE(v_cash, 0) < v_amt THEN
    RAISE EXCEPTION 'Not enough cash';
  END IF;

  INSERT INTO public.company_stocks (company_id, curve_price, open_price_today, open_price_date, last_payout_date)
  VALUES (p_company_id, 1.00, 1.00, v_today, v_today)
  ON CONFLICT (company_id) DO NOTHING;

  SELECT * INTO v_stock FROM public.company_stocks WHERE company_id = p_company_id FOR UPDATE;

  v_mult := public.calc_company_sales_multiplier(v_comp.total_revenue);
  v_old_price := GREATEST(0.01, v_stock.curve_price * v_mult);
  IF v_stock.open_price_date < v_today THEN
    v_stock.open_price_today := v_old_price;
    v_stock.open_price_date := v_today;
  END IF;

  -- STOCK_K = 0.002
  v_curve_delta := (v_amt / v_mult) * 0.002;
  v_new_curve := v_stock.curve_price + v_curve_delta;
  v_shares := ln(v_new_curve / v_stock.curve_price) / 0.002;
  v_new_price := ROUND((v_new_curve * v_mult)::numeric, 4);
  v_owned_usd := ROUND((((v_new_curve - 1.0) / 0.002) * v_mult)::numeric, 2);

  UPDATE public.profiles
  SET cash = ROUND((COALESCE(cash, 0) - v_amt)::numeric, 2)
  WHERE id = v_uid
  RETURNING cash INTO v_cash;

  UPDATE public.company_stocks
  SET curve_price = v_new_curve,
      open_price_today = v_stock.open_price_today,
      open_price_date = v_stock.open_price_date,
      updated_at = now()
  WHERE company_id = p_company_id;

  INSERT INTO public.company_stock_holdings (user_id, company_id, shares, total_spent_usd, updated_at)
  VALUES (v_uid, p_company_id, v_shares, v_amt, now())
  ON CONFLICT (user_id, company_id) DO UPDATE
  SET shares = public.company_stock_holdings.shares + v_shares,
      total_spent_usd = public.company_stock_holdings.total_spent_usd + v_amt,
      updated_at = now();

  INSERT INTO public.company_stock_trades (company_id, user_id, type, amount_usd, shares, price_after)
  VALUES (p_company_id, v_uid, 'buy', v_amt, v_shares, v_new_price);

  RETURN jsonb_build_object(
    'new_price', v_new_price,
    'curve_price', v_new_curve,
    'shares_bought', v_shares,
    'cash_remaining', v_cash,
    'owned_stock_usd', v_owned_usd
  );
END;
$$;

-- Sell Company Stock RPC
CREATE OR REPLACE FUNCTION public.sell_company_stock(
  p_company_id uuid,
  p_shares numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_comp record;
  v_stock public.company_stocks;
  v_hold public.company_stock_holdings;
  v_sell_shares numeric;
  v_mult numeric;
  v_old_price numeric;
  v_new_curve numeric;
  v_raw_proceeds numeric;
  v_proceeds numeric;
  v_new_price numeric;
  v_remaining numeric;
  v_cash numeric;
  v_owned_usd numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF COALESCE(p_shares, 0) <= 0 THEN
    RAISE EXCEPTION 'No shares to sell';
  END IF;

  SELECT id, owner_id, company_name, total_revenue
  INTO v_comp
  FROM public.product_companies
  WHERE id = p_company_id;

  IF v_comp.id IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  SELECT * INTO v_stock FROM public.company_stocks WHERE company_id = p_company_id FOR UPDATE;
  SELECT * INTO v_hold FROM public.company_stock_holdings
  WHERE user_id = v_uid AND company_id = p_company_id FOR UPDATE;

  IF v_stock.company_id IS NULL OR v_hold.user_id IS NULL OR COALESCE(v_hold.shares, 0) <= 0 THEN
    RAISE EXCEPTION 'You do not own shares in this company';
  END IF;

  v_sell_shares := LEAST(p_shares, v_hold.shares);
  v_mult := public.calc_company_sales_multiplier(v_comp.total_revenue);
  v_old_price := GREATEST(0.01, v_stock.curve_price * v_mult);
  IF v_stock.open_price_date < v_today THEN
    v_stock.open_price_today := v_old_price;
    v_stock.open_price_date := v_today;
  END IF;

  v_new_curve := GREATEST(1.00, v_stock.curve_price * exp(-0.002 * v_sell_shares));
  v_raw_proceeds := GREATEST(0, (v_stock.curve_price - v_new_curve) / 0.002) * v_mult;
  v_proceeds := FLOOR((v_raw_proceeds + 0.000000001) * 100) / 100;
  v_new_price := ROUND((v_new_curve * v_mult)::numeric, 4);
  v_remaining := CASE WHEN (v_hold.shares - v_sell_shares) < 0.00000001 THEN 0 ELSE (v_hold.shares - v_sell_shares) END;
  v_owned_usd := ROUND((((v_new_curve - 1.0) / 0.002) * v_mult)::numeric, 2);

  UPDATE public.profiles
  SET cash = ROUND((COALESCE(cash, 0) + v_proceeds)::numeric, 2)
  WHERE id = v_uid
  RETURNING cash INTO v_cash;

  UPDATE public.company_stocks
  SET curve_price = v_new_curve,
      open_price_today = v_stock.open_price_today,
      open_price_date = v_stock.open_price_date,
      updated_at = now()
  WHERE company_id = p_company_id;

  UPDATE public.company_stock_holdings
  SET shares = v_remaining,
      total_returned_usd = public.company_stock_holdings.total_returned_usd + v_proceeds,
      updated_at = now()
  WHERE user_id = v_uid AND company_id = p_company_id;

  INSERT INTO public.company_stock_trades (company_id, user_id, type, amount_usd, shares, price_after)
  VALUES (p_company_id, v_uid, 'sell', v_proceeds, v_sell_shares, v_new_price);

  RETURN jsonb_build_object(
    'new_price', v_new_price,
    'curve_price', v_new_curve,
    'proceeds', v_proceeds,
    'remaining_shares', v_remaining,
    'cash_remaining', v_cash,
    'owned_stock_usd', v_owned_usd
  );
END;
$$;

-- Daily 00:00 UTC Owner Payout RPC: pays company owner the stock's current worth (share price) every day
CREATE OR REPLACE FUNCTION public.claim_company_stock_payout(
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'UTC')::date;
  v_comp record;
  v_stock public.company_stocks;
  v_mult numeric;
  v_owned_usd numeric := 0;
  v_stock_worth numeric := 0;
  v_cash numeric := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, owner_id, company_name, total_revenue
  INTO v_comp
  FROM public.product_companies
  WHERE id = p_company_id;

  IF v_comp.id IS NULL OR v_comp.owner_id <> v_uid THEN
    RAISE EXCEPTION 'Not authorized for this company';
  END IF;

  INSERT INTO public.company_stocks (company_id, curve_price, open_price_today, open_price_date, last_payout_date)
  VALUES (p_company_id, 1.00, 1.00, v_today, v_today)
  ON CONFLICT (company_id) DO NOTHING;

  SELECT * INTO v_stock FROM public.company_stocks WHERE company_id = p_company_id FOR UPDATE;
  v_mult := public.calc_company_sales_multiplier(v_comp.total_revenue);
  v_owned_usd := ROUND((GREATEST(0, (v_stock.curve_price - 1.0) / 0.002) * v_mult)::numeric, 2);
  v_stock_worth := ROUND((GREATEST(0.01, v_stock.curve_price * v_mult))::numeric, 2);

  IF v_stock.last_payout_date >= v_today THEN
    SELECT cash INTO v_cash FROM public.profiles WHERE id = v_uid;
    RETURN jsonb_build_object(
      'claimed', false,
      'already_claimed', true,
      'payout_amount', 0,
      'next_payout_estimate', v_stock_worth,
      'owned_stock_usd', v_owned_usd,
      'cash_remaining', COALESCE(v_cash, 0)
    );
  END IF;

  IF v_stock_worth > 0 THEN
    UPDATE public.profiles
    SET cash = ROUND((COALESCE(cash, 0) + v_stock_worth)::numeric, 2)
    WHERE id = v_uid
    RETURNING cash INTO v_cash;

    INSERT INTO public.company_stock_payouts (company_id, owner_id, payout_date, owned_stock_usd, payout_amount)
    VALUES (p_company_id, v_uid, v_today, v_owned_usd, v_stock_worth)
    ON CONFLICT (company_id, payout_date) DO NOTHING;
  ELSE
    SELECT cash INTO v_cash FROM public.profiles WHERE id = v_uid;
  END IF;

  UPDATE public.company_stocks
  SET last_payout_date = v_today,
      last_payout_amount = v_stock_worth,
      total_stock_payouts = COALESCE(total_stock_payouts, 0) + v_stock_worth,
      open_price_today = ROUND((v_stock.curve_price * v_mult)::numeric, 4),
      open_price_date = v_today,
      updated_at = now()
  WHERE company_id = p_company_id;

  RETURN jsonb_build_object(
    'claimed', v_stock_worth > 0,
    'already_claimed', false,
    'payout_amount', v_stock_worth,
    'next_payout_estimate', v_stock_worth,
    'owned_stock_usd', v_owned_usd,
    'cash_remaining', COALESCE(v_cash, 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.unlock_company_research(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_pc_product_draft(uuid, uuid, text, text, numeric, numeric, numeric, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_mobo_product_draft(uuid, uuid, text, text, numeric, numeric, numeric, integer, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.produce_pc_product(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buy_company_stock(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sell_company_stock(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_company_stock_payout(uuid) TO authenticated;
