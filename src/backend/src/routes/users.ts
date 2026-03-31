import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { AuthRequest } from '../types';
import { UserRole, UserType } from '@prisma/client';

const router = Router();

// GET /api/users - list all users (MANAGER/ADMIN only)
router.get('/', authenticate, requireRole(UserRole.MANAGER, UserRole.ADMIN), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { role } = req.query;

    const where: Record<string, unknown> = {};
    if (role) {
      where.role = role as UserRole;
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        type: true,
        managerId: true,
        avatar: true,
        createdAt: true,
        manager: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    res.json(users);
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id - get user by id
router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        ownedProjects: {
          where: { archived: false },
          select: { id: true, name: true, description: true },
        },
        directReports: {
          select: { id: true, name: true, email: true, role: true, avatar: true },
        },
        manager: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const { password, apiToken, ...safeUser } = user;
    void password;
    void apiToken;
    res.json(safeUser);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id - update user
router.put('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, avatar, password } = req.body;

    // Only allow users to update themselves, or admins to update anyone
    if (req.user!.userId !== id && req.user!.role !== UserRole.ADMIN) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (avatar !== undefined) updateData.avatar = avatar;
    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        type: true,
        managerId: true,
        avatar: true,
        updatedAt: true,
      },
    });

    res.json(user);
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id/direct-reports - get direct reports with task stats
router.get('/:id/direct-reports', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const reports = await prisma.user.findMany({
      where: { managerId: id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatar: true,
        assignedTasks: {
          select: {
            id: true,
            status: true,
            priority: true,
            dueDate: true,
          },
        },
      },
    });

    const reportsWithStats = reports.map((r) => {
      const tasks = r.assignedTasks;
      return {
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role,
        avatar: r.avatar,
        taskStats: {
          total: tasks.length,
          done: tasks.filter((t) => t.status === 'DONE').length,
          inProgress: tasks.filter((t) => t.status === 'IN_PROGRESS').length,
          overdue: tasks.filter(
            (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'DONE'
          ).length,
        },
      };
    });

    res.json(reportsWithStats);
  } catch (error) {
    console.error('Get direct reports error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/:id/tasks - get tasks assigned to user
router.get('/:id/tasks', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, projectId } = req.query;

    const where: Record<string, unknown> = { assigneeId: id };
    if (status) where.status = status;
    if (projectId) where.projectId = projectId;

    const tasks = await prisma.task.findMany({
      where,
      include: {
        project: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json(tasks);
  } catch (error) {
    console.error('Get user tasks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users - create new user (ADMIN only)
router.post('/', authenticate, requireRole(UserRole.ADMIN), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, password, name, role, type, managerId, apiToken } = req.body;

    if (!email || !name) {
      res.status(400).json({ error: 'Email and name are required' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'User already exists' });
      return;
    }

    const createData: Record<string, unknown> = {
      email,
      name,
      role: role || UserRole.EMPLOYEE,
      type: type || UserType.HUMAN,
    };

    if (password) {
      createData.password = await bcrypt.hash(password, 10);
    }
    if (managerId) createData.managerId = managerId;
    if (apiToken) createData.apiToken = apiToken;

    const user = await prisma.user.create({
      data: createData as Parameters<typeof prisma.user.create>[0]['data'],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        type: true,
        managerId: true,
        avatar: true,
        createdAt: true,
      },
    });

    res.status(201).json(user);
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/users/:id/manager - set manager for user
router.put('/:id/manager', authenticate, requireRole(UserRole.ADMIN, UserRole.MANAGER), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { managerId } = req.body;

    const user = await prisma.user.update({
      where: { id },
      data: { managerId: managerId || null },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        managerId: true,
      },
    });

    res.json(user);
  } catch (error) {
    console.error('Set manager error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
