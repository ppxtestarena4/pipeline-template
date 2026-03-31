import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { UserRole, UserType } from '@prisma/client';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change_me_in_production_jwt_secret';

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.password) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, type: user.type },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        type: user.type,
        managerId: user.managerId,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, password and name are required' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'User already exists' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role: UserRole.EMPLOYEE,
        type: UserType.HUMAN,
      },
    });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, type: user.type },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        type: user.type,
        managerId: user.managerId,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: {
        directReports: {
          select: { id: true, name: true, email: true, role: true, avatar: true },
        },
        manager: {
          select: { id: true, name: true, email: true, role: true, avatar: true },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      type: user.type,
      managerId: user.managerId,
      avatar: user.avatar,
      manager: user.manager,
      directReports: user.directReports,
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/token - For AI agents
router.post('/token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { apiToken } = req.body;

    if (!apiToken) {
      res.status(400).json({ error: 'apiToken is required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { apiToken } });

    if (!user) {
      res.status(401).json({ error: 'Invalid API token' });
      return;
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        type: user.type,
      },
    });
  } catch (error) {
    console.error('Token auth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
