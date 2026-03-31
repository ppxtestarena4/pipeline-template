import { Router, Response } from 'express';
import prisma from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { TaskStatus, NotificationType } from '@prisma/client';
import { broadcastToUser } from '../services/ws';

const router = Router();

// GET /api/tasks
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { projectId, assigneeId, status, category, priority, parentId, search } = req.query;

    const where: Record<string, unknown> = {};

    if (projectId) where.projectId = projectId as string;
    if (assigneeId) where.assigneeId = assigneeId as string;
    if (status) where.status = status as string;
    if (category) where.category = category as string;
    if (priority) where.priority = priority as string;

    // Handle parentId: null means top-level only, specific id means children of that task
    if (parentId === 'null') {
      where.parentId = null;
    } else if (parentId) {
      where.parentId = parentId as string;
    }

    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const tasks = await prisma.task.findMany({
      where,
      include: {
        assignee: { select: { id: true, name: true, email: true, avatar: true } },
        creator: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
        _count: { select: { subtasks: true, comments: true, checklistItems: true } },
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });

    res.json(tasks);
  } catch (error) {
    console.error('List tasks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks
router.post('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      title,
      description,
      projectId,
      assigneeId,
      status,
      priority,
      category,
      dueDate,
      parentId,
      labels,
    } = req.body;
    const creatorId = req.user!.userId;

    if (!title || !projectId) {
      res.status(400).json({ error: 'title and projectId are required' });
      return;
    }

    const task = await prisma.task.create({
      data: {
        title,
        description,
        projectId,
        assigneeId,
        creatorId,
        status: status || TaskStatus.BACKLOG,
        priority: priority || 'MEDIUM',
        category: category || 'RUN',
        dueDate: dueDate ? new Date(dueDate) : undefined,
        parentId,
        labels: labels || [],
      },
      include: {
        assignee: { select: { id: true, name: true, email: true, avatar: true } },
        creator: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });

    // Log history
    await prisma.taskHistory.create({
      data: {
        taskId: task.id,
        userId: creatorId,
        action: 'CREATED',
        newValue: title,
      },
    });

    // Notify assignee
    if (assigneeId && assigneeId !== creatorId) {
      const notification = await prisma.notification.create({
        data: {
          userId: assigneeId,
          type: NotificationType.TASK_ASSIGNED,
          message: `Вам назначена задача: ${title}`,
          taskId: task.id,
        },
      });
      broadcastToUser(assigneeId, { type: 'notification', data: notification });
    }

    res.status(201).json(task);
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tasks/:id
router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        assignee: { select: { id: true, name: true, email: true, avatar: true } },
        creator: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
        subtasks: {
          include: {
            assignee: { select: { id: true, name: true, avatar: true } },
            _count: { select: { subtasks: true } },
          },
        },
        checklistItems: { orderBy: { createdAt: 'asc' } },
        comments: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        history: {
          include: {
            user: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    res.json(task);
  } catch (error) {
    console.error('Get task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/tasks/:id
router.put('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const {
      title,
      description,
      assigneeId,
      status,
      priority,
      category,
      dueDate,
      labels,
    } = req.body;

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (assigneeId !== undefined) updateData.assigneeId = assigneeId;
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (category !== undefined) updateData.category = category;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (labels !== undefined) updateData.labels = labels;

    // Set completedAt when status changes to DONE
    if (status === TaskStatus.DONE && existing.status !== TaskStatus.DONE) {
      updateData.completedAt = new Date();
    } else if (status && status !== TaskStatus.DONE && existing.status === TaskStatus.DONE) {
      updateData.completedAt = null;
    }

    const task = await prisma.task.update({
      where: { id },
      data: updateData,
      include: {
        assignee: { select: { id: true, name: true, email: true, avatar: true } },
        creator: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    });

    // Log history for status change
    if (status && status !== existing.status) {
      await prisma.taskHistory.create({
        data: {
          taskId: id,
          userId,
          action: 'STATUS_CHANGED',
          oldValue: existing.status,
          newValue: status,
        },
      });

      // Notify assignee
      if (task.assigneeId && task.assigneeId !== userId) {
        const notification = await prisma.notification.create({
          data: {
            userId: task.assigneeId,
            type: NotificationType.TASK_STATUS_CHANGED,
            message: `Статус задачи "${task.title}" изменён на ${status}`,
            taskId: id,
          },
        });
        broadcastToUser(task.assigneeId, { type: 'notification', data: notification });
      }
    }

    // Log history for assignee change
    if (assigneeId !== undefined && assigneeId !== existing.assigneeId) {
      await prisma.taskHistory.create({
        data: {
          taskId: id,
          userId,
          action: 'ASSIGNEE_CHANGED',
          oldValue: existing.assigneeId || '',
          newValue: assigneeId || '',
        },
      });

      if (assigneeId && assigneeId !== userId) {
        const notification = await prisma.notification.create({
          data: {
            userId: assigneeId,
            type: NotificationType.TASK_ASSIGNED,
            message: `Вам назначена задача: ${task.title}`,
            taskId: id,
          },
        });
        broadcastToUser(assigneeId, { type: 'notification', data: notification });
      }
    }

    res.json(task);
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    await prisma.task.delete({ where: { id } });

    res.json({ message: 'Task deleted' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/tasks/:id/status
router.put('/:id/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user!.userId;

    if (!status) {
      res.status(400).json({ error: 'status is required' });
      return;
    }

    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const updateData: Record<string, unknown> = { status };
    if (status === TaskStatus.DONE) {
      updateData.completedAt = new Date();
    } else if (existing.status === TaskStatus.DONE) {
      updateData.completedAt = null;
    }

    const task = await prisma.task.update({
      where: { id },
      data: updateData,
      include: {
        assignee: { select: { id: true, name: true, email: true, avatar: true } },
        project: { select: { id: true, name: true } },
      },
    });

    await prisma.taskHistory.create({
      data: {
        taskId: id,
        userId,
        action: 'STATUS_CHANGED',
        oldValue: existing.status,
        newValue: status,
      },
    });

    // WebSocket broadcast
    broadcastToUser(userId, { type: 'task_status_changed', data: { taskId: id, status } });

    if (task.assigneeId && task.assigneeId !== userId) {
      const notification = await prisma.notification.create({
        data: {
          userId: task.assigneeId,
          type: NotificationType.TASK_STATUS_CHANGED,
          message: `Статус задачи "${task.title}" изменён на ${status}`,
          taskId: id,
        },
      });
      broadcastToUser(task.assigneeId, { type: 'notification', data: notification });
    }

    res.json(task);
  } catch (error) {
    console.error('Update task status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks/:id/checklist
router.post('/:id/checklist', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { title } = req.body;

    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const item = await prisma.checklistItem.create({
      data: { taskId: id, title },
    });

    res.status(201).json(item);
  } catch (error) {
    console.error('Add checklist item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/tasks/:id/checklist/:itemId
router.put('/:id/checklist/:itemId', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { itemId } = req.params;
    const { title, completed } = req.body;

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (completed !== undefined) updateData.completed = completed;

    const item = await prisma.checklistItem.update({
      where: { id: itemId },
      data: updateData,
    });

    res.json(item);
  } catch (error) {
    console.error('Update checklist item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/tasks/:id/checklist/:itemId
router.delete('/:id/checklist/:itemId', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { itemId } = req.params;

    await prisma.checklistItem.delete({ where: { id: itemId } });

    res.json({ message: 'Checklist item deleted' });
  } catch (error) {
    console.error('Delete checklist item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tasks/:id/comments
router.post('/:id/comments', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user!.userId;

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const comment = await prisma.comment.create({
      data: { taskId: id, userId, content },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    // Check for @mentions
    const mentionRegex = /@(\w+)/g;
    let match;
    const task = await prisma.task.findUnique({ where: { id }, select: { title: true, assigneeId: true } });

    while ((match = mentionRegex.exec(content)) !== null) {
      const mentionedName = match[1];
      const mentionedUser = await prisma.user.findFirst({
        where: { name: { contains: mentionedName, mode: 'insensitive' } },
      });

      if (mentionedUser && mentionedUser.id !== userId) {
        const notification = await prisma.notification.create({
          data: {
            userId: mentionedUser.id,
            type: NotificationType.TASK_MENTIONED,
            message: `Вас упомянули в комментарии к задаче "${task?.title || id}"`,
            taskId: id,
          },
        });
        broadcastToUser(mentionedUser.id, { type: 'notification', data: notification });
      }
    }

    // Notify task assignee of new comment
    if (task?.assigneeId && task.assigneeId !== userId) {
      const notification = await prisma.notification.create({
        data: {
          userId: task.assigneeId,
          type: NotificationType.COMMENT_ADDED,
          message: `Новый комментарий к задаче "${task.title}"`,
          taskId: id,
        },
      });
      broadcastToUser(task.assigneeId, { type: 'notification', data: notification });
    }

    res.status(201).json(comment);
  } catch (error) {
    console.error('Add comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/tasks/:id/comments
router.get('/:id/comments', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const comments = await prisma.comment.findMany({
      where: { taskId: id },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json(comments);
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
