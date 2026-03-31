import { Router, Response } from 'express';
import prisma from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { UserRole } from '@prisma/client';

const router = Router();

// GET /api/goals/week
router.get('/week', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const role = req.user!.role;
    const { userId: targetUserId, weekStart } = req.query;

    const targetId = (targetUserId as string) || userId;

    // Managers can see any user's goals; employees can only see their own
    if (targetId !== userId && role !== UserRole.MANAGER && role !== UserRole.ADMIN) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const where: Record<string, unknown> = {};

    if (role === UserRole.MANAGER || role === UserRole.ADMIN) {
      where.managerId = userId;
      if (targetUserId) where.userId = targetUserId as string;
    } else {
      where.userId = userId;
    }

    if (weekStart) {
      const start = new Date(weekStart as string);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      where.weekStart = { gte: start };
      where.weekEnd = { lte: end };
    }

    const goals = await prisma.goal.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { weekStart: 'desc' },
    });

    res.json(goals);
  } catch (error) {
    console.error('Get week goals error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/goals
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const role = req.user!.role;

    let where: Record<string, unknown>;

    if (role === UserRole.MANAGER || role === UserRole.ADMIN) {
      where = { managerId: userId };
    } else {
      where = { userId };
    }

    const goals = await prisma.goal.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
        manager: { select: { id: true, name: true, email: true } },
      },
      orderBy: { weekStart: 'desc' },
    });

    res.json(goals);
  } catch (error) {
    console.error('List goals error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/goals
router.post('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const managerId = req.user!.userId;
    const role = req.user!.role;

    if (role !== UserRole.MANAGER && role !== UserRole.ADMIN) {
      res.status(403).json({ error: 'Only managers can create goals' });
      return;
    }

    const { userId: targetUserId, title, description, weekStart, weekEnd, relatedTaskIds } = req.body;

    if (!targetUserId || !title || !weekStart || !weekEnd) {
      res.status(400).json({ error: 'userId, title, weekStart, weekEnd are required' });
      return;
    }

    const goal = await prisma.goal.create({
      data: {
        userId: targetUserId,
        managerId,
        title,
        description,
        weekStart: new Date(weekStart),
        weekEnd: new Date(weekEnd),
        relatedTaskIds: relatedTaskIds || [],
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        manager: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(goal);
  } catch (error) {
    console.error('Create goal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/goals/:id
router.put('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const goal = await prisma.goal.findUnique({ where: { id } });
    if (!goal) {
      res.status(404).json({ error: 'Goal not found' });
      return;
    }

    // Manager can update; employee can update status only
    const isManager = goal.managerId === userId;
    const isEmployee = goal.userId === userId;

    if (!isManager && !isEmployee) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const { title, description, status, relatedTaskIds } = req.body;
    const updateData: Record<string, unknown> = {};

    if (status !== undefined) updateData.status = status;

    if (isManager) {
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (relatedTaskIds !== undefined) updateData.relatedTaskIds = relatedTaskIds;
    }

    const updated = await prisma.goal.update({
      where: { id },
      data: updateData,
      include: {
        user: { select: { id: true, name: true, email: true } },
        manager: { select: { id: true, name: true } },
      },
    });

    res.json(updated);
  } catch (error) {
    console.error('Update goal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/goals/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const goal = await prisma.goal.findUnique({ where: { id } });
    if (!goal) {
      res.status(404).json({ error: 'Goal not found' });
      return;
    }

    if (goal.managerId !== userId && req.user!.role !== UserRole.ADMIN) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    await prisma.goal.delete({ where: { id } });

    res.json({ message: 'Goal deleted' });
  } catch (error) {
    console.error('Delete goal error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
