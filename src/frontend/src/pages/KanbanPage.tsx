import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  DndContext, DragEndEvent, DragOverEvent, DragStartEvent,
  PointerSensor, useSensor, useSensors, DragOverlay, closestCorners,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { tasksApi, usersApi, projectsApi } from '../api';
import { useAuth } from '../hooks/useAuth';
import type { Task, TaskStatus, TaskCategory } from '../types';
import TaskCard from '../components/TaskCard';
import TaskModal from '../components/TaskModal';
import DirectReportTabs from '../components/DirectReportTabs';
import { usersApi as usersApiAlias } from '../api';

const STATUSES: TaskStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'TESTING', 'DONE'];

const statusLabels: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  TESTING: 'Testing',
  DONE: 'Done',
};

const statusColors: Record<TaskStatus, string> = {
  BACKLOG: 'bg-gray-50 border-gray-200',
  TODO: 'bg-blue-50 border-blue-200',
  IN_PROGRESS: 'bg-yellow-50 border-yellow-200',
  REVIEW: 'bg-purple-50 border-purple-200',
  TESTING: 'bg-indigo-50 border-indigo-200',
  DONE: 'bg-green-50 border-green-200',
};

function SortableTaskCard({ task }: { task: Task }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} dragging={isDragging} />
    </div>
  );
}

export default function KanbanPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<TaskCategory | ''>('');
  const [selectedReportId, setSelectedReportId] = useState<string | null>(
    searchParams.get('assigneeId') || null
  );

  const projectId = searchParams.get('projectId') || undefined;
  const assigneeId = selectedReportId || user!.id;

  const { data: currentUserData } = useQuery({
    queryKey: ['user', 'me-full'],
    queryFn: () => usersApiAlias.get(user!.id).then(r => r.data),
  });
  const directReports = currentUserData?.directReports || [];

  const { data: board, isLoading } = useQuery({
    queryKey: ['kanban', projectId, assigneeId, selectedCategory],
    queryFn: () => tasksApi.kanban({
      projectId,
      assigneeId,
      category: selectedCategory || undefined,
    }).then(r => r.data),
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      tasksApi.move(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban'] }),
  });

  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  }));

  const handleDragStart = (e: DragStartEvent) => {
    setActiveTask(e.active.data.current?.task || null);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveTask(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;

    // Find which column the task was dropped into
    const targetStatus = over.id as TaskStatus;
    if (STATUSES.includes(targetStatus)) {
      moveMutation.mutate({ id: active.id as string, status: targetStatus });
    }
  };

  if (isLoading) return <div className="text-center py-12 text-gray-400">Загрузка...</div>;

  const columns = board || {} as any;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">Канбан</h1>

        {/* Category tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(['', 'RUN', 'CHANGE'] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                selectedCategory === cat
                  ? 'bg-white shadow-sm text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {cat === '' ? 'Все' : cat === 'RUN' ? '🔥 Run' : '🎯 Change'}
            </button>
          ))}
        </div>

        <button
          className="btn-primary ml-auto"
          onClick={() => setShowCreateModal(true)}
        >
          + Задача
        </button>
      </div>

      {/* Direct report tabs (manager view) */}
      {(user?.role === 'MANAGER' || user?.role === 'ADMIN') && directReports.length > 0 && (
        <div className="mb-4">
          <DirectReportTabs
            currentUser={user!}
            directReports={directReports as any}
            selectedId={selectedReportId}
            onSelect={id => {
              setSelectedReportId(id);
              const newParams = new URLSearchParams(searchParams);
              if (id) newParams.set('assigneeId', id);
              else newParams.delete('assigneeId');
              setSearchParams(newParams);
            }}
          />
        </div>
      )}

      {/* Kanban board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4 flex-1">
          {STATUSES.map(status => {
            const tasks: Task[] = columns[status] || [];
            return (
              <div
                key={status}
                className={`flex-shrink-0 w-64 flex flex-col rounded-xl border ${statusColors[status]}`}
              >
                {/* Column header */}
                <div className="px-3 py-2 flex items-center justify-between border-b border-inherit">
                  <span className="font-semibold text-sm text-gray-700">{statusLabels[status]}</span>
                  <span className="text-xs text-gray-400 bg-white rounded-full px-2 py-0.5">
                    {tasks.length}
                  </span>
                </div>

                {/* Drop zone */}
                <SortableContext
                  id={status}
                  items={tasks.map(t => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex-1 p-2 space-y-2 min-h-20 overflow-y-auto max-h-[calc(100vh-280px)]">
                    {tasks.map(task => (
                      <SortableTaskCard key={task.id} task={task} />
                    ))}
                    {tasks.length === 0 && (
                      <div className="text-center py-6 text-xs text-gray-300">Пусто</div>
                    )}
                  </div>
                </SortableContext>
              </div>
            );
          })}
        </div>

        <DragOverlay>
          {activeTask && <TaskCard task={activeTask} dragging />}
        </DragOverlay>
      </DndContext>

      {showCreateModal && (
        <TaskModal
          projectId={projectId}
          onClose={() => setShowCreateModal(false)}
          onCreate={() => qc.invalidateQueries({ queryKey: ['kanban'] })}
        />
      )}
    </div>
  );
}
