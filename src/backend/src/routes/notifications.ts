import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

// GET /api/notifications
router.get('/', requireAuth, async (req, res) => {
  const { unread } = req.query;
  const notifications = await prisma.notification.findMany({
    where: {
      userId: req.user!.id,
      ...(unread === 'true' && { read: false }),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(notifications);
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', requireAuth, async (req, res) => {
  await prisma.notification.update({
    where: { id: req.params.id, userId: req.user!.id },
    data: { read: true },
  });
  res.status(204).send();
});

// POST /api/notifications/read-all
router.post('/read-all', requireAuth, async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user!.id, read: false },
    data: { read: true },
  });
  res.status(204).send();
});

export default router;
