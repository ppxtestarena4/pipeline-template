import { Router, Response } from 'express';
import prisma from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { UserRole } from '@prisma/client';

const router = Router();

// GET /api/projects
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;
    const role = req.user!.role;

    let where: Record<string, unknown> = { archived: false };

    // MANAGER and ADMIN see all projects; others see only their own
    if (role !== UserRole.MANAGER && role !== UserRole.ADMIN) {
      where = {
        archived: false,
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
        ],
      };
    }

    const projects = await prisma.project.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
        },
        _count: { select: { tasks: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    res.json(projects);
  } catch (error) {
    console.error('List projects error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects
router.post('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, description, memberIds } = req.body;
    const userId = req.user!.userId;

    if (!name) {
      res.status(400).json({ error: 'Project name is required' });
      return;
    }

    const membersToAdd = Array.isArray(memberIds) ? memberIds : [];
    if (!membersToAdd.includes(userId)) {
      membersToAdd.push(userId);
    }

    const project = await prisma.project.create({
      data: {
        name,
        description,
        ownerId: userId,
        members: {
          create: membersToAdd.map((id: string) => ({ userId: id })),
        },
      },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
        },
      },
    });

    res.status(201).json(project);
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id
router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        members: {
          include: { user: { select: { id: true, name: true, email: true, avatar: true } } },
        },
        _count: {
          select: {
            tasks: true,
          },
        },
      },
    });

    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Count tasks by status
    const taskCounts = await prisma.task.groupBy({
      by: ['status'],
      where: { projectId: id },
      _count: { status: true },
    });

    res.json({ ...project, taskCounts });
  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/projects/:id
router.put('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const userId = req.user!.userId;
    const role = req.user!.role;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (project.ownerId !== userId && role !== UserRole.ADMIN && role !== UserRole.MANAGER) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const updated = await prisma.project.update({
      where: { id },
      data: { name, description },
    });

    res.json(updated);
  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id - archive project
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;
    const role = req.user!.role;

    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (project.ownerId !== userId && role !== UserRole.ADMIN && role !== UserRole.MANAGER) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    await prisma.project.update({ where: { id }, data: { archived: true } });

    res.json({ message: 'Project archived' });
  } catch (error) {
    console.error('Archive project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/members
router.post('/:id/members', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { userId: memberUserId } = req.body;

    if (!memberUserId) {
      res.status(400).json({ error: 'userId is required' });
      return;
    }

    const existing = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId: memberUserId } },
    });

    if (existing) {
      res.status(409).json({ error: 'User is already a member' });
      return;
    }

    await prisma.projectMember.create({
      data: { projectId: id, userId: memberUserId },
    });

    res.status(201).json({ message: 'Member added' });
  } catch (error) {
    console.error('Add member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id/members/:userId
router.delete('/:id/members/:userId', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, userId: memberUserId } = req.params;

    await prisma.projectMember.delete({
      where: { projectId_userId: { projectId: id, userId: memberUserId } },
    });

    res.json({ message: 'Member removed' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
