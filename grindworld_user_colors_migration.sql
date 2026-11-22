-- GrindWorld account colors and hex territory background
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_color text NOT NULL DEFAULT '#a78bfa';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_user_color_hex_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_user_color_hex_check
      CHECK (user_color ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END $$;
