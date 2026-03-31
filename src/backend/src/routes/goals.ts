import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { createNotification } from '../services/notifications';

const router = Router();

// GET /api/goals — list goals
router.get('/', requireAuth, async (req, res) => {
  const { userId, weekStart, weekEnd } = req.query;
  const currentUser = req.user!;

  const where: Record<string, unknown> = {};

  if (userId) {
    where.userId = userId;
  } else if (currentUser.role === 'EMPLOYEE') {
    where.userId = currentUser.id;
  } else {
    // Manager sees their direct reports' goals
    const reports = await prisma.user.findMany({
      where: { managerId: currentUser.id },
      select: { id: true },
    });
    where.userId = { in: [currentUser.id, ...reports.map(r => r.id)] };
  }

  if (weekStart) where.weekStart = { gte: new Date(weekStart as string) };
  if (weekEnd) where.weekStart = { lte: new Date(weekEnd as string) };

  const goals = await prisma.weeklyGoal.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
      manager: { select: { id: true, name: true } },
      taskLinks: {
        include: { task: { select: { id: true, title: true, status: true } } },
      },
    },
    orderBy: [{ weekStart: 'desc' }, { createdAt: 'asc' }],
  });

  res.json(goals);
});

// POST /api/goals
router.post('/', requireAuth, async (req, res) => {
  const { userId, title, description, weekStart, taskIds } = req.body;
  if (!userId || !title || !weekStart) {
    res.status(400).json({ error: 'userId, title, weekStart are required' });
    return;
  }

  const goal = await prisma.weeklyGoal.create({
    data: {
      userId,
      managerId: req.user!.id,
      title,
      description,
      weekStart: new Date(weekStart),
      taskLinks: taskIds?.length
        ? { create: taskIds.map((taskId: string) => ({ taskId })) }
        : undefined,
    },
    include: {
      user: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true } },
      taskLinks: { include: { task: { select: { id: true, title: true } } } },
    },
  });

  // Notify employee
  if (userId !== req.user!.id) {
    await createNotification(
      userId,
      'GOAL_SET',
      `Руководитель поставил новую цель на неделю: ${title}`,
    );
  }

  res.status(201).json(goal);
});

// PATCH /api/goals/:id
router.patch('/:id', requireAuth, async (req, res) => {
  const { title, description, status, taskIds } = req.body;

  const goal = await prisma.weeklyGoal.update({
    where: { id: req.params.id },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(status !== undefined && { status }),
    },
    include: {
      user: { select: { id: true, name: true } },
      taskLinks: { include: { task: { select: { id: true, title: true, status: true } } } },
    },
  });

  if (taskIds !== undefined) {
    await prisma.goalTaskLink.deleteMany({ where: { goalId: goal.id } });
    if (taskIds.length > 0) {
      await prisma.goalTaskLink.createMany({
        data: taskIds.map((taskId: string) => ({ goalId: goal.id, taskId })),
        skipDuplicates: true,
      });
    }
  }

  res.json(goal);
});

// DELETE /api/goals/:id
router.delete('/:id', requireAuth, async (req, res) => {
  await prisma.weeklyGoal.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
