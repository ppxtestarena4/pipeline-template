import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

// GET /api/users — list all users (admin/manager)
router.get('/', requireAuth, async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, email: true, role: true, type: true,
      avatarUrl: true, managerId: true,
      manager: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });
  res.json(users);
});

// GET /api/users/:id
router.get('/:id', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true, name: true, email: true, role: true, type: true,
      avatarUrl: true, managerId: true,
      manager: { select: { id: true, name: true } },
      directReports: {
        select: { id: true, name: true, role: true, type: true, avatarUrl: true },
      },
      ownedProjects: {
        select: { id: true, name: true, archived: true },
      },
    },
  });

  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});

// GET /api/users/:id/direct-reports
router.get('/:id/direct-reports', requireAuth, async (req, res) => {
  const reports = await prisma.user.findMany({
    where: { managerId: req.params.id },
    select: {
      id: true, name: true, email: true, role: true, type: true, avatarUrl: true,
    },
    orderBy: { name: 'asc' },
  });
  res.json(reports);
});

// PATCH /api/users/:id
router.patch('/:id', requireAuth, async (req, res) => {
  // Only self or admin can update
  if (req.user!.id !== req.params.id && req.user!.role !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const { name, avatarUrl, managerId } = req.body;
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { name, avatarUrl, managerId },
    select: { id: true, name: true, email: true, role: true, type: true, avatarUrl: true, managerId: true },
  });
  res.json(user);
});

export default router;
