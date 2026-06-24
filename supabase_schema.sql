-- =====================================================================
-- SUPABASE / POSTGRESQL SCHEMA FOR AVN GAME TRACKER
-- =====================================================================
-- Copy and paste this script into the Supabase SQL Editor (SQL Editor -> New Query -> Run)
-- to initialize all required tables, triggers, and Row Level Security (RLS) policies.

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
-- 1. Table: Config (System Settings)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Seed Initial Default Config
INSERT INTO public.config (key, value) VALUES
('webTitle', 'AVN Star Hub'),
('webMetaDescription', 'พอร์ทัลแนะนำและบันทึกคลังเกมของคุณ'),
('webTagline', 'ติดตาม รวบรวม และจัดการคลังเกมของคุณในที่เดียว'),
('webLogo', '👑'),
('webLogoType', 'emoji'),
('promptPayId', '0812345678'),
('slipOkApiKey', ''),
('slipOkBranchId', '')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Table: Profiles (Extends Supabase Auth users)
-- ---------------------------------------------------------------------
-- Supabase manages users inside the `auth.users` schema.
-- We create a `public.profiles` table linked to `auth.users` to save roles, signupDate, and expiryDate.
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    premium TEXT DEFAULT 'no' CHECK (premium IN ('yes', 'no')),
    admin TEXT DEFAULT 'no' CHECK (admin IN ('yes', 'no')),
    signup_date DATE DEFAULT CURRENT_DATE,
    expiry_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ---------------------------------------------------------------------
-- 3. Table: OfficialGames (Catalog)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.official_games (
    id TEXT PRIMARY KEY, -- 'eternum', 'being-a-dik', etc.
    title TEXT NOT NULL,
    developer TEXT NOT NULL,
    version TEXT NOT NULL,
    overview TEXT,
    cover_url TEXT,
    patreon_url TEXT,
    buy_url TEXT,
    social_url TEXT,
    rating NUMERIC DEFAULT 5.0,
    tags TEXT[], -- array of tags
    screenshots TEXT[], -- array of screenshot URLs
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ---------------------------------------------------------------------
-- 4. Table: Library (User Game Progress)
-- ---------------------------------------------------------------------
-- Saves game list progress per user. Unlike Sheets which stringified a JSON array,
-- in Supabase we save each library item as a separate structured row for maximum queries efficiency.
CREATE TABLE IF NOT EXISTS public.library (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    email TEXT NOT NULL,
    game_id TEXT NOT NULL,
    status TEXT DEFAULT 'วางแผนจะเล่น' NOT NULL,
    notes TEXT,
    play_time NUMERIC DEFAULT 0,
    rating NUMERIC DEFAULT 0,
    is_custom BOOLEAN DEFAULT false,
    -- Additional fields for custom games
    title TEXT,
    developer TEXT,
    version TEXT,
    cover_url TEXT,
    overview TEXT,
    patreon_url TEXT,
    buy_url TEXT,
    social_url TEXT,
    screenshots TEXT[],
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    UNIQUE(user_id, game_id)
);

-- ---------------------------------------------------------------------
-- 5. Table: Reports (Update/Error reports, suggestions)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reports (
    id TEXT PRIMARY KEY, -- 'rep-xxxx'
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email TEXT,
    type TEXT CHECK (type IN ('update', 'error', 'new')) NOT NULL,
    game_title TEXT,
    reported_version TEXT,
    description TEXT,
    changelog TEXT,
    developer_url TEXT,
    report_tags TEXT,
    error_status TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'ignored')),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ---------------------------------------------------------------------
-- 6. Table: Transactions (Premium Upgrades)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
    id TEXT PRIMARY KEY, -- 'tx-xxxx'
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    username TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    package_name TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
    slip_url TEXT,
    ref_no TEXT,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ---------------------------------------------------------------------
