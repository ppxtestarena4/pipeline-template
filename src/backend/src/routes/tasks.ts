import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { TaskStatus } from '@prisma/client';
import { createNotification } from '../services/notifications';

const router = Router();

// GET /api/tasks — list tasks with filters
router.get('/', requireAuth, async (req, res) => {
  const {
    projectId, assigneeId, status, priority, category,
    parentTaskId, search, page = '1', limit = '50',
  } = req.query;

  const where: Record<string, unknown> = {};
  if (projectId) where.projectId = projectId;
  if (assigneeId) where.assigneeId = assigneeId;
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (category) where.category = category;
  if (parentTaskId === 'null') where.parentTaskId = null;
  else if (parentTaskId) where.parentTaskId = parentTaskId;
  if (search) where.title = { contains: search as string, mode: 'insensitive' };

  const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        assignee: { select: { id: true, name: true, avatarUrl: true } },
        creator: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        subtasks: {
          select: { id: true, title: true, completed: true, assigneeId: true },
          orderBy: { position: 'asc' },
        },
        _count: { select: { comments: true, subTasks: true } },
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      skip,
      take: parseInt(limit as string),
    }),
    prisma.task.count({ where }),
  ]);

  res.json({ tasks, total, page: parseInt(page as string), limit: parseInt(limit as string) });
});

// GET /api/tasks/:id
router.get('/:id', requireAuth, async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: {
      assignee: { select: { id: true, name: true, avatarUrl: true } },
      creator: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      subtasks: {
        include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { position: 'asc' },
      },
      subTasks: {
        include: {
          assignee: { select: { id: true, name: true, avatarUrl: true } },
          subtasks: true,
        },
        orderBy: { position: 'asc' },
      },
      comments: {
        include: { author: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { createdAt: 'asc' },
      },
      auditLogs: {
        include: { user: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      parentTask: { select: { id: true, title: true } },
    },
  });

  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

// POST /api/tasks
router.post('/', requireAuth, async (req, res) => {
  const {
    title, description, projectId, assigneeId, priority,
    category, deadline, parentTaskId, labels,
  } = req.body;

  if (!title || !projectId) {
    res.status(400).json({ error: 'title and projectId are required' });
    return;
  }

  // Get max position in the status column
  const maxPos = await prisma.task.aggregate({
    where: { projectId, status: 'BACKLOG', parentTaskId: parentTaskId || null },
    _max: { position: true },
  });

  const task = await prisma.task.create({
    data: {
      title,
      description,
      projectId,
      assigneeId: assigneeId || null,
      creatorId: req.user!.id,
      priority: priority || 'MEDIUM',
      category: category || 'RUN',
      deadline: deadline ? new Date(deadline) : null,
      parentTaskId: parentTaskId || null,
      labels: labels || [],
      position: (maxPos._max.position || 0) + 1,
    },
    include: {
      assignee: { select: { id: true, name: true, avatarUrl: true } },
      creator: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      subtasks: true,
    },
  });

  // Notify assignee
  if (assigneeId && assigneeId !== req.user!.id) {
    await createNotification(
      assigneeId,
      'TASK_ASSIGNED',
      `Вам назначена задача: ${title}`,
      task.id
    );
  }

  res.status(201).json(task);
});

// PATCH /api/tasks/:id
router.patch('/:id', requireAuth, async (req, res) => {
  const {
    title, description, status, assigneeId, priority,
    category, deadline, labels, position,
  } = req.body;

  const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (status !== undefined) updates.status = status;
  if (assigneeId !== undefined) updates.assigneeId = assigneeId || null;
  if (priority !== undefined) updates.priority = priority;
  if (category !== undefined) updates.category = category;
  if (deadline !== undefined) updates.deadline = deadline ? new Date(deadline) : null;
  if (labels !== undefined) updates.labels = labels;
  if (position !== undefined) updates.position = position;

  // Set completedAt when moving to Done
  if (status === 'DONE' && existing.status !== 'DONE') {
    updates.completedAt = new Date();
  } else if (status !== undefined && status !== 'DONE' && existing.status === 'DONE') {
    updates.completedAt = null;
  }

  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: updates,
    include: {
      assignee: { select: { id: true, name: true, avatarUrl: true } },
      creator: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      subtasks: true,
      _count: { select: { comments: true } },
    },
  });

  // Audit log for status change
  if (status !== undefined && status !== existing.status) {
    await prisma.auditLog.create({
      data: {
        taskId: task.id,
        userId: req.user!.id,
        action: 'status_changed',
        oldValue: existing.status,
        newValue: status,
      },
    });

    // Notify assignee about status change
    if (task.assigneeId && task.assigneeId !== req.user!.id) {
      await createNotification(
        task.assigneeId,
        'TASK_STATUS_CHANGED',
        `Статус задачи «${task.title}» изменён на ${status}`,
        task.id
      );
    }
  }

  // Notify new assignee
  if (assigneeId && assigneeId !== existing.assigneeId && assigneeId !== req.user!.id) {
    await createNotification(
      assigneeId,
      'TASK_ASSIGNED',
      `Вам назначена задача: ${task.title}`,
      task.id
    );
  }

  res.json(task);
});

