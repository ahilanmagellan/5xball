import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { pool } from '../db/pool.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { getUserStats } from '../utils/statsQuery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '../../uploads/avatars');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `user${req.userId}-${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 МБ
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new HttpError(400, 'Разрешены только изображения (JPEG, PNG, WEBP, GIF)'));
    }
    cb(null, true);
  },
});

const router = Router();
router.use(requireAuth);

// GET /api/profile/stats — глобальная "убийственная" статистика по всем лигам
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await getUserStats(req.userId);
  res.json({ stats });
}));

// POST /api/profile/avatar/upload (multipart/form-data, поле "avatar") —
// загрузка своей фотографии из медиатеки устройства.
router.post('/avatar/upload', upload.single('avatar'), asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Файл не получен');

  const { rows: prevRows } = await pool.query('SELECT avatar_url FROM users WHERE id = $1', [req.userId]);
  const prevUrl = prevRows[0]?.avatar_url;

  const avatarUrl = `/uploads/avatars/${req.file.filename}`;
  await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, req.userId]);

  // Подчищаем старый загруженный файл, чтобы не копить мусор на диске
  if (prevUrl && prevUrl.startsWith('/uploads/avatars/')) {
    fs.unlink(path.join(__dirname, '../..', prevUrl), () => {});
  }

  res.json({ avatarUrl });
}));

export default router;
