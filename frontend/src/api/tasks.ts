const API_BASE = '/api';

// ─── Types ──────────────────────────────────────────────────────────────────

export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'review'
  | 'testing'
  | 'done';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type TaskCategory = 'run' | 'change';

export interface Assignee {
  id: string;
  name: string;
  avatar?: string;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory;
  assignee?: Assignee;
  subtasks?: Subtask[];
  created_at: string;
  updated_at: string;
}

export interface TaskFilters {
  status?: TaskStatus;
  category?: TaskCategory;
  assignee_id?: string;
}

export interface CreateTaskData {
  title: string;
  status?: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory;
  assignee_id?: string;
}

// ─── API functions ───────────────────────────────────────────────────────────

/** GET /api/tasks?status=X&category=Y&assignee_id=Z */
export async function getTasks(filters?: TaskFilters): Promise<Task[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.category) params.set('category', filters.category);
  if (filters?.assignee_id) params.set('assignee_id', filters.assignee_id);

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${API_BASE}/tasks${query}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch tasks: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<Task[]>;
}

/** PUT /api/tasks/{id}/move */
export async function moveTask(taskId: string, status: TaskStatus): Promise<Task> {
  const response = await fetch(`${API_BASE}/tasks/${taskId}/move`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });

  if (!response.ok) {
    throw new Error(`Failed to move task: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<Task>;
}

/** POST /api/tasks */
export async function createTask(data: CreateTaskData): Promise<Task> {
  const response = await fetch(`${API_BASE}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(`Failed to create task: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<Task>;
}
