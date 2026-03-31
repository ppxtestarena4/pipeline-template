import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { WebSocketServer } from 'ws';
import http from 'http';
import dotenv from 'dotenv';

import authRouter from './routes/auth';
import usersRouter from './routes/users';
import projectsRouter from './routes/projects';
import tasksRouter from './routes/tasks';
import reportsRouter from './routes/reports';
import intakeRouter from './routes/intake';
import notificationsRouter from './routes/notifications';
import goalsRouter from './routes/goals';
import { errorHandler } from './middleware/error';
import { wsClients } from './services/notifications';

dotenv.config();

const app = express();
const server = http.createServer(app);

// WebSocket server for real-time notifications
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const token = new URL(req.url!, `http://localhost`).searchParams.get('token');
  if (token) {
    wsClients.set(token, ws);
    ws.on('close', () => wsClients.delete(token));
  }
});

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use('/uploads', express.static('uploads'));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/intake', intakeRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/goals', goalsRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[server] TechTCB API listening on port ${PORT}`);
});

export default app;
