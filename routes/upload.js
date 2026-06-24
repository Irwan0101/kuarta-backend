import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { uploadToB2 } from '../lib/b2.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Tidak ada file' });
  try {
    const url = await uploadToB2(req.file.buffer, req.file.originalname, req.file.mimetype);
    res.json({ url, name: req.file.originalname, size: req.file.size });
  } catch (err) {
    console.error('B2 upload error:', err);
    res.status(500).json({ error: 'Gagal upload: ' + (err.message || 'unknown error') });
  }
});

router.post('/multiple', upload.array('files', 10), async (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'Tidak ada file' });
  try {
    const results = await Promise.all(req.files.map(f => uploadToB2(f.buffer, f.originalname, f.mimetype)));
    res.json(req.files.map((f, i) => ({ url: results[i], name: f.originalname, size: f.size })));
  } catch (err) {
    res.status(500).json({ error: 'Gagal upload: ' + err.message });
  }
});

export default router;
