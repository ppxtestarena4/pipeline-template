import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export interface ExtractedTaskData {
  title: string;
  description?: string;
  suggestedAssigneeName?: string;
  suggestedProjectName?: string;
  dueDate?: string;
  category: 'RUN' | 'CHANGE';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface ExtractionResult {
  tasks: ExtractedTaskData[];
  meetingNotes: string;
}

export async function extractTasksFromText(
  text: string,
  teamMembers: Array<{ id: string; name: string }>,
  projects: Array<{ id: string; name: string; ownerId: string }>
): Promise<ExtractionResult> {
  const anthropic = getClient();

  if (!anthropic) {
    return {
      tasks: [],
      meetingNotes: text,
    };
  }

  const teamList = teamMembers.map((m) => `- ${m.name}`).join('\n');
  const projectList = projects.map((p) => `- ${p.name}`).join('\n');

  const prompt = `Ты помощник по управлению задачами. Проанализируй следующий текст (транскрипт встречи, заметки или сообщение) и:

1. Извлеки все задачи, поручения и действия (action items)
2. Определи ответственных исполнителей из списка команды
3. Определи дедлайны (если упоминаются)
4. Классифицируй каждую задачу:
   - RUN: операционные задачи (рутина, поддержка, текущие процессы)
   - CHANGE: стратегические задачи (новые инициативы, изменения, улучшения)
5. Определи приоритет: CRITICAL, HIGH, MEDIUM, LOW
6. Сопоставь задачи с проектами команды
7. Составь структурированные заметки встречи

Члены команды:
${teamList}

Проекты:
${projectList}

Текст для анализа:
"""
${text}
"""

Верни ТОЛЬКО валидный JSON в следующем формате:
{
  "tasks": [
    {
      "title": "Название задачи",
      "description": "Подробное описание",
      "suggestedAssigneeName": "Имя из списка команды или null",
      "suggestedProjectName": "Название проекта из списка или null",
      "dueDate": "YYYY-MM-DD или null",
      "category": "RUN или CHANGE",
      "priority": "CRITICAL, HIGH, MEDIUM или LOW"
    }
  ],
  "meetingNotes": "Структурированные заметки встречи в markdown формате"
}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from Claude');
    }

    // Extract JSON from response
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Claude response');
    }

    const result = JSON.parse(jsonMatch[0]) as ExtractionResult;

    return {
      tasks: Array.isArray(result.tasks) ? result.tasks : [],
      meetingNotes: result.meetingNotes || text,
    };
  } catch (error) {
    console.error('Claude extraction error:', error);
    return {
      tasks: [],
      meetingNotes: text,
    };
  }
}
