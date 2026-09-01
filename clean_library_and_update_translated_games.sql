-- ==============================================================================
-- SQL สำหรับอัปเกรดระบบบทความเกมแปลไทย & เคลียร์ตารางคลังเกมที่ไม่ใช้แล้ว
-- รันคำสั่งนี้ใน Supabase Dashboard -> SQL Editor
-- ==============================================================================

-- 1. เพิ่มฟิลด์นับยอดดาวน์โหลด, สถานะเปิด/ปิด (Publish), และประเภท (Free/Premium)
ALTER TABLE translated_games ADD COLUMN IF NOT EXISTS downloads INTEGER DEFAULT 0;
ALTER TABLE translated_games ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT true;
ALTER TABLE translated_games ADD COLUMN IF NOT EXISTS access_type TEXT DEFAULT 'free';

-- 2. สร้าง Function สำหรับนับยอดดาวน์โหลดแบบ Real-time (Atomic Increment)
CREATE OR REPLACE FUNCTION increment_translated_game_downloads(game_id TEXT)
RETURNS void AS $$
BEGIN
  UPDATE translated_games
  SET downloads = COALESCE(downloads, 0) + 1
  WHERE id = game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. เคลียร์ตารางบันทึกคลังเกมเดิม (Library) ที่ไม่ได้ใช้งานแล้ว เพื่อลดขนาดฐานข้อมูลและประหยัด Quota
DROP TABLE IF EXISTS library CASCADE;
DROP TABLE IF EXISTS user_libraries CASCADE;
