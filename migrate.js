import { query } from './db/pool.js';

const migrations = [
  // ─── USERS ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(120) NOT NULL,
    email         VARCHAR(200) UNIQUE NOT NULL,
    phone         VARCHAR(20),
    password_hash VARCHAR(255) NOT NULL,
    avatar_url    TEXT,
    city          VARCHAR(100),
    bio           TEXT,
    role          VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user','admin','mentor')),
    plan          VARCHAR(20) DEFAULT 'free' CHECK (plan IN ('free','premium','vip')),
    plan_expires_at TIMESTAMPTZ,
    streak_count  INT DEFAULT 0,
    streak_last_date DATE,
    reward_points INT DEFAULT 0,
    target_exam   VARCHAR(100),
    is_active     BOOLEAN DEFAULT true,
    email_verified BOOLEAN DEFAULT false,
    email_verify_token VARCHAR(64),
    token_version INT DEFAULT 0,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── PROGRAMS ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS programs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          VARCHAR(100) UNIQUE NOT NULL,
    name          VARCHAR(200) NOT NULL,
    category      VARCHAR(50) NOT NULL CHECK (category IN ('sekolah','cpns','universitas','karier','olimpiade','bahasa')),
    subcategory   VARCHAR(100),
    description   TEXT,
    price         BIGINT NOT NULL,
    duration_months INT DEFAULT 1,
    thumbnail_url TEXT,
    icon          VARCHAR(10) DEFAULT '📚',
    bg_gradient   VARCHAR(200),
    is_featured   BOOLEAN DEFAULT false,
    is_active     BOOLEAN DEFAULT true,
    rating        DECIMAL(3,2) DEFAULT 0,
    review_count  INT DEFAULT 0,
    student_count INT DEFAULT 0,
    video_count   INT DEFAULT 0,
    pdf_count     INT DEFAULT 0,
    tryout_count  INT DEFAULT 0,
    badge_label   VARCHAR(30),
    badge_type    VARCHAR(20),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── MODULES ─────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS modules (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id    UUID REFERENCES programs(id) ON DELETE CASCADE,
    title         VARCHAR(200) NOT NULL,
    icon          VARCHAR(10) DEFAULT '📖',
    order_index   INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── LESSONS ─────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS lessons (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id     UUID REFERENCES modules(id) ON DELETE CASCADE,
    program_id    UUID REFERENCES programs(id) ON DELETE CASCADE,
    title         VARCHAR(200) NOT NULL,
    type          VARCHAR(20) DEFAULT 'video' CHECK (type IN ('video','pdf','quiz','live')),
    video_url     TEXT,
    pdf_url       TEXT,
    duration_mins INT DEFAULT 0,
    order_index   INT NOT NULL DEFAULT 0,
    description   TEXT,
    is_free_preview BOOLEAN DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── USER PROGRAMS ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS user_programs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    program_id    UUID REFERENCES programs(id) ON DELETE CASCADE,
    enrolled_at   TIMESTAMPTZ DEFAULT NOW(),
    expires_at    TIMESTAMPTZ,
    is_active     BOOLEAN DEFAULT true,
    UNIQUE(user_id, program_id)
  )`,

  // ─── LESSON PROGRESS ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS lesson_progress (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    lesson_id     UUID REFERENCES lessons(id) ON DELETE CASCADE,
    program_id    UUID REFERENCES programs(id) ON DELETE CASCADE,
    completed     BOOLEAN DEFAULT false,
    watch_seconds INT DEFAULT 0,
    completed_at  TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, lesson_id)
  )`,

  // ─── TRYOUT PACKAGES ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS tryout_packages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id    UUID REFERENCES programs(id) ON DELETE CASCADE,
    title         VARCHAR(200) NOT NULL,
    type          VARCHAR(20) DEFAULT 'full' CHECK (type IN ('full','mini','daily')),
    question_count INT DEFAULT 110,
    duration_mins INT DEFAULT 100,
    passing_score INT DEFAULT 311,
    is_active     BOOLEAN DEFAULT true,
    participant_count INT DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── QUESTIONS ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS questions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tryout_id     UUID REFERENCES tryout_packages(id) ON DELETE CASCADE,
    program_id    UUID REFERENCES programs(id),
    category      VARCHAR(20) CHECK (category IN ('TWK','TIU','TKP','PU','PM','LBI','LBE','PBM','GENERAL')),
    question_text TEXT NOT NULL,
    option_a      TEXT NOT NULL,
    option_b      TEXT NOT NULL,
    option_c      TEXT NOT NULL,
    option_d      TEXT NOT NULL,
    option_e      TEXT,
    correct_answer CHAR(1) NOT NULL,
    explanation   TEXT,
    difficulty    VARCHAR(10) DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
    score_value   INT DEFAULT 5,
    order_index   INT DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── TRYOUT RESULTS ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS tryout_results (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    tryout_id     UUID REFERENCES tryout_packages(id) ON DELETE CASCADE,
    twk_score     INT DEFAULT 0,
    tiu_score     INT DEFAULT 0,
    tkp_score     INT DEFAULT 0,
    total_score   INT DEFAULT 0,
    correct_count INT DEFAULT 0,
    wrong_count   INT DEFAULT 0,
    empty_count   INT DEFAULT 0,
    duration_secs INT DEFAULT 0,
    passed        BOOLEAN DEFAULT false,
    answers       JSONB DEFAULT '{}',
    started_at    TIMESTAMPTZ DEFAULT NOW(),
    finished_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── TRANSACTIONS ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS transactions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      VARCHAR(100) UNIQUE NOT NULL,
    user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    program_id    UUID REFERENCES programs(id) ON DELETE SET NULL,
    amount        BIGINT NOT NULL,
    service_fee   BIGINT DEFAULT 5000,
    gross_amount  BIGINT NOT NULL,
    status        VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','success','failed','expire','cancel','refund')),
    payment_method VARCHAR(50),
    snap_token    TEXT,
    midtrans_response JSONB,
    paid_at       TIMESTAMPTZ,
    expired_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── LIVE CLASSES ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS live_classes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id    UUID REFERENCES programs(id) ON DELETE CASCADE,
    mentor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    title         VARCHAR(200) NOT NULL,
    description   TEXT,
    category_tag  VARCHAR(20),
    zoom_url      TEXT,
    scheduled_at  TIMESTAMPTZ NOT NULL,
    duration_mins INT DEFAULT 60,
    participant_count INT DEFAULT 0,
    is_live       BOOLEAN DEFAULT false,
    is_recorded   BOOLEAN DEFAULT false,
    recording_url TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── NOTIFICATIONS ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS notifications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    title         VARCHAR(200) NOT NULL,
    message       TEXT,
    type          VARCHAR(30) DEFAULT 'info',
    is_read       BOOLEAN DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id            SERIAL PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token         VARCHAR(64) NOT NULL UNIQUE,
    expires_at    TIMESTAMPTZ NOT NULL,
    attempt_count INT DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── ADD COLUMNS IF MISSING (must be before indexes) ──────────
  `DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT DEFAULT 0;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS discount BIGINT DEFAULT 0;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS items JSONB;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verify_token VARCHAR(64);
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS attempt_count INT DEFAULT 0;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(200) UNIQUE;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE programs ADD COLUMN IF NOT EXISTS pricing_type VARCHAR(20) DEFAULT 'bundle' CHECK (pricing_type IN ('bundle', 'session'));
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE programs ADD COLUMN IF NOT EXISTS session_price BIGINT;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE programs ADD COLUMN IF NOT EXISTS session_count INT DEFAULT 0;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS specialization TEXT[];
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE users ADD COLUMN IF NOT EXISTS schedule JSONB DEFAULT '[]'::jsonb;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  // ─── INDEXES ──────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_users_verify_token ON users(email_verify_token) WHERE email_verify_token IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_user_programs_user ON user_programs(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_programs_program ON user_programs(program_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress(user_id, program_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tryout_results_user ON tryout_results(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tryout_results_score ON tryout_results(total_score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tryout_results_tryout ON tryout_results(tryout_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_order ON transactions(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_program ON transactions(program_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_questions_tryout ON questions(tryout_id, order_index)`,
  `CREATE INDEX IF NOT EXISTS idx_questions_program ON questions(program_id)`,
  `CREATE INDEX IF NOT EXISTS idx_modules_program ON modules(program_id, order_index)`,
  `CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons(module_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lessons_program ON lessons(program_id)`,
  `CREATE INDEX IF NOT EXISTS idx_live_scheduled ON live_classes(scheduled_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_prt_token ON password_reset_tokens(token)`,

  // ─── UPDATED_AT TRIGGER ───────────────────────────────────────
  `CREATE OR REPLACE FUNCTION update_updated_at()
   RETURNS TRIGGER AS $$
   BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
   $$ LANGUAGE plpgsql`,

  `DO $$ BEGIN
    CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
    CREATE TRIGGER trg_programs_updated BEFORE UPDATE ON programs
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
    CREATE TRIGGER trg_transactions_updated BEFORE UPDATE ON transactions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  `DO $$ BEGIN
    CREATE TRIGGER trg_notifications_updated BEFORE UPDATE ON notifications
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // ─── FORUM THREADS ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS forum_threads (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id    UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         VARCHAR(200) NOT NULL,
    content       TEXT NOT NULL,
    is_pinned     BOOLEAN DEFAULT false,
    is_closed     BOOLEAN DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS forum_replies (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id     UUID NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content       TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── MENTORING SESSIONS ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mentoring_sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mentor_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    program_id    UUID REFERENCES programs(id) ON DELETE SET NULL,
    scheduled_at  TIMESTAMPTZ NOT NULL,
    topic         VARCHAR(200),
    status        VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','confirmed','completed','cancelled')),
    notes         TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── PROGRAM REVIEWS ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS program_reviews (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    program_id    UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    rating        INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review        TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, program_id)
  )`,

  // ─── FREE TRIAL TRACKING ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS free_trials (
    id            SERIAL PRIMARY KEY,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    program_id    UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    used_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, program_id)
  )`,

  // ─── LANDING PAGE BANNERS ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS landing_banners (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_url     TEXT,
    title         VARCHAR(200) NOT NULL,
    subtitle      TEXT,
    cta_text      VARCHAR(100),
    cta_link      VARCHAR(200),
    badge_text    VARCHAR(100),
    order_index   INT DEFAULT 0,
    is_active     BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── LANDING PAGE PROMOTIONS (popup) ──────────────────────────────
  `CREATE TABLE IF NOT EXISTS landing_promotions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         VARCHAR(200) NOT NULL,
    description   TEXT,
    discount_text VARCHAR(100),
    coupon_code   VARCHAR(50),
    image_url     TEXT,
    bg_color      VARCHAR(20) DEFAULT '#FF6B00',
    is_active     BOOLEAN DEFAULT true,
    show_on_pages VARCHAR(100) DEFAULT 'landing',
    starts_at     TIMESTAMPTZ DEFAULT NOW(),
    ends_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── LANDING PAGE SECTIONS (editable content) ─────────────────────
  `CREATE TABLE IF NOT EXISTS landing_sections (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_key   VARCHAR(100) UNIQUE NOT NULL,
    title         VARCHAR(200),
    subtitle      VARCHAR(300),
    content       JSONB DEFAULT '{}',
    is_active     BOOLEAN DEFAULT true,
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── COUPONS / DISCOUNT CODES ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS coupons (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          VARCHAR(50) UNIQUE NOT NULL,
    type          VARCHAR(10) NOT NULL CHECK (type IN ('percent','fixed')) DEFAULT 'percent',
    value         INT NOT NULL,
    min_purchase  BIGINT DEFAULT 0,
    max_uses      INT DEFAULT 0,
    use_count     INT DEFAULT 0,
    is_active     BOOLEAN DEFAULT true,
    program_id    UUID REFERENCES programs(id) ON DELETE SET NULL,
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code)`,

  `DO $$ BEGIN
    ALTER TABLE transactions ADD COLUMN IF NOT EXISTS coupon_id UUID;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  // ─── AUDIT LOGS ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_name    VARCHAR(120),
    action        VARCHAR(50) NOT NULL,
    entity_type   VARCHAR(50) NOT NULL,
    entity_id     VARCHAR(50),
    details       JSONB DEFAULT '{}',
    ip_address    VARCHAR(45),
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON audit_logs(admin_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC)`,

  // ─── ADMIN SETTINGS ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS admin_settings (
    key           VARCHAR(100) PRIMARY KEY,
    value         JSONB NOT NULL DEFAULT '{}',
    updated_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  // ─── SEED DEFAULT LANDING SECTIONS ─────────────────────────────────
  `INSERT INTO landing_sections (section_key, title, subtitle, content) VALUES
    ('hero', 'Raih Masa Depan Bersama Kuarta', 'Platform belajar online #1 di Indonesia untuk CPNS, UTBK, dan bimbel sekolah',
      '{"badge_text":"PLATFORM BELAJAR #1","words":["Prestasi","Masa Depan","Impianmu","Karirmu","Nilai Terbaik"],"stats":[{"target":120000,"label":"Siswa Aktif","fmt":"K+"},{"target":49,"label":"Rating Platform","fmt":"★"},{"target":98,"label":"Tingkat Lulus","fmt":"%"},{"target":500,"label":"Materi & Video","fmt":"+"}],"description":"Platform belajar online lengkap untuk CPNS, UTBK, Olimpiade, dan bimbel sekolah. Video HD, tryout akurat, dan live class bersama mentor terbaik.","button_text":"Mulai Belajar Gratis","button_link":"/register"}'),
    ('features', 'Semua yang Kamu Butuhkan', 'Ada di Sini',
      '{"items":[{"icon":"📹","title":"Video HD Interaktif","desc":"Ratusan video berkualitas tinggi dari pengajar berpengalaman."},{"icon":"📝","title":"Tryout Mirip Asli","desc":"Simulasi tryout dengan soal yang diperbarui setiap bulan."},{"icon":"🎥","title":"Live Class Rutin","desc":"Sesi belajar langsung bersama mentor setiap minggu."},{"icon":"📊","title":"Analitik Performa","desc":"Pantau perkembangan nilai dengan grafik yang detail."},{"icon":"🏆","title":"Leaderboard Nasional","desc":"Bersaing dengan ribuan siswa dari seluruh Indonesia."},{"icon":"📱","title":"Akses Multi-Device","desc":"Belajar dari HP, tablet, atau laptop — sinkron otomatis."}]}'),
    ('testimonials', 'Mereka Sudah Membuktikannya', 'Testimoni dari siswa yang berhasil',
      '{"items":[{"name":"Rizki Firmansyah","role":"Lulus CPNS Kemenkeu 2024","avatar":"RF","score":478,"text":"Berkat Kuarta saya lulus SKD dengan skor tertinggi di batch saya. Tryout-nya sangat mirip soal asli!"},{"name":"Siti Rahayu","role":"Mahasiswa UI – Kedokteran","avatar":"SR","score":820,"text":"UTBK-ku naik 150 poin dalam 3 bulan. Live class-nya sangat membantu."},{"name":"Bagas Pratama","role":"Lulus IPDN 2024","avatar":"BP","score":461,"text":"Platform terbaik untuk persiapan kedinasan. Materinya lengkap, harganya terjangkau."}]}'),
    ('cta', 'Siap Meraih Mimpimu?', 'Bergabung dengan 120.000+ siswa yang sudah membuktikan',
      '{"button_text":"Daftar Sekarang — Gratis","button_link":"/register","guarantees":["✓ Tanpa kartu kredit","✓ Akses instan","✓ Bisa dibatalkan kapan saja"]}'),
    ('footer', '', '© 2026 Kuarta. All rights reserved.',
      '{"links":[{"label":"Tentang","url":""},{"label":"Program","url":""},{"label":"Blog","url":""},{"label":"Kontak","url":""},{"label":"Privasi","url":""}]}'),
    ('ticker', '', '',
      '{"items":["CPNS 2025","UTBK SNBT","Olimpiade OSN","Bimbel SD SMP SMA","Persiapan Karier","Live Class Rutin","Tryout Akurat","Kuarta"]}'),
    ('programs', 'Pilih Program', 'Sesuai Tujuanmu',
      '{"badge_text":"PROGRAM UNGGULAN","show_price":true,"items":[]}')
  ON CONFLICT (section_key) DO NOTHING`,

  // ─── SEED DEFAULT ADMIN SETTINGS ─────────────────────────────────
  `INSERT INTO admin_settings (key, value) VALUES
    ('wa_number', '{"number":"6281234567890"}'),
    ('payment_config', '{"service_fee":0,"payment_methods":[{"id":"bank","label":"Transfer Bank","icon":"🏦"},{"id":"gopay","label":"GoPay","icon":"💚"},{"id":"ovo","label":"OVO","icon":"💜"},{"id":"dana","label":"DANA","icon":"🔵"},{"id":"qris","label":"QRIS","icon":"🟡"},{"id":"cc","label":"Kartu Kredit","icon":"💳"}],"banks":["BCA","Mandiri","BRI","BNI","BSI"]}')
  ON CONFLICT (key) DO NOTHING`,

  // ─── SEED DEFAULT PROGRAMS ────────────────────────────────────────
  `INSERT INTO programs (slug,name,category,price,duration_months,icon,bg_gradient,badge_label,badge_type,video_count,pdf_count,tryout_count,is_active,rating,student_count,review_count) VALUES
    ('bimbel-sd','Bimbel SD','sekolah',350000,3,'📗','linear-gradient(135deg,#1e3a5f,#0f2027)','Populer','popular',80,40,0,true,4.9,2500,180),
    ('bimbel-smp','Bimbel SMP','sekolah',450000,4,'📘','linear-gradient(135deg,#1a2a4a,#0a1628)','Baru','new',120,60,0,true,4.8,1800,120),
    ('bimbel-sma','Bimbel SMA','sekolah',550000,6,'📙','linear-gradient(135deg,#1f1535,#0e0a1f)',NULL,NULL,200,90,0,true,4.8,3200,210),
    ('utbk-snbt','UTBK — SNBT','universitas',850000,6,'🎯','linear-gradient(135deg,#3b1f1f,#1f0f0f)','Hot','hot',180,0,50,true,4.9,5800,340),
    ('skd-cpns','SKD CPNS — Kedinasan','cpns',900000,3,'🏛️','linear-gradient(135deg,#1a2a4a,#0d1a30)','Terlaris','popular',150,0,30,true,4.9,9200,510),
    ('persiapan-karier','Persiapan Karier','karier',300000,2,'💼','linear-gradient(135deg,#0f2e2e,#061a1a)',NULL,NULL,90,0,0,true,4.7,1200,80),
    ('english-master','English Master','bahasa',500000,4,'🌐','linear-gradient(135deg,#1a2a1a,#0a1a0a)','Baru','new',110,0,0,true,4.8,1600,95),
    ('persiapan-osn','Persiapan OSN','olimpiade',600000,6,'🏆','linear-gradient(135deg,#2a1a3a,#1a0f2a)','Prestisius','hot',160,0,0,true,4.9,950,65)
  ON CONFLICT (slug) DO NOTHING`,

  // ─── SEED DEFAULT BANNERS ─────────────────────────────────────────
  `DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM landing_banners LIMIT 1) THEN
        INSERT INTO landing_banners (image_url,title,subtitle,cta_text,cta_link,badge_text,order_index) VALUES
          (NULL,'Mulai Perjalanan Belajarmu','Daftar sekarang dan dapatkan akses gratis ke semua materi dasar','Daftar Gratis','/register','GRATIS',0),
          (NULL,'Tryout Akurat & Terpercaya','Simulasi soal mirip asli dengan pembahasan lengkap','Coba Tryout','/tryout','TRYOUT',1);
      END IF;
    END $$`,

  // ─── SEED DEFAULT PROMOTIONS ──────────────────────────────────────
  `DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM landing_promotions LIMIT 1) THEN
        INSERT INTO landing_promotions (title,description,discount_text,coupon_code,bg_color) VALUES
          ('Diskon Spesial!','Dapatkan potongan 20% untuk semua program dengan kode promo di bawah ini','Potongan 20%','KUARTA20','#FF6B00');
      END IF;
    END $$`,

  // ─── UPDATE EXISTING HERO CONTENT WITH DESCRIPTION FIELD ───────────
  `UPDATE landing_sections SET content = content || '{"description":"Platform belajar online lengkap untuk CPNS, UTBK, Olimpiade, dan bimbel sekolah. Video HD, tryout akurat, dan live class bersama mentor terbaik."}'::jsonb
   WHERE section_key='hero' AND (content->>'description' IS NULL OR content->>'description' = '')`,

  // ─── FIX HERO STATS FORMAT (migrate old value→string to target/fmt) ─
  `UPDATE landing_sections SET content = jsonb_set(
    content,
    '{stats}',
    '[
      {"target":120000,"label":"Siswa Aktif","fmt":"K+"},
      {"target":49,"label":"Rating Platform","fmt":"★"},
      {"target":98,"label":"Tingkat Lulus","fmt":"%"},
      {"target":500,"label":"Materi & Video","fmt":"+"}
    ]'::jsonb
  )
  WHERE section_key='hero' AND content->'stats' IS NOT NULL
    AND content->'stats'->0->>'target' IS NULL`,

  // ─── BANK SOAL: tryout_questions junction ─────────────────
  `CREATE TABLE IF NOT EXISTS tryout_questions (
    tryout_id   UUID REFERENCES tryout_packages(id) ON DELETE CASCADE,
    question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
    order_index INT DEFAULT 0,
    PRIMARY KEY (tryout_id, question_id)
  )`,

  // ─── VISITOR TRACKING ─────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS tracked_visits (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page          VARCHAR(255) NOT NULL,
    referrer      VARCHAR(500),
    user_agent    TEXT,
    ip_address    VARCHAR(45),
    device_type   VARCHAR(20) DEFAULT 'desktop',
    user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id    VARCHAR(100),
    duration_sec  INT DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_visits_created ON tracked_visits(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_visits_page ON tracked_visits(page)`,

  // ─── QUESTION GROUPS ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS question_groups (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         VARCHAR(200) NOT NULL,
    description   TEXT,
    stimulus      TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  )`,

  `DO $$ BEGIN
    ALTER TABLE questions ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES question_groups(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `DO $$ BEGIN
    ALTER TABLE questions ADD COLUMN IF NOT EXISTS time_limit_secs INT;
  EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  `CREATE INDEX IF NOT EXISTS idx_questions_group ON questions(group_id)`,
];

async function migrate() {
  console.log('Running migrations...');
  for (const sql of migrations) {
    try {
      await query(sql);
    } catch (err) {
      console.error('Migration error:', err.message, '\nSQL:', sql.slice(0, 80));
      throw err;
    }
  }
  console.log(`Migrations complete — ${migrations.length} statements`);
  process.exit(0);
}

migrate().catch(err => { console.error(err); process.exit(1); });
