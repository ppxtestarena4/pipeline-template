import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

// POST /api/auth/register
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 6 }),
    body('name').trim().notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { email, password, name, role, managerId } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: role || 'EMPLOYEE',
        type: 'HUMAN',
        managerId: managerId || null,
      },
      select: { id: true, email: true, name: true, role: true, type: true, managerId: true },
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, type: user.type },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.status(201).json({ token, user });
  }
);

// POST /api/auth/login
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, type: user.type },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, type: user.type, managerId: user.managerId },
    });
  }
);

// POST /api/auth/create-agent — creates an AI agent user with API token
router.post('/create-agent', requireAuth, async (req, res) => {
  const { name, managerId } = req.body;
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const apiToken = `agent_${uuidv4().replace(/-/g, '')}`;
  const agent = await prisma.user.create({
    data: {
      email: `${name.toLowerCase().replace(/\s+/g, '.')}@agents.internal`,
      name,
      type: 'AI_AGENT',
      role: 'AI_AGENT',
      apiToken,
      managerId: managerId || null,
    },
    select: { id: true, name: true, email: true, role: true, type: true, apiToken: true },
  });

  res.status(201).json(agent);
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true, email: true, name: true, role: true, type: true,
      avatarUrl: true, managerId: true,
      manager: { select: { id: true, name: true } },
      directReports: { select: { id: true, name: true, role: true, avatarUrl: true } },
    },
  });
  res.json(user);
});

export default router;
