import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { createNotification } from '../services/notifications';

const router = Router();

/**
 * Classify a task into the 3-level hierarchy:
 * Level 1: assigned by manager AND fully completed (all subtasks done)
 * Level 2: assigned by manager AND partially done
 * Level 3: self-created/assigned AND done
 */
function classifyTask(task: {
  creatorId: string;
  assigneeId: string | null;
  subtasks: { completed: boolean }[];
}, viewerId: string) {
  const isFromManager = task.creatorId !== task.assigneeId && task.creatorId !== viewerId;
  const total = task.subtasks.length;
  const done = task.subtasks.filter(s => s.completed).length;
  const fullyDone = total === 0 || done === total;

  if (isFromManager && fullyDone) return 1;
  if (isFromManager && !fullyDone) return 2;
  return 3;
}

// GET /api/reports — list reports
router.get('/', requireAuth, async (req, res) => {
  const { userId, periodStart, periodEnd, status } = req.query;
  const currentUser = req.user!;

  const where: Record<string, unknown> = {};

  if (userId) {
    where.userId = userId;
  } else if (currentUser.role === 'EMPLOYEE') {
    where.userId = currentUser.id;
  }
  // Managers see all reports under their direct reports
  else if (currentUser.role === 'MANAGER' || currentUser.role === 'ADMIN') {
    const reports = await prisma.user.findMany({
      where: { managerId: currentUser.id },
      select: { id: true },
    });
    where.userId = { in: [currentUser.id, ...reports.map(r => r.id)] };
  }

  if (periodStart) where.periodStart = { gte: new Date(periodStart as string) };
  if (periodEnd) where.periodEnd = { lte: new Date(periodEnd as string) };
  if (status) where.status = status;

  const result = await prisma.report.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
      approvedBy: { select: { id: true, name: true } },
    },
    orderBy: { periodStart: 'desc' },
  });

  res.json(result);
});

// GET /api/reports/generate — auto-generate report data (tasks for period)
router.get('/generate', requireAuth, async (req, res) => {
  const { userId, periodStart, periodEnd, projectId } = req.query;

  const targetUserId = (userId as string) || req.user!.id;
  const start = new Date(periodStart as string || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const end = new Date(periodEnd as string || new Date());

  const doneTasks = await prisma.task.findMany({
    where: {
      assigneeId: targetUserId,
      status: 'DONE',
      completedAt: { gte: start, lte: end },
      parentTaskId: null,
      ...(projectId && { projectId: projectId as string }),
    },
    include: {
      subtasks: { select: { id: true, completed: true, title: true } },
      creator: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
    },
    orderBy: { completedAt: 'desc' },
  });

  const inProgressTasks = await prisma.task.findMany({
    where: {
      assigneeId: targetUserId,
      status: { in: ['IN_PROGRESS', 'REVIEW', 'TESTING'] },
      parentTaskId: null,
      ...(projectId && { projectId: projectId as string }),
    },
    include: {
      subtasks: { select: { id: true, completed: true, title: true } },
      project: { select: { id: true, name: true } },
    },
  });

  const blockedTasks = await prisma.task.findMany({
    where: {
      assigneeId: targetUserId,
      labels: { has: 'blocked' },
      status: { not: 'DONE' },
      ...(projectId && { projectId: projectId as string }),
    },
    include: {
      project: { select: { id: true, name: true } },
    },
  });

  // Classify done tasks by 3-level hierarchy
  const level1: typeof doneTasks = [];
  const level2: typeof doneTasks = [];
  const level3: typeof doneTasks = [];

  for (const task of doneTasks) {
    const level = classifyTask(task, req.user!.id);
    if (level === 1) level1.push(task);
    else if (level === 2) level2.push(task);
    else level3.push(task);
  }

  // Metrics
  const totalDone = doneTasks.length;
  const totalInProgress = inProgressTasks.length;
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, name: true, managerId: true },
  });

  res.json({
    userId: targetUserId,
    user,
    periodStart: start,
    periodEnd: end,
    metrics: {
      totalDone,
      totalInProgress,
      totalBlocked: blockedTasks.length,
    },
    level1,
    level2,
    level3,
    inProgress: inProgressTasks,
    blocked: blockedTasks,
  });
});

// GET /api/reports/:id
router.get('/:id', requireAuth, async (req, res) => {
  const report = await prisma.report.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, name: true, avatarUrl: true } },
      approvedBy: { select: { id: true, name: true } },
    },
  });
  if (!report) {
    res.status(404).json({ error: 'Report not found' });
    return;
  }
  res.json(report);
});

// POST /api/reports — create/submit report
router.post('/', requireAuth, async (req, res) => {
  const { periodStart, periodEnd, comment } = req.body;
  if (!periodStart || !periodEnd) {
    res.status(400).json({ error: 'periodStart and periodEnd are required' });
    return;
  }

  const report = await prisma.report.create({
    data: {
      userId: req.user!.id,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      comment,
      status: 'SUBMITTED',
    },
    include: {
      user: { select: { id: true, name: true } },
    },
  });

  // Notify manager
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { managerId: true, name: true },
  });
  if (user?.managerId) {
    await createNotification(
      user.managerId,
      'REPORT_SUBMITTED',
      `${user.name} сдал(а) еженедельный отчёт`,
    );
  }

  res.status(201).json(report);
});

// PATCH /api/reports/:id — update comment or approve
router.patch('/:id', requireAuth, async (req, res) => {
  const { comment, status, managerComment } = req.body;

  const report = await prisma.report.update({
    where: { id: req.params.id },
    data: {
      ...(comment !== undefined && { comment }),
      ...(status !== undefined && { status }),
      ...(managerComment !== undefined && { managerComment }),
      ...(status === 'APPROVED' && { approvedById: req.user!.id }),
    },
    include: {
      user: { select: { id: true, name: true } },
    },
  });

  if (status === 'APPROVED' || status === 'COMMENTED') {
    await createNotification(
      report.userId,
      status === 'APPROVED' ? 'REPORT_APPROVED' : 'REPORT_COMMENTED',
      status === 'APPROVED'
        ? 'Ваш отчёт утверждён'
        : `Руководитель оставил комментарий к вашему отчёту`,
    );
  }

  res.json(report);
});

export default router;
