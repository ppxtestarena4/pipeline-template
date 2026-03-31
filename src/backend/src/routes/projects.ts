import { Router } from 'express';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();

// GET /api/projects — projects visible to current user
router.get('/', requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const role = req.user!.role;

  let projects;
  if (role === 'ADMIN' || role === 'MANAGER') {
    // Managers see all projects under their direct reports (and their own)
    const directReports = await prisma.user.findMany({
      where: { managerId: userId },
      select: { id: true },
    });
    const reportIds = directReports.map(u => u.id);

    projects = await prisma.project.findMany({
      where: {
        OR: [
          { ownerId: userId },
          { ownerId: { in: reportIds } },
          { members: { some: { userId } } },
        ],
        archived: req.query.archived === 'true' ? true : false,
      },
      include: {
        owner: { select: { id: true, name: true, avatarUrl: true } },
        members: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
        _count: { select: { tasks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  } else {
    projects = await prisma.project.findMany({
      where: {
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
        ],
        archived: req.query.archived === 'true' ? true : false,
      },
      include: {
        owner: { select: { id: true, name: true, avatarUrl: true } },
        members: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
        _count: { select: { tasks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  res.json(projects);
});

// GET /api/projects/:id
router.get('/:id', requireAuth, async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      owner: { select: { id: true, name: true, avatarUrl: true } },
      members: { include: { user: { select: { id: true, name: true, role: true, avatarUrl: true } } } },
      _count: { select: { tasks: true } },
    },
  });
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json(project);
});

// POST /api/projects
router.post('/', requireAuth, async (req, res) => {
  const { name, description, memberIds } = req.body;
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const project = await prisma.project.create({
    data: {
      name,
      description,
      ownerId: req.user!.id,
      members: memberIds?.length
        ? { create: [{ userId: req.user!.id }, ...memberIds.map((id: string) => ({ userId: id }))] }
        : { create: [{ userId: req.user!.id }] },
    },
    include: {
      owner: { select: { id: true, name: true, avatarUrl: true } },
      members: { include: { user: { select: { id: true, name: true, avatarUrl: true } } } },
    },
  });
  res.status(201).json(project);
});

// PATCH /api/projects/:id
router.patch('/:id', requireAuth, async (req, res) => {
  const { name, description, archived, memberIds } = req.body;

  const project = await prisma.project.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(archived !== undefined && { archived }),
    },
    include: {
      owner: { select: { id: true, name: true } },
      members: { include: { user: { select: { id: true, name: true } } } },
    },
  });

  // Update members if provided
  if (memberIds !== undefined) {
    await prisma.projectMember.deleteMany({ where: { projectId: project.id } });
    const allMemberIds = [project.ownerId, ...memberIds].filter(
      (v, i, a) => a.indexOf(v) === i
    );
    await prisma.projectMember.createMany({
      data: allMemberIds.map((userId: string) => ({ projectId: project.id, userId })),
      skipDuplicates: true,
    });
  }

  res.json(project);
});

// DELETE /api/projects/:id — archive only
router.delete('/:id', requireAuth, async (req, res) => {
  await prisma.project.update({
    where: { id: req.params.id },
    data: { archived: true },
  });
  res.status(204).send();
});

// GET /api/projects/:id/stats
router.get('/:id/stats', requireAuth, async (req, res) => {
  const tasks = await prisma.task.groupBy({
    by: ['status'],
    where: { projectId: req.params.id },
    _count: { id: true },
  });

  const total = tasks.reduce((sum, t) => sum + t._count.id, 0);
  const done = tasks.find(t => t.status === 'DONE')?._count.id || 0;

  res.json({
    total,
    done,
    progress: total > 0 ? Math.round((done / total) * 100) : 0,
    byStatus: Object.fromEntries(tasks.map(t => [t.status, t._count.id])),
  });
});

export default router;
