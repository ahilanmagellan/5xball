import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';

import authRoutes from './routes/auth.routes.js';
import matchesRoutes from './routes/matches.routes.js';
import betsRoutes from './routes/bets.routes.js';
import earnRoutes from './routes/earn.routes.js';
import friendsRoutes from './routes/friends.routes.js';
import profileRoutes from './routes/profile.routes.js';
import referralsRoutes from './routes/referrals.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { startOddsCron } from './jobs/oddsCron.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, '../../frontend/public');
const UPLOADS_DIR = path.join(__dirname, '../uploads');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// --- API ---
app.use('/api/auth', authRoutes);
app.use('/api/leagues', matchesRoutes);
app.use('/api/bets', betsRoutes);
app.use('/api/earn', earnRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/referrals', referralsRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Не найдено' }));

// --- Статика фронтенда (единый сервер: API + SPA) ---
app.use('/uploads', express.static(UPLOADS_DIR)); // загруженные пользователями аватарки
app.use(express.static(FRONTEND_DIR));
app.get('*', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

app.use(errorHandler);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
  if (process.env.NODE_ENV !== 'test') startOddsCron();
});
