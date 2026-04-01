import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Task, TaskPriority, TaskCategory } from '../api/tasks';

interface TaskCardProps {
  task: Task;
  /** Set to true when rendering the DragOverlay clone (no drag handles needed) */
  isOverlay?: boolean;
  onClick?: (task: Task) => void;
}

// ─── Visual mappings ─────────────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  low:      { label: 'Низкий',      color: '#10b981' },
  medium:   { label: 'Средний',     color: '#f59e0b' },
  high:     { label: 'Высокий',     color: '#f97316' },
  critical: { label: 'Критический', color: '#ef4444' },
};

const CATEGORY_CONFIG: Record<TaskCategory, { label: string; bg: string; text: string }> = {
  run:    { label: '🔥 Run',    bg: '#fef3c7', text: '#d97706' },
  change: { label: '🎯 Change', bg: '#ede9fe', text: '#7c3aed' },
};

// ─── Helper ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// ─── Component ───────────────────────────────────────────────────────────────

export const TaskCard: React.FC<TaskCardProps> = ({ task, isOverlay = false, onClick }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: isOverlay,
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    cursor: isOverlay ? 'grabbing' : 'grab',
  };

  const priority = PRIORITY_CONFIG[task.priority];
  const category = CATEGORY_CONFIG[task.category];

  const doneCount = task.subtasks?.filter((s) => s.done).length ?? 0;
  const totalCount = task.subtasks?.length ?? 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="task-card"
      {...listeners}
      {...attributes}
      onClick={() => onClick?.(task)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.(task)}
    >
      {/* Badges: priority + category */}
      <div className="task-card__badges">
        <span
          className="badge"
          style={{
            backgroundColor: priority.color + '20',
            color: priority.color,
            border: `1px solid ${priority.color}50`,
          }}
        >
          {priority.label}
        </span>
        <span
          className="badge"
          style={{ backgroundColor: category.bg, color: category.text }}
        >
          {category.label}
        </span>
      </div>

      {/* Title */}
      <p className="task-card__title">{task.title}</p>

      {/* Footer: assignee + subtask progress */}
      <div className="task-card__footer">
        {task.assignee && (
          <div className="task-card__assignee">
            {task.assignee.avatar ? (
              <img
                src={task.assignee.avatar}
                alt={task.assignee.name}
                className="avatar"
              />
            ) : (
              <div className="avatar avatar--initials" title={task.assignee.name}>
                {getInitials(task.assignee.name)}
              </div>
            )}
            <span className="task-card__assignee-name">{task.assignee.name}</span>
          </div>
        )}

        {totalCount > 0 && (
          <div className="task-card__subtasks" title={`Подзадачи: ${doneCount}/${totalCount}`}>
            <span>☰</span>
            <span>
              {doneCount}/{totalCount}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
