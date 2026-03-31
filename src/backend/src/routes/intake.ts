import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { prisma } from '../db';
import { requireAuth } from '../middleware/auth';
import { extractTasksFromText, routeTasks } from '../services/ai';
import { createNotification } from '../services/notifications';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = 'uploads/intake';
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.m4a', '.pdf', '.txt', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// GET /api/intake — list intakes
router.get('/', requireAuth, async (req, res) => {
  const intakes = await prisma.intake.findMany({
    where: req.user!.role === 'ADMIN' ? {} : { createdById: req.user!.id },
    include: {
      createdBy: { select: { id: true, name: true } },
      intakeTasks: {
        include: {
          task: { select: { id: true, title: true, status: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(intakes);
});

// GET /api/intake/:id
router.get('/:id', requireAuth, async (req, res) => {
  const intake = await prisma.intake.findUnique({
    where: { id: req.params.id },
    include: {
      createdBy: { select: { id: true, name: true } },
      intakeTasks: {
        include: {
          task: { select: { id: true, title: true, status: true } },
        },
      },
    },
  });
  if (!intake) {
    res.status(404).json({ error: 'Intake not found' });
    return;
  }
  res.json(intake);
});

// POST /api/intake/text — manual text intake
router.post('/text', requireAuth, async (req, res) => {
  const { text, title } = req.body;
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const intake = await prisma.intake.create({
    data: {
      createdById: req.user!.id,
      fileType: 'text',
      rawText: text,
      status: 'PROCESSING',
    },
  });

  // Process asynchronously
  processIntake(intake.id, text, req.user!.id).catch(err =>
    console.error('[intake] processing error:', err)
  );

  res.status(202).json({ id: intake.id, status: 'PROCESSING' });
});

// POST /api/intake/upload — file upload
router.post('/upload', requireAuth, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const ext = path.extname(file.originalname).toLowerCase();
  let fileType = 'unknown';
  if (['.mp3', '.wav', '.m4a'].includes(ext)) fileType = 'audio';
  else if (ext === '.pdf') fileType = 'pdf';
  else if (['.txt', '.md'].includes(ext)) fileType = 'text';

  const intake = await prisma.intake.create({
    data: {
      createdById: req.user!.id,
      fileType,
      filePath: file.path,
      originalName: file.originalname,
      status: 'PROCESSING',
    },
  });

  // Process asynchronously
  processFileIntake(intake.id, file.path, fileType, req.user!.id).catch(err =>
    console.error('[intake] file processing error:', err)
  );

  res.status(202).json({ id: intake.id, status: 'PROCESSING', fileType });
});

// POST /api/intake/:id/confirm — confirm selected intake tasks
router.post('/:id/confirm', requireAuth, async (req, res) => {
  const { confirmedTaskIds } = req.body; // array of IntakeTask IDs to confirm
  if (!confirmedTaskIds?.length) {
    res.status(400).json({ error: 'confirmedTaskIds is required' });
    return;
  }

  const intake = await prisma.intake.findUnique({
    where: { id: req.params.id },
    include: { intakeTasks: true },
  });
  if (!intake) {
    res.status(404).json({ error: 'Intake not found' });
    return;
  }

  const created: string[] = [];
  for (const intakeTaskId of confirmedTaskIds) {
    const intakeTask = intake.intakeTasks.find(t => t.id === intakeTaskId);
    if (!intakeTask || !intakeTask.projectId || !intakeTask.assigneeId) continue;

    const task = await prisma.task.create({
      data: {
        title: intakeTask.title,
        description: intakeTask.description || undefined,
        projectId: intakeTask.projectId,
        assigneeId: intakeTask.assigneeId,
        creatorId: req.user!.id,
        status: 'BACKLOG',
        priority: 'MEDIUM',
        category: 'RUN',
      },
    });

    await prisma.intakeTask.update({
      where: { id: intakeTask.id },
      data: { confirmed: true, taskId: task.id },
    });

    // Notify assignee
    await createNotification(
      intakeTask.assigneeId,
      'TASK_ASSIGNED',
      `Новая задача из встречи: ${intakeTask.title}`,
      task.id
    );

    created.push(task.id);
  }

  await prisma.intake.update({
    where: { id: req.params.id },
    data: { status: 'MODERATED' },
  });

  res.json({ created, count: created.length });
});

// POST /api/intake/:id/update-task — update a suggested intake task before confirmation
router.patch('/:id/tasks/:taskId', requireAuth, async (req, res) => {
  const { title, description, assigneeId, projectId } = req.body;
  const intakeTask = await prisma.intakeTask.update({
    where: { id: req.params.taskId },
    data: {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(assigneeId !== undefined && { assigneeId }),
      ...(projectId !== undefined && { projectId }),
    },
  });
  res.json(intakeTask);
});

// ─── Internal: process intake ─────────────────────────────────────────────────

async function processIntake(intakeId: string, text: string, createdById: string) {
  try {
    // Get all users and projects for routing
    const [users, projects] = await Promise.all([
      prisma.user.findMany({ select: { id: true, name: true } }),
      prisma.project.findMany({ select: { id: true, name: true, ownerId: true } }),
    ]);

    const meetingNotes = await extractTasksFromText(text);
    const routedTasks = await routeTasks(meetingNotes.tasks, users, projects);

    // Save meeting notes and tasks
    await prisma.intake.update({
      where: { id: intakeId },
      data: {
        meetingNotes: JSON.stringify(meetingNotes),
        status: 'READY_FOR_MODERATION',
        intakeTasks: {
          create: routedTasks.map(t => ({
            title: t.title,
            description: t.description,
            assigneeId: t.resolvedAssigneeId,
            projectId: t.resolvedProjectId,
          })),
        },
      },
    });

    // Notify creator that intake is ready for review
    await createNotification(
      createdById,
      'INTAKE_TASKS_READY',
      `Задачи извлечены и готовы к модерации (${routedTasks.length} задач)`,
    );
  } catch (err) {
    console.error('[intake] AI processing failed:', err);
    await prisma.intake.update({
      where: { id: intakeId },
      data: { status: 'FAILED' },
    });
  }
}

async function processFileIntake(intakeId: string, filePath: string, fileType: string, createdById: string) {
  try {
    let text = '';

    if (fileType === 'audio') {
      // Transcribe audio using OpenAI Whisper API or similar
      // For now, mark as needing manual transcript
      await prisma.intake.update({
        where: { id: intakeId },
        data: { status: 'READY_FOR_MODERATION' },
      });
      return;
    } else if (fileType === 'pdf') {
      // Parse PDF
      const pdfParse = await import('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse.default(buffer);
      text = data.text;
    } else if (fileType === 'text') {
      text = fs.readFileSync(filePath, 'utf-8');
    }

    if (text) {
      await prisma.intake.update({ where: { id: intakeId }, data: { rawText: text } });
      await processIntake(intakeId, text, createdById);
    }
  } catch (err) {
    console.error('[intake] file processing failed:', err);
    await prisma.intake.update({
      where: { id: intakeId },
      data: { status: 'FAILED' },
    });
  }
}

export default router;