// POST /api/tasks/:id/move — move task between kanban columns (for AI agents)
router.post('/:id/move', requireAuth, async (req, res) => {
  const { status } = req.body;
  if (!status) {
    res.status(400).json({ error: 'status is required' });
    return;
  }

  const existing = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const updates: Record<string, unknown> = { status };
  if (status === 'DONE') updates.completedAt = new Date();

  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: updates,
    include: {
      assignee: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      taskId: task.id,
      userId: req.user!.id,
      action: 'status_changed',
      oldValue: existing.status,
      newValue: status,
    },
  });

  res.json(task);
});

// DELETE /api/tasks/:id
router.delete('/:id', requireAuth, async (req, res) => {
  await prisma.task.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// ─── Subtasks ────────────────────────────────────────────────────────────────

// GET /api/tasks/:id/subtasks
router.get('/:id/subtasks', requireAuth, async (req, res) => {
  const subtasks = await prisma.subtask.findMany({
    where: { taskId: req.params.id },
    include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { position: 'asc' },
  });
  res.json(subtasks);
});

// POST /api/tasks/:id/subtasks
router.post('/:id/subtasks', requireAuth, async (req, res) => {
  const { title, assigneeId } = req.body;
  if (!title) {
    res.status(400).json({ error: 'title is required' });
    return;
  }

  const maxPos = await prisma.subtask.aggregate({
    where: { taskId: req.params.id },
    _max: { position: true },
  });

  const subtask = await prisma.subtask.create({
    data: {
      taskId: req.params.id,
      title,
      assigneeId: assigneeId || null,
      position: (maxPos._max.position || 0) + 1,
    },
    include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
  });
  res.status(201).json(subtask);
});

// PATCH /api/tasks/:taskId/subtasks/:subtaskId
router.patch('/:taskId/subtasks/:subtaskId', requireAuth, async (req, res) => {
  const { title, completed, assigneeId } = req.body;
  const subtask = await prisma.subtask.update({
    where: { id: req.params.subtaskId },
    data: {
      ...(title !== undefined && { title }),
      ...(completed !== undefined && { completed }),
      ...(assigneeId !== undefined && { assigneeId }),
    },
    include: { assignee: { select: { id: true, name: true, avatarUrl: true } } },
  });
  res.json(subtask);
});

// DELETE /api/tasks/:taskId/subtasks/:subtaskId
router.delete('/:taskId/subtasks/:subtaskId', requireAuth, async (req, res) => {
  await prisma.subtask.delete({ where: { id: req.params.subtaskId } });
  res.status(204).send();
});

// ─── Comments ────────────────────────────────────────────────────────────────

// POST /api/tasks/:id/comments
router.post('/:id/comments', requireAuth, async (req, res) => {
  const { content } = req.body;
  if (!content) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const comment = await prisma.comment.create({
    data: { taskId: req.params.id, authorId: req.user!.id, content },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });

  // Notify task assignee about comment (if different from commenter)
  if (task.assigneeId && task.assigneeId !== req.user!.id) {
    await createNotification(
      task.assigneeId,
      'TASK_MENTIONED',
      `Новый комментарий к задаче «${task.title}»`,
      task.id
    );
  }

  // Parse @mentions and notify mentioned users
  const mentions = content.match(/@(\w+)/g) || [];
  for (const mention of mentions) {
    const name = mention.slice(1);
    const mentioned = await prisma.user.findFirst({
      where: { name: { contains: name, mode: 'insensitive' } },
    });
    if (mentioned && mentioned.id !== req.user!.id) {
      await createNotification(
        mentioned.id,
        'TASK_MENTIONED',
        `Вас упомянули в комментарии к задаче «${task.title}»`,
        task.id
      );
    }
  }

  res.status(201).json(comment);
});

// GET /api/tasks/kanban — kanban view grouped by status
router.get('/kanban/board', requireAuth, async (req, res) => {
  const { projectId, assigneeId, category } = req.query;

  const where: Record<string, unknown> = { parentTaskId: null };
  if (projectId) where.projectId = projectId;
  if (assigneeId) where.assigneeId = assigneeId;
  if (category) where.category = category;

  const tasks = await prisma.task.findMany({
    where,
    include: {
      assignee: { select: { id: true, name: true, avatarUrl: true } },
      creator: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      subtasks: { select: { id: true, completed: true } },
      _count: { select: { comments: true, subTasks: true } },
    },
    orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
  });

  const columns: Record<TaskStatus, typeof tasks> = {
    BACKLOG: [],
    TODO: [],
    IN_PROGRESS: [],
    REVIEW: [],
    TESTING: [],
    DONE: [],
  };

  for (const task of tasks) {
    columns[task.status].push(task);
  }

  res.json(columns);
});

export default router;
