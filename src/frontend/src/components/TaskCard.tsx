import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Task } from '../types';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface Props {
  task: Task;
  dragging?: boolean;
}

const priorityColors: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  LOW: 'bg-gray-100 text-gray-600',
};

const priorityLabels: Record<string, string> = {
  CRITICAL: 'Крит',
  HIGH: 'Высокий',
  MEDIUM: 'Средний',
  LOW: 'Низкий',
};

const categoryColors: Record<string, string> = {
  RUN: 'bg-blue-50 text-blue-600',
  CHANGE: 'bg-purple-50 text-purple-600',
};

export default function TaskCard({ task, dragging }: Props) {
  const navigate = useNavigate();
  const completedSubtasks = task.subtasks?.filter(s => s.completed).length || 0;
  const totalSubtasks = task.subtasks?.length || 0;

  const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== 'DONE';

  return (
    <div
      className={`card p-3 cursor-pointer hover:shadow-md transition-all group ${dragging ? 'dragging' : ''}`}
      onClick={() => navigate(`/tasks/${task.id}`)}
    >
      {/* Title */}
      <p className="text-sm font-medium text-gray-900 mb-2 line-clamp-2 leading-snug">
        {task.title}
      </p>

      {/* Badges row */}
      <div className="flex flex-wrap gap-1 mb-2">
        <span className={`badge text-xs ${priorityColors[task.priority]}`}>
          {priorityLabels[task.priority]}
        </span>
        <span className={`badge text-xs ${categoryColors[task.category]}`}>
          {task.category}
        </span>
        {task.labels?.map(label => (
          <span key={label} className="badge bg-gray-100 text-gray-600 text-xs">{label}</span>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 text-xs text-gray-400">
        {/* Subtasks progress */}
        {totalSubtasks > 0 && (
          <span className={`font-medium ${completedSubtasks === totalSubtasks ? 'text-green-600' : 'text-gray-500'}`}>
            {completedSubtasks}/{totalSubtasks}
          </span>
        )}

        {/* Comments */}
        {(task._count?.comments || 0) > 0 && (
          <span>💬 {task._count?.comments}</span>
        )}

        {/* Deadline */}
        {task.deadline && (
          <span className={`ml-auto ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
            {format(new Date(task.deadline), 'd MMM', { locale: ru })}
          </span>
        )}

        {/* Assignee avatar */}
        {task.assignee && (
          <div
            className="ml-auto w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold"
            title={task.assignee.name}
          >
            {task.assignee.name.slice(0, 2).toUpperCase()}
          </div>
        )}
      </div>
    </div>
  );
}
