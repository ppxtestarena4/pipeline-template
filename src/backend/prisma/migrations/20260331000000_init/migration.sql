-- TechTCB Task Management System — Initial Migration
-- Generated from schema.prisma

CREATE TYPE "UserType" AS ENUM ('HUMAN', 'AI_AGENT');
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'EMPLOYEE', 'AI_AGENT');
CREATE TYPE "TaskStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'TESTING', 'DONE');
CREATE TYPE "TaskPriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE "TaskCategory" AS ENUM ('RUN', 'CHANGE');
CREATE TYPE "GoalStatus" AS ENUM ('COMPLETED', 'PARTIAL', 'NOT_DONE');
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'COMMENTED');
CREATE TYPE "NotificationType" AS ENUM (
  'TASK_ASSIGNED', 'TASK_MENTIONED', 'TASK_DEADLINE',
  'TASK_STATUS_CHANGED', 'REPORT_SUBMITTED', 'REPORT_APPROVED',
  'REPORT_COMMENTED', 'INTAKE_TASKS_READY', 'GOAL_SET'
);
CREATE TYPE "IntakeStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY_FOR_MODERATION', 'MODERATED', 'FAILED');

-- Users
CREATE TABLE "users" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL UNIQUE,
  "password_hash" TEXT,
  "name" TEXT NOT NULL,
  "type" "UserType" NOT NULL DEFAULT 'HUMAN',
  "role" "UserRole" NOT NULL DEFAULT 'EMPLOYEE',
  "api_token" TEXT UNIQUE,
  "avatar_url" TEXT,
  "manager_id" TEXT REFERENCES "users"("id"),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Projects
CREATE TABLE "projects" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "owner_id" TEXT NOT NULL REFERENCES "users"("id"),
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "project_members" (
  "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  PRIMARY KEY ("project_id", "user_id")
);

-- Tasks
CREATE TABLE "tasks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "assignee_id" TEXT REFERENCES "users"("id"),
  "creator_id" TEXT NOT NULL REFERENCES "users"("id"),
  "status" "TaskStatus" NOT NULL DEFAULT 'BACKLOG',
  "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "category" "TaskCategory" NOT NULL DEFAULT 'RUN',
  "deadline" TIMESTAMP(3),
  "parent_task_id" TEXT REFERENCES "tasks"("id"),
  "labels" TEXT[] NOT NULL DEFAULT '{}',
  "position" INTEGER NOT NULL DEFAULT 0,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "subtasks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "task_id" TEXT NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "assignee_id" TEXT REFERENCES "users"("id"),
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Comments
CREATE TABLE "comments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "task_id" TEXT NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "author_id" TEXT NOT NULL REFERENCES "users"("id"),
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Notifications
CREATE TABLE "notifications" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "type" "NotificationType" NOT NULL,
  "content" TEXT NOT NULL,
  "task_id" TEXT,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Reports
CREATE TABLE "reports" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id"),
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "comment" TEXT,
  "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
  "approved_by" TEXT REFERENCES "users"("id"),
  "manager_comment" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Weekly Goals
CREATE TABLE "weekly_goals" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id"),
  "manager_id" TEXT NOT NULL REFERENCES "users"("id"),
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "GoalStatus" NOT NULL DEFAULT 'NOT_DONE',
  "week_start" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "goal_task_links" (
  "goal_id" TEXT NOT NULL REFERENCES "weekly_goals"("id") ON DELETE CASCADE,
  "task_id" TEXT NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  PRIMARY KEY ("goal_id", "task_id")
);

-- Intake Pipeline
CREATE TABLE "intakes" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "created_by" TEXT NOT NULL REFERENCES "users"("id"),
  "file_type" TEXT,
  "file_path" TEXT,
  "original_name" TEXT,
  "transcript" TEXT,
  "meeting_notes" TEXT,
  "raw_text" TEXT,
  "status" "IntakeStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "intake_tasks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "intake_id" TEXT NOT NULL REFERENCES "intakes"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "assignee_id" TEXT,
  "project_id" TEXT,
  "confirmed" BOOLEAN NOT NULL DEFAULT false,
  "task_id" TEXT REFERENCES "tasks"("id"),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Audit Log
CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "task_id" TEXT NOT NULL REFERENCES "tasks"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id"),
  "action" TEXT NOT NULL,
  "old_value" TEXT,
  "new_value" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX "tasks_project_id_status_idx" ON "tasks"("project_id", "status");
CREATE INDEX "tasks_assignee_id_status_idx" ON "tasks"("assignee_id", "status");
CREATE INDEX "tasks_completed_at_idx" ON "tasks"("completed_at");
CREATE INDEX "notifications_user_id_read_idx" ON "notifications"("user_id", "read");
CREATE INDEX "reports_user_id_idx" ON "reports"("user_id");
CREATE INDEX "weekly_goals_user_id_week_start_idx" ON "weekly_goals"("user_id", "week_start");
