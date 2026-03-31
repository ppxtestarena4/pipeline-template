export type UserType = 'HUMAN' | 'AI_AGENT';
export type UserRole = 'ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'AI_AGENT';

export interface User {
  id: string;
  email: string;
  name: string;
  type: UserType;
  role: UserRole;
  avatarUrl?: string;
  managerId?: string;
  manager?: Pick<User, 'id' | 'name'>;
  directReports?: Pick<User, 'id' | 'name' | 'role' | 'avatarUrl'>[];
}

export type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'TESTING' | 'DONE';
export type TaskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TaskCategory = 'RUN' | 'CHANGE';

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  completed: boolean;
  assigneeId?: string;
  assignee?: Pick<User, 'id' | 'name' | 'avatarUrl'>;
  position: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  projectId: string;
  project?: { id: string; name: string };
  assigneeId?: string;
  assignee?: Pick<User, 'id' | 'name' | 'avatarUrl'>;
  creatorId: string;
  creator?: Pick<User, 'id' | 'name'>;
  status: TaskStatus;
  priority: TaskPriority;
  category: TaskCategory;
  deadline?: string;
  parentTaskId?: string;
  parentTask?: { id: string; title: string };
  labels: string[];
  position: number;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
  subtasks: Subtask[];
  subTasks?: Task[];
  _count?: { comments: number; subTasks: number };
}

export interface Comment {
  id: string;
  taskId: string;
  authorId: string;
  author: Pick<User, 'id' | 'name' | 'avatarUrl'>;
  content: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  owner?: Pick<User, 'id' | 'name' | 'avatarUrl'>;
  members: { user: Pick<User, 'id' | 'name' | 'role' | 'avatarUrl'> }[];
  archived: boolean;
  createdAt: string;
  _count?: { tasks: number };
}

export type ReportStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'COMMENTED';
export type GoalStatus = 'COMPLETED' | 'PARTIAL' | 'NOT_DONE';

export interface Report {
  id: string;
  userId: string;
  user?: Pick<User, 'id' | 'name' | 'avatarUrl'>;
  periodStart: string;
  periodEnd: string;
  comment?: string;
  status: ReportStatus;
  approvedById?: string;
  approvedBy?: Pick<User, 'id' | 'name'>;
  managerComment?: string;
  createdAt: string;
}

export interface WeeklyGoal {
  id: string;
  userId: string;
  managerId: string;
  user?: Pick<User, 'id' | 'name' | 'avatarUrl'>;
  manager?: Pick<User, 'id' | 'name'>;
  title: string;
  description?: string;
  status: GoalStatus;
  weekStart: string;
  taskLinks: { taskId: string; task: Pick<Task, 'id' | 'title' | 'status'> }[];
}

export type NotificationType =
  | 'TASK_ASSIGNED' | 'TASK_MENTIONED' | 'TASK_DEADLINE'
  | 'TASK_STATUS_CHANGED' | 'REPORT_SUBMITTED' | 'REPORT_APPROVED'
  | 'REPORT_COMMENTED' | 'INTAKE_TASKS_READY' | 'GOAL_SET';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  content: string;
  taskId?: string;
  read: boolean;
  createdAt: string;
}

export type IntakeStatus = 'PENDING' | 'PROCESSING' | 'READY_FOR_MODERATION' | 'MODERATED' | 'FAILED';

export interface IntakeTask {
  id: string;
  intakeId: string;
  title: string;
  description?: string;
  assigneeId?: string;
  projectId?: string;
  confirmed: boolean;
  taskId?: string;
  task?: Pick<Task, 'id' | 'title' | 'status'>;
}

export interface Intake {
  id: string;
  createdById: string;
  createdBy?: Pick<User, 'id' | 'name'>;
  fileType?: string;
  originalName?: string;
  transcript?: string;
  meetingNotes?: string;
  rawText?: string;
  status: IntakeStatus;
  createdAt: string;
  intakeTasks: IntakeTask[];
}

export interface KanbanBoard {
  BACKLOG: Task[];
  TODO: Task[];
  IN_PROGRESS: Task[];
  REVIEW: Task[];
  TESTING: Task[];
  DONE: Task[];
}

export interface ReportData {
  userId: string;
  user: Pick<User, 'id' | 'name' | 'managerId'>;
  periodStart: string;
  periodEnd: string;
  metrics: { totalDone: number; totalInProgress: number; totalBlocked: number };
  level1: Task[];
  level2: Task[];
  level3: Task[];
  inProgress: Task[];
  blocked: Task[];
}
