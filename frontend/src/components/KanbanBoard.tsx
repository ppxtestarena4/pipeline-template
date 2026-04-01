import React, { useCallback, useEffect, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import { TaskCard } from './TaskCard';
import {
  createTask,
  getTasks,
  moveTask,
  Task,
  TaskCategory,
  TaskStatus,
} from '../api/tasks';

// ─── Column definitions ───────────────────────────────────────────────────────

interface ColumnDef {
  id: TaskStatus;
  label: string;
  emoji: string;
}

const COLUMNS: ColumnDef[] = [
  { id: 'backlog',     label: 'Backlog',      emoji: '📋' },
  { id: 'todo',        label: 'To Do',        emoji: '📌' },
  { id: 'in_progress', label: 'In Progress',  emoji: '⚙️' },
  { id: 'review',      label: 'Review',       emoji: '🔍' },
  { id: 'testing',     label: 'Testing',      emoji: '🧪' },
  { id: 'done',        label: 'Done',         emoji: '✅' },
];

// ─── KanbanColumn ─────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  column: ColumnDef;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onAddTask?: () => void;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({
  column,
  tasks,
  onTaskClick,
  onAddTask,
}) => {
  const { isOver, setNodeRef } = useDroppable({ id: column.id });

  return (
    <div className={`kanban-column${isOver ? ' kanban-column--over' : ''}`}>
      <div className="kanban-column__header">
        <span className="kanban-column__title">
          {column.emoji} {column.label}
        </span>
        <span className="kanban-column__count">{tasks.length}</span>
      </div>

      <div ref={setNodeRef} className="kanban-column__cards">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onClick={onTaskClick} />
        ))}
      </div>

      {column.id === 'backlog' && (
        <button className="kanban-column__add-btn" onClick={onAddTask}>
          + Задача
        </button>
      )}
    </div>
  );
};

// ─── KanbanBoard ─────────────────────────────────────────────────────────────

export interface KanbanBoardProps {
  /** Filter tasks by assignee (comes from TASK-012 Header / selectedUser) */
  selectedUserId?: string;
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({ selectedUserId }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeCategory, setActiveCategory] = useState<TaskCategory | null>(null);
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Require at least 5px of movement before drag starts (prevents accidental drags on click)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // ─── Data loading ──────────────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getTasks({
        category: activeCategory ?? undefined,
        assignee_id: selectedUserId,
      });
      setTasks(data);
    } catch (err) {
      console.error('loadTasks error:', err);
      setError('Не удалось загрузить задачи');
    } finally {
      setLoading(false);
    }
  }, [activeCategory, selectedUserId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  // ─── Drag & Drop handlers ──────────────────────────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find((t) => t.id === event.active.id);
    setDraggingTask(task ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setDraggingTask(null);

    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const newStatus = over.id as TaskStatus;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    // Optimistic update
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
    );

    try {
      const updated = await moveTask(taskId, newStatus);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      console.error('moveTask error:', err);
      // Rollback on API error
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: task.status } : t)),
      );
    }
  };

  // ─── Create task ───────────────────────────────────────────────────────────

  const handleAddTask = async () => {
    const title = window.prompt('Название задачи:');
    if (!title?.trim()) return;

    try {
      const task = await createTask({
        title: title.trim(),
        status: 'backlog',
        priority: 'medium',
        category: activeCategory ?? 'run',
        assignee_id: selectedUserId,
      });
      setTasks((prev) => [task, ...prev]);
    } catch (err) {
      console.error('createTask error:', err);
      window.alert('Не удалось создать задачу');
    }
  };

  // ─── Task click (detail view — TASK-014) ──────────────────────────────────

  const handleTaskClick = (task: Task) => {
    // TODO: open task detail modal (TASK-014)
    console.log('Task selected:', task.id, task.title);
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────

  const tasksByStatus = (status: TaskStatus): Task[] =>
    tasks.filter((t) => t.status === status);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="kanban-board">
      {/* Category filter tabs */}
      <div className="kanban-board__tabs">
        <button
          className={`kanban-tab${activeCategory === null ? ' kanban-tab--active' : ''}`}
          onClick={() => setActiveCategory(null)}
        >
          Все
        </button>
        <button
          className={`kanban-tab${activeCategory === 'run' ? ' kanban-tab--active' : ''}`}
          onClick={() => setActiveCategory('run')}
        >
          🔥 Run
        </button>
        <button
          className={`kanban-tab${activeCategory === 'change' ? ' kanban-tab--active' : ''}`}
          onClick={() => setActiveCategory('change')}
        >
          🎯 Change
        </button>
      </div>

      {loading && <div className="kanban-board__state">Загрузка...</div>}
      {error && <div className="kanban-board__state kanban-board__state--error">{error}</div>}

      {!loading && !error && (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={(e) => void handleDragEnd(e)}
        >
          <div className="kanban-board__columns">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                column={col}
                tasks={tasksByStatus(col.id)}
                onTaskClick={handleTaskClick}
                onAddTask={col.id === 'backlog' ? () => void handleAddTask() : undefined}
              />
            ))}
          </div>

          {/* Drag overlay — renders a visual clone of the dragged card */}
          <DragOverlay>
            {draggingTask && (
              <TaskCard task={draggingTask} isOverlay />
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
};
