import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { uploadToB2, deleteFromB2 } from '../lib/b2.js';

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'video/mp4', 'video/webm',
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Tipe file ${file.mimetype} tidak diizinkan. Hanya gambar, PDF, dan video.`));
  },
});

const router = Router();
router.use(authenticate);

router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File terlalu besar (maks 50MB)' });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Tidak ada file' });
    uploadToB2(req.file.buffer, req.file.originalname, req.file.mimetype)
      .then(url => res.json({ url, name: req.file.originalname, size: req.file.size }))
      .catch(e => res.status(500).json({ error: 'Gagal upload: ' + (e.message || 'unknown error') }));
  });
});

router.post('/multiple', (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
    if (err) return res.status(400).json({ error: err.message });
    if (!req.files || !req.files.length) return res.status(400).json({ error: 'Tidak ada file' });
    Promise.all(req.files.map(f => uploadToB2(f.buffer, f.originalname, f.mimetype)))
      .then(results => res.json(req.files.map((f, i) => ({ url: results[i], name: f.originalname, size: f.size }))))
      .catch(e => res.status(500).json({ error: 'Gagal upload: ' + e.message }));
  });
});

router.delete('/', async (req, res) => {
  try {
    const fileName = req.body.fileName || (req.body.url ? decodeURIComponent(req.body.url.split('/').pop()) : '');
    if (!fileName) return res.status(400).json({ error: 'Parameter fileName atau url diperlukan' });
    await deleteFromB2(fileName);
    res.json({ success: true });
  } catch (err) {
    console.error('B2 delete error:', err);
    res.status(500).json({ error: 'Gagal hapus file: ' + (err.message || 'unknown error') });
  }
});

export default router;
