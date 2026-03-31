import { Router, Response } from 'express';
import prisma from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { UserRole, NotificationType } from '@prisma/client';
import { broadcastToUser } from '../services/ws';

const router = Router();

// GET /api/reports/summary - manager summary view
router.get('/summary', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const role = req.user!.role;

    if (role !== UserRole.MANAGER && role !== UserRole.ADMIN) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const { startDate, endDate } = req.query;

    const where: Record<string, unknown> = { managerId: userId };
    if (startDate && endDate) {
      where.startDate = { gte: new Date(startDate as string) };
      where.endDate = { lte: new Date(endDate as string) };
    }

    const reports = await prisma.report.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(reports);
  } catch (error) {
    console.error('Get summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports
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

    const reports = await prisma.report.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
        manager: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(reports);
  } catch (error) {
    console.error('List reports error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/reports - create/generate report
router.post('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const { period, startDate, endDate, comment, targetUserId } = req.body;

    if (!period || !startDate || !endDate) {
      res.status(400).json({ error: 'period, startDate, endDate are required' });
      return;
    }

    const reportUserId = targetUserId || userId;

    // Get user's manager
    const user = await prisma.user.findUnique({
      where: { id: reportUserId },
      select: { managerId: true, name: true },
    });

    if (!user?.managerId) {
      res.status(400).json({ error: 'User has no manager assigned' });
      return;
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Fetch DONE tasks in period
    const doneTasks = await prisma.task.findMany({
      where: {
        assigneeId: reportUserId,
        status: 'DONE',
        completedAt: { gte: start, lte: end },
      },
      include: {
        checklistItems: true,
        creator: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });

    // Categorize tasks into 3 levels
    const level1 = doneTasks.filter((t) => {
      const isManagerCreated = t.creatorId === user.managerId;
      const hasChecklist = t.checklistItems.length > 0;
      const allDone = t.checklistItems.every((c) => c.completed);
      return isManagerCreated && (!hasChecklist || allDone);
    });

    const level2 = doneTasks.filter((t) => {
      const isManagerCreated = t.creatorId === user.managerId;
      const hasChecklist = t.checklistItems.length > 0;
      const allDone = t.checklistItems.every((c) => c.completed);
      return isManagerCreated && hasChecklist && !allDone;
    });

    const level3 = doneTasks.filter((t) => t.creatorId === reportUserId);

    const report = await prisma.report.create({
      data: {
        userId: reportUserId,
        managerId: user.managerId,
        period,
        startDate: start,
        endDate: end,
        comment,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        manager: { select: { id: true, name: true, email: true } },
      },
    });

    // Notify manager
    const notification = await prisma.notification.create({
      data: {
        userId: user.managerId,
        type: NotificationType.REPORT_SUBMITTED,
        message: `${user.name} отправил отчёт за период ${period}`,
      },
    });
    broadcastToUser(user.managerId, { type: 'notification', data: notification });

    res.status(201).json({
      ...report,
      tasks: {
        level1,
        level2,
        level3,
        total: doneTasks.length,
      },
    });
  } catch (error) {
    console.error('Create report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/reports/:id
router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const report = await prisma.report.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
        manager: { select: { id: true, name: true, email: true } },
      },
    });

    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    // Fetch done tasks for this period
    const doneTasks = await prisma.task.findMany({
      where: {
        assigneeId: report.userId,
        status: 'DONE',
        completedAt: { gte: report.startDate, lte: report.endDate },
      },
      include: {
        checklistItems: true,
        creator: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });

    const level1 = doneTasks.filter((t) => {
      const isManagerCreated = t.creatorId === report.managerId;
      const hasChecklist = t.checklistItems.length > 0;
      const allDone = t.checklistItems.every((c) => c.completed);
      return isManagerCreated && (!hasChecklist || allDone);
    });

    const level2 = doneTasks.filter((t) => {
      const isManagerCreated = t.creatorId === report.managerId;
      const hasChecklist = t.checklistItems.length > 0;
      const allDone = t.checklistItems.every((c) => c.completed);
      return isManagerCreated && hasChecklist && !allDone;
    });

    const level3 = doneTasks.filter((t) => t.creatorId === report.userId);

    res.json({ ...report, tasks: { level1, level2, level3, total: doneTasks.length } });
  } catch (error) {
    console.error('Get report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/reports/:id/comment - user adds comment
router.put('/:id/comment', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { comment } = req.body;
    const userId = req.user!.userId;

    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    if (report.userId !== userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const updated = await prisma.report.update({
      where: { id },
      data: { comment },
    });

    res.json(updated);
  } catch (error) {
    console.error('Update report comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/reports/:id/approve - manager approves
router.put('/:id/approve', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { approverComment } = req.body;
    const userId = req.user!.userId;

    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    if (report.managerId !== userId) {
      res.status(403).json({ error: 'Only the assigned manager can approve' });
      return;
    }

    const updated = await prisma.report.update({
      where: { id },
      data: {
        approved: true,
        approverComment,
        approvedAt: new Date(),
      },
    });

    // Notify report owner
    const notification = await prisma.notification.create({
      data: {
        userId: report.userId,
        type: NotificationType.REPORT_APPROVED,
        message: `Ваш отчёт за период ${report.period} утверждён`,
      },
    });
    broadcastToUser(report.userId, { type: 'notification', data: notification });

    res.json(updated);
  } catch (error) {
    console.error('Approve report error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