-- 7. Automatic Update Trigger function for profiles & public.users syncing
-- ---------------------------------------------------------------------
-- When a user registers in Supabase Auth, we want to automatically create a profile in public.profiles.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  -- Determine if user is main admin
  DECLARE
    is_admin_user text := 'no';
    is_premium_user text := 'no';
  BEGIN
    IF NEW.email = 'pattarasak.raksanarong@gmail.com' OR NEW.email = 'pattarasak.raksanrong@gmail.com' THEN
      is_admin_user := 'yes';
      is_premium_user := 'yes';
    END IF;

    INSERT INTO public.profiles (id, username, email, premium, admin, signup_date)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
      NEW.email,
      is_premium_user,
      is_admin_user,
      CURRENT_DATE
    );
    RETURN NEW;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users insert
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------
-- 8. Row Level Security (RLS) Policies
-- ---------------------------------------------------------------------
-- Supabase secures tables using RLS. Let's enable RLS on all tables.
ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Config Policies
CREATE POLICY "Allow read config to everyone" ON public.config FOR SELECT TO public USING (true);
CREATE POLICY "Allow write config to admins only" ON public.config FOR ALL TO authenticated 
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.admin = 'yes'));

-- Profiles Policies
CREATE POLICY "Allow read profiles to everyone" ON public.profiles FOR SELECT TO public USING (true);
CREATE POLICY "Allow update own profile" ON public.profiles FOR UPDATE TO authenticated 
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Allow all on profiles to admins" ON public.profiles FOR ALL TO authenticated 
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.admin = 'yes'));

-- Official Games Policies
CREATE POLICY "Allow read official games to everyone" ON public.official_games FOR SELECT TO public USING (true);
CREATE POLICY "Allow all on official games to admins" ON public.official_games FOR ALL TO authenticated 
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.admin = 'yes'));

-- Library Policies
CREATE POLICY "Allow read own library" ON public.library FOR SELECT TO authenticated 
  USING (auth.uid() = user_id);
CREATE POLICY "Allow insert own library" ON public.library FOR INSERT TO authenticated 
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Allow update own library" ON public.library FOR UPDATE TO authenticated 
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Allow delete own library" ON public.library FOR DELETE TO authenticated 
  USING (auth.uid() = user_id);
CREATE POLICY "Allow all on library to admins" ON public.library FOR ALL TO authenticated 
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.admin = 'yes'));

-- Reports Policies
CREATE POLICY "Allow read own reports" ON public.reports FOR SELECT TO authenticated 
  USING (auth.uid() = user_id);
CREATE POLICY "Allow insert reports to authenticated users" ON public.reports FOR INSERT TO authenticated 
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Allow all on reports to admins" ON public.reports FOR ALL TO authenticated 
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.admin = 'yes'));

-- Transactions Policies
CREATE POLICY "Allow read own transactions" ON public.transactions FOR SELECT TO authenticated 
  USING (auth.uid() = user_id);
CREATE POLICY "Allow insert transactions to authenticated users" ON public.transactions FOR INSERT TO authenticated 
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Allow all on transactions to admins" ON public.transactions FOR ALL TO authenticated 
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.admin = 'yes'));

-- ---------------------------------------------------------------------
-- 9. RPC Functions
-- ---------------------------------------------------------------------
-- Function to safely increment game view count via Supabase RPC
CREATE OR REPLACE FUNCTION public.increment_view_count(game_id TEXT)
RETURNS void AS $$
BEGIN
  UPDATE public.official_games
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------
-- 10. Table: Translated Games
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.translated_games (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    cover_url TEXT,
    version TEXT NOT NULL,
    description TEXT,
    download_pc TEXT,
    download_mobile TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.translated_games ENABLE ROW LEVEL SECURITY;

-- Translated Games Policies
CREATE POLICY "Allow read translated games to everyone" ON public.translated_games FOR SELECT TO public USING (true);
CREATE POLICY "Allow all on translated games to admins" ON public.translated_games FOR ALL TO authenticated 
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.admin = 'yes'));

