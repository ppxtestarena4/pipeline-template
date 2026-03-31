import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import prisma from '../db';
import { authenticate } from '../middleware/auth';
import { AuthRequest } from '../types';
import { InboxStatus, ExtractedTaskStatus, NotificationType } from '@prisma/client';
import { extractTasksFromText } from '../services/claude';
import { broadcastToUser } from '../services/ws';

const router = Router();

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

async function triggerExtraction(inboxItemId: string, userId: string): Promise<void> {
  try {
    const item = await prisma.inboxItem.findUnique({ where: { id: inboxItemId } });
    if (!item) return;

    const text = item.transcript || item.originalText || '';
    if (!text.trim()) return;

    await prisma.inboxItem.update({
      where: { id: inboxItemId },
      data: { status: InboxStatus.PROCESSING },
    });

    // Get team context
    const teamMembers = await prisma.user.findMany({
      where: { type: 'HUMAN' },
      select: { id: true, name: true },
    });

    const projects = await prisma.project.findMany({
      where: { archived: false },
      select: { id: true, name: true, ownerId: true },
    });

    const result = await extractTasksFromText(text, teamMembers, projects);

    // Save extracted tasks
    for (const taskData of result.tasks) {
      // Try to match suggested assignee
      let suggestedAssigneeId: string | undefined;
      if (taskData.suggestedAssigneeName) {
        const matched = teamMembers.find(
          (m) => m.name.toLowerCase().includes(taskData.suggestedAssigneeName!.toLowerCase())
        );
        if (matched) suggestedAssigneeId = matched.id;
      }

      let suggestedProjectId: string | undefined;
      if (taskData.suggestedProjectName) {
        const matched = projects.find(
          (p) => p.name.toLowerCase().includes(taskData.suggestedProjectName!.toLowerCase())
        );
        if (matched) suggestedProjectId = matched.id;
      }

      await prisma.extractedTask.create({
        data: {
          inboxItemId,
          title: taskData.title,
          description: taskData.description,
          suggestedAssigneeId,
          suggestedProjectId,
          dueDate: taskData.dueDate ? new Date(taskData.dueDate) : undefined,
          category: taskData.category,
          priority: taskData.priority,
        },
      });
    }

    await prisma.inboxItem.update({
      where: { id: inboxItemId },
      data: {
        status: InboxStatus.EXTRACTED,
        meetingNotes: result.meetingNotes,
      },
    });

    // Notify user
    const notification = await prisma.notification.create({
      data: {
        userId,
        type: NotificationType.INBOX_PROCESSED,
        message: `Обработка завершена: извлечено ${result.tasks.length} задач`,
      },
    });
    broadcastToUser(userId, { type: 'notification', data: notification });
  } catch (error) {
    console.error('Extraction error:', error);
    await prisma.inboxItem.update({
      where: { id: inboxItemId },
      data: { status: InboxStatus.PENDING },
    });
  }
}

async function transcribeAudio(filePath: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const fileStream = fs.createReadStream(filePath);
    const transcription = await openai.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-1',
    });

    return transcription.text;
  } catch (error) {
    console.error('Transcription error:', error);
    return null;
  }
}

