-- =====================================================================
-- SUPABASE NUKE & PAVE MASTER SQL SCRIPT (JSONB LIBRARY VERSION)
-- =====================================================================
-- คำเตือน: สคริปต์นี้จะลบตารางทั้งหมดใน public schema และสร้างใหม่ทั้งหมด
-- นำโค้ดนี้ไปรันใน Supabase SQL Editor (SQL Editor -> New Query -> Run)
-- เพื่อเริ่มต้นโครงสร้างฐานข้อมูลใหม่ที่เสถียรและตรงตามโค้ด Frontend แบบ 1 แถวต่อคน (JSONB)

-- 1. ล้างตารางและฟังก์ชันเก่าทั้งหมด
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- 2. คืนสิทธิ์การเข้าถึงพื้นฐานของ Supabase API และบทบาทต่างๆ
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO anon;
GRANT ALL ON SCHEMA public TO authenticated;
GRANT ALL ON SCHEMA public TO service_role;

-- 3. เปิดใช้งานส่วนขยาย UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 4. ตาราง profiles (ข้อมูลผู้ใช้)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT,
    email TEXT UNIQUE NOT NULL,
    premium TEXT DEFAULT 'no' CHECK (premium IN ('yes', 'no')),
    admin TEXT DEFAULT 'no' CHECK (admin IN ('yes', 'no')),
    signup_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    expiry_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. ตาราง official_games (แค็ตตาล็อกเกมหลัก)
CREATE TABLE public.official_games (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    developer TEXT,
    version TEXT,
    overview TEXT,
    cover_url TEXT,
    patreon_url TEXT,
    buy_url TEXT,
    social_url TEXT,
    rating NUMERIC DEFAULT 5.0,
    tags JSONB DEFAULT '[]'::jsonb,
    screenshots JSONB DEFAULT '[]'::jsonb,
    view_count INTEGER DEFAULT 0,
    is_custom BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 6. ตาราง library (คลังเกมส่วนตัวของผู้ใช้ - เก็บแบบ 1 คน 1 แถว เป็น JSON)
CREATE TABLE public.library (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    library_data JSONB DEFAULT '[]'::jsonb NOT NULL,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. ตาราง reports (การแจ้งอัปเดตเวอร์ชันและข้อผิดพลาด)
CREATE TABLE public.reports (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    type TEXT NOT NULL,
    game_title TEXT,
    reported_version TEXT,
    description TEXT,
    changelog TEXT,
    developer_url TEXT,
    report_tags TEXT,
    error_status TEXT,
    status TEXT DEFAULT 'pending',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. ตาราง transactions (ประวัติธุรกรรม/การสมัครสมาชิก Premium)
CREATE TABLE public.transactions (
    id TEXT PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    email TEXT NOT NULL,
    username TEXT,
    amount NUMERIC DEFAULT 0,
    package_name TEXT,
    status TEXT DEFAULT 'pending',
    slip_url TEXT,
    ref_no TEXT,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE
);

-- 9. ตาราง config (การตั้งค่าทั่วไปของระบบ)
CREATE TABLE public.config (
    key TEXT PRIMARY KEY,
    value TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 10. ฟังก์ชัน Trigger ดึงผู้ใช้งานที่สมัครใหม่ไปที่ตาราง profiles อัตโนมัติ
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  is_admin_user text := 'no';
  is_premium_user text := 'no';
END;
$$; -- fallback definition structure to compile function variables

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  is_admin_user text := 'no';
  is_premium_user text := 'no';
BEGIN
  -- กำหนดสิทธิ์แอดมินให้อีเมลที่ระบุ
  IF NEW.email IN (
    'pattarasak.raksanarong@gmail.com',
    'pattarasak.raksanrong@gmail.com',
    'rogerlovek@gmail.com'
  ) THEN
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
    timezone('utc'::text, now())
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- สร้าง Trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 11. นำผู้ใช้ที่มีอยู่ในตาราง auth.users อยู่แล้ว เข้าตาราง profiles
INSERT INTO public.profiles (id, username, email, premium, admin, signup_date)
SELECT 
  id, 
  COALESCE(raw_user_meta_data->>'username', split_part(email, '@', 1)), 
  email, 
  CASE WHEN email IN ('pattarasak.raksanarong@gmail.com', 'pattarasak.raksanrong@gmail.com', 'rogerlovek@gmail.com') THEN 'yes' ELSE 'no' END,
  CASE WHEN email IN ('pattarasak.raksanarong@gmail.com', 'pattarasak.raksanrong@gmail.com', 'rogerlovek@gmail.com') THEN 'yes' ELSE 'no' END,
  timezone('utc'::text, now())
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 12. ค่าเริ่มต้น (Seeding) สำหรับตาราง config
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

-- 13. ฟังก์ชัน RPC สำหรับเพิ่มยอดผู้ชมเกม
CREATE OR REPLACE FUNCTION public.increment_view_count(game_id TEXT)
RETURNS void AS $$
BEGIN
  UPDATE public.official_games
  SET view_count = COALESCE(view_count, 0) + 1
  WHERE id = game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 14. ตั้งสิทธิ์เปิดเป็นแบบ Public Access (อ่าน-เขียนสะดวก ไม่มีบล็อก)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public access profiles" ON public.profiles;
CREATE POLICY "Public access profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.official_games ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public access official_games" ON public.official_games;
CREATE POLICY "Public access official_games" ON public.official_games FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.library ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public access library" ON public.library;
CREATE POLICY "Public access library" ON public.library FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public access reports" ON public.reports;
CREATE POLICY "Public access reports" ON public.reports FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public access transactions" ON public.transactions;
CREATE POLICY "Public access transactions" ON public.transactions FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public access config" ON public.config;
CREATE POLICY "Public access config" ON public.config FOR ALL USING (true) WITH CHECK (true);

-- สิทธิ์ในการดำเนินการสำหรับตารางและฟังก์ชัน
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;

-- แจ้งให้ PostgREST รีโหลดแคชของ Schema
NOTIFY pgrst, 'reload schema';
