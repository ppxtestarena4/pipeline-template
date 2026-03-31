import { api } from './client';
import type {
  User, Project, Task, Report, WeeklyGoal,
  Intake, KanbanBoard, ReportData, Notification,
} from '../types';

// ─── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ token: string; user: User }>('/auth/login', { email, password }),
  register: (data: { email: string; password: string; name: string; role?: string; managerId?: string }) =>
    api.post<{ token: string; user: User }>('/auth/register', data),
  me: () => api.get<User>('/auth/me'),
  createAgent: (name: string, managerId?: string) =>
    api.post<User & { apiToken: string }>('/auth/create-agent', { name, managerId }),
};

// ─── Users ─────────────────────────────────────────────────────────────────────

export const usersApi = {
  list: () => api.get<User[]>('/users'),
  get: (id: string) => api.get<User>(`/users/${id}`),
  directReports: (id: string) => api.get<User[]>(`/users/${id}/direct-reports`),
  update: (id: string, data: Partial<User>) => api.patch<User>(`/users/${id}`, data),
};

// ─── Projects ──────────────────────────────────────────────────────────────────

export const projectsApi = {
  list: (archived?: boolean) => api.get<Project[]>('/projects', { params: { archived } }),
  get: (id: string) => api.get<Project>(`/projects/${id}`),
  create: (data: { name: string; description?: string; memberIds?: string[] }) =>
    api.post<Project>('/projects', data),
  update: (id: string, data: Partial<Project> & { memberIds?: string[] }) =>
    api.patch<Project>(`/projects/${id}`, data),
  archive: (id: string) => api.delete(`/projects/${id}`),
  stats: (id: string) => api.get<{ total: number; done: number; progress: number; byStatus: Record<string, number> }>(`/projects/${id}/stats`),
};

// ─── Tasks ─────────────────────────────────────────────────────────────────────

export const tasksApi = {
  list: (params?: {
    projectId?: string; assigneeId?: string; status?: string;
    priority?: string; category?: string; search?: string;
    parentTaskId?: string; page?: number; limit?: number;
  }) => api.get<{ tasks: Task[]; total: number }>('/tasks', { params }),
  get: (id: string) => api.get<Task>(`/tasks/${id}`),
  kanban: (params?: { projectId?: string; assigneeId?: string; category?: string }) =>
    api.get<KanbanBoard>('/tasks/kanban/board', { params }),
  create: (data: Partial<Task>) => api.post<Task>('/tasks', data),
  update: (id: string, data: Partial<Task>) => api.patch<Task>(`/tasks/${id}`, data),
  move: (id: string, status: string) => api.post<Task>(`/tasks/${id}/move`, { status }),
  delete: (id: string) => api.delete(`/tasks/${id}`),
  // Subtasks
  subtasks: (taskId: string) => api.get(`/tasks/${taskId}/subtasks`),
  createSubtask: (taskId: string, data: { title: string; assigneeId?: string }) =>
    api.post(`/tasks/${taskId}/subtasks`, data),
  updateSubtask: (taskId: string, subtaskId: string, data: { title?: string; completed?: boolean; assigneeId?: string }) =>
    api.patch(`/tasks/${taskId}/subtasks/${subtaskId}`, data),
  deleteSubtask: (taskId: string, subtaskId: string) =>
    api.delete(`/tasks/${taskId}/subtasks/${subtaskId}`),
  // Comments
  addComment: (taskId: string, content: string) =>
    api.post(`/tasks/${taskId}/comments`, { content }),
};

// ─── Reports ───────────────────────────────────────────────────────────────────

export const reportsApi = {
  list: (params?: { userId?: string; periodStart?: string; periodEnd?: string; status?: string }) =>
    api.get<Report[]>('/reports', { params }),
  generate: (params: { userId?: string; periodStart: string; periodEnd: string; projectId?: string }) =>
    api.get<ReportData>('/reports/generate', { params }),
  get: (id: string) => api.get<Report>(`/reports/${id}`),
  create: (data: { periodStart: string; periodEnd: string; comment?: string }) =>
    api.post<Report>('/reports', data),
  update: (id: string, data: { comment?: string; status?: string; managerComment?: string }) =>
    api.patch<Report>(`/reports/${id}`, data),
};

// ─── Goals ─────────────────────────────────────────────────────────────────────

export const goalsApi = {
  list: (params?: { userId?: string; weekStart?: string }) =>
    api.get<WeeklyGoal[]>('/goals', { params }),
  create: (data: { userId: string; title: string; description?: string; weekStart: string; taskIds?: string[] }) =>
    api.post<WeeklyGoal>('/goals', data),
  update: (id: string, data: Partial<WeeklyGoal> & { taskIds?: string[] }) =>
    api.patch<WeeklyGoal>(`/goals/${id}`, data),
  delete: (id: string) => api.delete(`/goals/${id}`),
};

// ─── Intake ────────────────────────────────────────────────────────────────────

export const intakeApi = {
  list: () => api.get<Intake[]>('/intake'),
  get: (id: string) => api.get<Intake>(`/intake/${id}`),
  submitText: (text: string) => api.post<{ id: string; status: string }>('/intake/text', { text }),
  uploadFile: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ id: string; status: string; fileType: string }>('/intake/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  confirm: (id: string, confirmedTaskIds: string[]) =>
    api.post(`/intake/${id}/confirm`, { confirmedTaskIds }),
  updateTask: (intakeId: string, taskId: string, data: { title?: string; description?: string; assigneeId?: string; projectId?: string }) =>
    api.patch(`/intake/${intakeId}/tasks/${taskId}`, data),
};

// ─── Notifications ─────────────────────────────────────────────────────────────

export const notificationsApi = {
  list: (unread?: boolean) => api.get<Notification[]>('/notifications', { params: { unread } }),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.post('/notifications/read-all'),
};