async function extractPdfText(filePath: string): Promise<string> {
  try {
    const pdfParse = await import('pdf-parse');
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse.default(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('PDF parse error:', error);
    return '';
  }
}

// POST /api/intake/upload
router.post('/upload', authenticate, upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const userId = req.user!.userId;
    const { projectId } = req.body;
    const { filename, mimetype, originalname, path: filePath } = req.file;

    const fileUrl = `/uploads/${filename}`;
    const isAudio = mimetype.startsWith('audio/') || ['.mp3', '.wav', '.m4a'].includes(path.extname(originalname).toLowerCase());
    const isPdf = mimetype === 'application/pdf' || path.extname(originalname).toLowerCase() === '.pdf';
    const isText = mimetype.startsWith('text/') || ['.txt', '.md'].includes(path.extname(originalname).toLowerCase());

    const inboxItem = await prisma.inboxItem.create({
      data: {
        userId,
        projectId: projectId || undefined,
        fileName: originalname,
        fileUrl,
        fileType: mimetype,
        status: InboxStatus.PENDING,
      },
    });

    // Process asynchronously
    setImmediate(async () => {
      let text = '';

      if (isText) {
        text = fs.readFileSync(filePath, 'utf-8');
        await prisma.inboxItem.update({
          where: { id: inboxItem.id },
          data: { originalText: text },
        });
      } else if (isPdf) {
        text = await extractPdfText(filePath);
        await prisma.inboxItem.update({
          where: { id: inboxItem.id },
          data: { originalText: text },
        });
      } else if (isAudio) {
        const transcript = await transcribeAudio(filePath);
        if (transcript) {
          text = transcript;
          await prisma.inboxItem.update({
            where: { id: inboxItem.id },
            data: { transcript },
          });
        }
      }

      if (text.trim()) {
        await triggerExtraction(inboxItem.id, userId);
      }
    });

    res.status(201).json(inboxItem);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/intake/text
router.post('/text', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { text, projectId } = req.body;
    const userId = req.user!.userId;

    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const inboxItem = await prisma.inboxItem.create({
      data: {
        userId,
        projectId: projectId || undefined,
        originalText: text,
        status: InboxStatus.PENDING,
      },
    });

    // Trigger extraction asynchronously
    setImmediate(() => {
      triggerExtraction(inboxItem.id, userId);
    });

    res.status(201).json(inboxItem);
  } catch (error) {
    console.error('Create text inbox error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/intake
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.userId;

    const items = await prisma.inboxItem.findMany({
      where: { userId },
      include: {
        extractedTasks: true,
        project: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(items);
  } catch (error) {
    console.error('List inbox error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/intake/:id
router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const item = await prisma.inboxItem.findUnique({
      where: { id },
      include: {
        extractedTasks: true,
        project: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!item) {
      res.status(404).json({ error: 'Inbox item not found' });
      return;
    }

    // Enrich extracted tasks with user names
    const enriched = await Promise.all(
      item.extractedTasks.map(async (et) => {
        let assigneeName: string | undefined;
        let projectName: string | undefined;

        if (et.suggestedAssigneeId) {
          const u = await prisma.user.findUnique({
            where: { id: et.suggestedAssigneeId },
            select: { name: true },
          });
          assigneeName = u?.name;
        }
        if (et.suggestedProjectId) {
          const p = await prisma.project.findUnique({
            where: { id: et.suggestedProjectId },
            select: { name: true },
          });
          projectName = p?.name;
        }

        return { ...et, assigneeName, projectName };
      })
    );

    res.json({ ...item, extractedTasks: enriched });
  } catch (error) {
    console.error('Get inbox item error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/intake/:id/extract
router.post('/:id/extract', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const item = await prisma.inboxItem.findUnique({ where: { id } });
    if (!item) {
      res.status(404).json({ error: 'Inbox item not found' });
      return;
    }

    // Delete existing extracted tasks
    await prisma.extractedTask.deleteMany({ where: { inboxItemId: id } });

    setImmediate(() => {
      triggerExtraction(id, userId);
    });

    res.json({ message: 'Extraction started' });
  } catch (error) {
    console.error('Trigger extraction error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/intake/:id/extracted/:taskId
router.put('/:id/extracted/:taskId', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { taskId } = req.params;
    const { title, description, suggestedAssigneeId, suggestedProjectId, dueDate, category, priority } = req.body;

    const updateData: Record<string, unknown> = { status: ExtractedTaskStatus.EDITED };
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (suggestedAssigneeId !== undefined) updateData.suggestedAssigneeId = suggestedAssigneeId;
    if (suggestedProjectId !== undefined) updateData.suggestedProjectId = suggestedProjectId;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (category !== undefined) updateData.category = category;
    if (priority !== undefined) updateData.priority = priority;

    const task = await prisma.extractedTask.update({
      where: { id: taskId },
      data: updateData,
    });

    res.json(task);
  } catch (error) {
    console.error('Update extracted task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/intake/:id/extracted/:taskId
router.delete('/:id/extracted/:taskId', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { taskId } = req.params;

    await prisma.extractedTask.update({
      where: { id: taskId },
      data: { status: ExtractedTaskStatus.DELETED },
    });

    res.json({ message: 'Extracted task deleted' });
  } catch (error) {
    console.error('Delete extracted task error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/intake/:id/confirm
router.post('/:id/confirm', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { taskIds } = req.body; // array of extracted task IDs to confirm
    const userId = req.user!.userId;

    const extractedTasks = await prisma.extractedTask.findMany({
      where: {
        inboxItemId: id,
        id: { in: taskIds },
        status: { not: ExtractedTaskStatus.DELETED },
      },
    });

    const createdTasks = [];

    for (const et of extractedTasks) {
      if (!et.suggestedProjectId) continue;

      const task = await prisma.task.create({
        data: {
          title: et.title,
          description: et.description,
          projectId: et.suggestedProjectId,
          assigneeId: et.suggestedAssigneeId || undefined,
          creatorId: userId,
          dueDate: et.dueDate || undefined,
          category: et.category,
          priority: et.priority,
          status: 'BACKLOG',
          labels: [],
        },
      });

      await prisma.extractedTask.update({
        where: { id: et.id },
        data: { status: ExtractedTaskStatus.CONFIRMED, taskId: task.id },
      });

      // Notify assignee
      if (et.suggestedAssigneeId && et.suggestedAssigneeId !== userId) {
        const notification = await prisma.notification.create({
          data: {
            userId: et.suggestedAssigneeId,
            type: NotificationType.NEW_TASK_IN_BACKLOG,
            message: `Новая задача в беклоге: ${et.title}`,
            taskId: task.id,
          },
        });
        broadcastToUser(et.suggestedAssigneeId, { type: 'notification', data: notification });
      }

      createdTasks.push(task);
    }

    await prisma.inboxItem.update({
      where: { id },
      data: { status: InboxStatus.MODERATED },
    });

    res.json({ created: createdTasks.length, tasks: createdTasks });
  } catch (error) {
    console.error('Confirm tasks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
