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

  // ─── MODULES (Chapters) ──────────────────────────────────────
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

  // ─── USER PROGRAMS (Enrollments) ─────────────────────────────
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

  // ─── QUESTIONS ───────────────────────────────────────────────
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

  // ─── INDEXES ──────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_user_programs_user ON user_programs(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lesson_progress_user ON lesson_progress(user_id, program_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tryout_results_user ON tryout_results(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tryout_results_score ON tryout_results(total_score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_order ON transactions(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_questions_tryout ON questions(tryout_id, order_index)`,

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
    CREATE TRIGGER trg_transactions_updated BEFORE UPDATE ON transactions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
];

async function migrate() {
  console.log('🗄️  Running migrations...');
  for (const sql of migrations) {
    try {
      await query(sql);
    } catch (err) {
      console.error('Migration error:', err.message, '\nSQL:', sql.slice(0, 80));
      throw err;
    }
  }
  console.log(`✅ Migrations complete — ${migrations.length} statements`);
  process.exit(0);
}

migrate().catch(err => { console.error(err); process.exit(1); });