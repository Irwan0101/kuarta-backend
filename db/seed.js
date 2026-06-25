// 🌟 PERBAIKAN UTAMA: Muat file .env di baris paling atas agar password database terbaca!
import dotenv from 'dotenv';
dotenv.config();
console.log("DB configured:", !!process.env.DATABASE_URL);
import { query } from './pool.js';
import bcrypt from 'bcryptjs';

async function seed() {
  console.log('🌱 Seeding database...');

  // Admin user
  const adminHash = await bcrypt.hash('Admin@123', 12);
  await query(`
    INSERT INTO users (name, email, phone, password_hash, role, plan, city, bio, email_verified)
    VALUES ($1,$2,$3,$4,'admin','vip',$5,$6,true)
    ON CONFLICT (email) DO NOTHING`,
    ['Admin Kuarta', 'admin@kuarta.id', '+6281200000001', adminHash.toString(),
     'Jakarta', 'Platform administrator']
  );

  // Mentor
  const mentorHash = await bcrypt.hash('Mentor@123', 12);
  const mentorRes = await query(`
    INSERT INTO users (name, email, phone, password_hash, role, plan, city, bio, email_verified,
                       specialization, photo_url, schedule)
    VALUES ($1,$2,$3,$4,'mentor','vip',$5,$6,true,
            $7,$8,$9::jsonb)
    ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
    ['Rizal Saputra, S.Pd.', 'rizal@kuarta.id', '+6281200000002', mentorHash.toString(),
     'Bandung', 'Mentor TIU & Matematika. 5 tahun pengalaman',
     '{TIU,Matematika,CPNS}',
     'https://ui-avatars.com/api/?name=Rizal+Saputra&background=FF6B00&color=fff&size=200',
     JSON.stringify([
       { day: 'Senin', start: '09:00', end: '15:00' },
       { day: 'Rabu', start: '09:00', end: '15:00' },
       { day: 'Jumat', start: '13:00', end: '17:00' },
     ])]
  );

  // Demo user
  const userHash = await bcrypt.hash('User@123', 12);
  const userRes = await query(`
    INSERT INTO users (name, email, phone, password_hash, role, plan, plan_expires_at, city, bio,
                        streak_count, reward_points, target_exam, email_verified)
     VALUES ($1,$2,$3,$4,'user','premium',NOW()+INTERVAL '9 months',$5,$6,14,2840,$7,true)
     ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash RETURNING id`,
     ['Andi Saputra', 'andi@email.com', '+6281234567890', userHash.toString(),
     'Palembang', 'Pejuang ASN dari Palembang 💪', 'SKD CPNS 2026 — Formasi Umum']
   );

  // User lindasundari
  const lindaHash = await bcrypt.hash('linda2000', 12);
  const lindaRes = await query(`
    INSERT INTO users (name, email, phone, password_hash, role, plan, city, email_verified)
     VALUES ($1,$2,$3,$4,'user','premium',$5,true)
     ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, password_hash=EXCLUDED.password_hash RETURNING id`,
     ['Linda Sundari', 'lindasundari824@gmail.com', '+6281200000003', lindaHash.toString(),
     'Jakarta']
  );
  const lindaId = lindaRes.rows[0]?.id;

  // Programs
  const programs = [
    { slug:'bimbel-sd', name:'Bimbel SD', category:'sekolah', price:350000, duration:3, icon:'📗', bg:'linear-gradient(135deg,#1e3a5f,#0f2027)', badge:'Populer', btype:'popular', video:80, pdf:40 },
    { slug:'bimbel-smp', name:'Bimbel SMP', category:'sekolah', price:450000, duration:4, icon:'📘', bg:'linear-gradient(135deg,#1a2a4a,#0a1628)', badge:'Baru', btype:'new', video:120, pdf:60 },
    { slug:'bimbel-sma', name:'Bimbel SMA', category:'sekolah', price:550000, duration:6, icon:'📙', bg:'linear-gradient(135deg,#1f1535,#0e0a1f)', badge:null, btype:null, video:200, pdf:90 },
    { slug:'utbk-snbt', name:'UTBK — SNBT', category:'universitas', price:850000, duration:6, icon:'🎯', bg:'linear-gradient(135deg,#3b1f1f,#1f0f0f)', badge:'Hot', btype:'hot', video:180, pdf:0, tryout:50 },
    { slug:'skd-cpns', name:'SKD CPNS — Kedinasan', category:'cpns', price:900000, duration:3, icon:'🏛️', bg:'linear-gradient(135deg,#1a2a4a,#0d1a30)', badge:'Terlaris', btype:'popular', video:150, pdf:0, tryout:30 },
    { slug:'persiapan-karier', name:'Persiapan Karier', category:'karier', price:300000, duration:2, icon:'💼', bg:'linear-gradient(135deg,#0f2e2e,#061a1a)', badge:null, btype:null, video:90, pdf:0 },
    { slug:'english-master', name:'English Master', category:'bahasa', price:500000, duration:4, icon:'🌐', bg:'linear-gradient(135deg,#1a2a1a,#0a1a0a)', badge:'Baru', btype:'new', video:110, pdf:0 },
    { slug:'persiapan-osn', name:'Persiapan OSN', category:'olimpiade', price:600000, duration:6, icon:'🏆', bg:'linear-gradient(135deg,#2a1a3a,#1a0f2a)', badge:'Prestisius', btype:'hot', video:160, pdf:0 },
  ];

  const progIds = {};
  for (const p of programs) {
    const r = await query(`
      INSERT INTO programs (slug,name,category,price,duration_months,icon,bg_gradient,
                            badge_label,badge_type,video_count,pdf_count,tryout_count,
                            is_active,rating,review_count,student_count,
                            pricing_type,session_price,session_count)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,4.8+random()*0.2,
              (200+floor(random()*5000))::int,(500+floor(random()*10000))::int,
              'bundle',null,0)
      ON CONFLICT (slug) DO UPDATE SET price=EXCLUDED.price RETURNING id`,
      [p.slug,p.name,p.category,p.price,p.duration,p.icon,p.bg,
       p.badge||null,p.btype||null,p.video||0,p.pdf||0,p.tryout||0]
    );
    progIds[p.slug] = r.rows[0].id;
  }

  // Enroll demo user in SKD + English
  if (userId) {
    const enrollProgs = ['skd-cpns','english-master','utbk-snbt'];
    for (const slug of enrollProgs) {
      if (progIds[slug]) {
        await query(`
          INSERT INTO user_programs (user_id, program_id, expires_at)
          VALUES ($1,$2,NOW()+INTERVAL '6 months')
          ON CONFLICT (user_id, program_id) DO NOTHING`,
          [userId, progIds[slug]]
        );
      }
    }

    // Seed some transactions
    await query(`
      INSERT INTO transactions (order_id,user_id,program_id,amount,gross_amount,status,payment_method,paid_at)
      VALUES
        ('TRX-KRT-20260528-001',$1,$2,900000,905000,'success','qris',NOW()-INTERVAL '1 day'),
        ('TRX-KRT-20260512-009',$1,$3,500000,505000,'success','bca_va',NOW()-INTERVAL '17 days'),
        ('TRX-KRT-20260501-022',$1,$4,850000,855000,'success','gopay',NOW()-INTERVAL '28 days')
      ON CONFLICT (order_id) DO NOTHING`,
      [userId, progIds['skd-cpns'], progIds['english-master'], progIds['utbk-snbt']]
    );

    // Seed tryout packages for SKD
    const toRes = await query(`
      INSERT INTO tryout_packages (program_id,title,type,question_count,duration_mins,passing_score,participant_count)
      VALUES
        ($1,'Tryout Akbar #1','full',110,100,311,4521),
        ($1,'Tryout Akbar #2','full',110,100,311,3892),
        ($1,'Tryout Akbar #3','full',110,100,311,0),
        ($1,'TIU Numerik #01','mini',15,20,0,890),
        ($1,'TWK HOTS #02','mini',15,15,0,760),
        ($1,'TKP Skenario #03','mini',20,25,0,650)
      RETURNING id`,
      [progIds['skd-cpns']]
    );

    // Seed tryout results
    if (toRes.rows.length >= 2) {
      // 🌟 PERBAIKAN: PostgreSQL membutuhkan klausa konflik spesifik atau kolom target unik.
      // Ditambahkan 'ON CONFLICT (user_id, tryout_id) DO NOTHING' (sesuai unique constraint tabelmu)
      await query(`
        INSERT INTO tryout_results (user_id,tryout_id,twk_score,tiu_score,tkp_score,total_score,passed,finished_at)
        VALUES
          ($1,$2,150,175,127,452,true,NOW()-INTERVAL '3 days'),
          ($1,$3,145,168,125,438,true,NOW()-INTERVAL '10 days')
        ON CONFLICT DO NOTHING`,
        [userId, toRes.rows[0].id, toRes.rows[1].id]
      );
    }

    // Live classes
    const mentorId = mentorRes.rows[0]?.id;
    if (mentorId) {
      // 🌟 PERBAIKAN: Jika tabel live_classes tidak memiliki index unik, ganti ON CONFLICT menjadi query biasa atau biarkan tanpa ON CONFLICT jika aman.
      // Di sini ditambahkan target asumsi (id) atau silakan sesuaikan constraint tabelnya.
      await query(`
        INSERT INTO live_classes (program_id,mentor_id,title,category_tag,scheduled_at,duration_mins,is_live,participant_count)
        VALUES
          ($1,$2,'Analogi & Silogisme Lanjutan','TIU',NOW()+INTERVAL '2 hours',60,true,47),
          ($1,$2,'Pancasila & UUD 1945 HOTS','TWK',NOW()+INTERVAL '1 day'+INTERVAL '4 hours',90,false,0),
          ($1,$2,'Deret Angka & Numerik','TIU',NOW()+INTERVAL '3 days',75,false,0)
        ON CONFLICT DO NOTHING`,
        [progIds['skd-cpns'], mentorId]
      );
    }

    // Notifications
    await query(`
      INSERT INTO notifications (user_id,title,message,type)
      VALUES
        ($1,'Selamat! Pembayaran Berhasil','Program SKD CPNS kamu sudah aktif. Mulai belajar sekarang!','success'),
        ($1,'Kelas Live Malam Ini','Rizal Saputra akan membahas Silogisme pukul 19.30. Jangan lewatkan!','info'),
        ($1,'Streak Kamu 14 Hari! 🔥','Luar biasa! Pertahankan streak belajarmu untuk bonus poin reward.','achievement')
      ON CONFLICT DO NOTHING`,
      [userId]
    );
  }

  console.log('✅ Seed complete');
  process.exit(0);
}

seed().catch(err => { console.error('❌ Seed error:', err); process.exit(1); });