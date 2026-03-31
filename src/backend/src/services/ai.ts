import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ExtractedTask {
  title: string;
  description?: string;
  assigneeName?: string;
  projectContext?: string;
  deadline?: string;
  priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category?: 'RUN' | 'CHANGE';
}

export interface MeetingNotes {
  summary: string;
  participants: string[];
  decisions: string[];
  tasks: ExtractedTask[];
  date?: string;
}

/**
 * Extract tasks from unstructured text (transcript, meeting notes, etc.)
 */
export async function extractTasksFromText(text: string): Promise<MeetingNotes> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `You are an assistant that extracts structured information from meeting transcripts and notes.

Analyze the following text and extract:
1. A brief summary of the meeting
2. Participants mentioned
3. Key decisions made
4. Action items / tasks with:
   - title (short, actionable)
   - description (optional, more detail)
   - assigneeName (person responsible, if mentioned)
   - projectContext (project or area mentioned, if any)
   - deadline (date if mentioned, in ISO format YYYY-MM-DD)
   - priority: CRITICAL, HIGH, MEDIUM, or LOW (infer from context)
   - category: RUN (operational/routine tasks) or CHANGE (strategic/new feature tasks)

Return ONLY valid JSON matching this schema:
{
  "summary": "string",
  "participants": ["string"],
  "decisions": ["string"],
  "date": "YYYY-MM-DD or null",
  "tasks": [
    {
      "title": "string",
      "description": "string or null",
      "assigneeName": "string or null",
      "projectContext": "string or null",
      "deadline": "YYYY-MM-DD or null",
      "priority": "CRITICAL|HIGH|MEDIUM|LOW",
      "category": "RUN|CHANGE"
    }
  ]
}

Text to analyze:
${text}`,
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from AI');
  }

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = content.text.match(/```json\n?([\s\S]*?)\n?```/) ||
                    content.text.match(/(\{[\s\S]*\})/);
  const jsonText = jsonMatch ? jsonMatch[1] : content.text;

  return JSON.parse(jsonText) as MeetingNotes;
}

/**
 * Route extracted tasks to correct users/projects based on name/context matching
 */
export async function routeTasks(
  tasks: ExtractedTask[],
  users: { id: string; name: string }[],
  projects: { id: string; name: string; ownerId: string }[]
): Promise<Array<ExtractedTask & { resolvedAssigneeId?: string; resolvedProjectId?: string }>> {
  return tasks.map(task => {
    let resolvedAssigneeId: string | undefined;
    let resolvedProjectId: string | undefined;

    // Match assignee by name (case-insensitive partial match)
    if (task.assigneeName) {
      const normalized = task.assigneeName.toLowerCase();
      const user = users.find(u =>
        u.name.toLowerCase().includes(normalized) ||
        normalized.includes(u.name.toLowerCase().split(' ')[0])
      );
      resolvedAssigneeId = user?.id;
    }

    // Match project by name or context
    if (task.projectContext) {
      const normalized = task.projectContext.toLowerCase();
      const project = projects.find(p =>
        p.name.toLowerCase().includes(normalized) ||
        normalized.includes(p.name.toLowerCase())
      );
      resolvedProjectId = project?.id;
      // If project found and no assignee yet, use project owner
      if (project && !resolvedAssigneeId) {
        resolvedAssigneeId = project.ownerId;
      }
    }

    return { ...task, resolvedAssigneeId, resolvedProjectId };
  });
}
