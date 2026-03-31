import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksApi, usersApi, projectsApi } from '../api';
import ReactMarkdown from 'react-markdown';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { TaskStatus, TaskPriority, TaskCategory } from '../types';

const statusOptions: TaskStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'TESTING', 'DONE'];
const statusLabels: Record<TaskStatus, string> = {
  BACKLOG: 'Backlog', TODO: 'To Do', IN_PROGRESS: 'In Progress',
  REVIEW: 'Review', TESTING: 'Testing', DONE: 'Done',
};

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [newComment, setNewComment] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [description, setDescription] = useState('');

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', id],
    queryFn: () => tasksApi.get(id!).then(r => r.data),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
  });

  const updateTask = useMutation({
    mutationFn: (data: Record<string, unknown>) => tasksApi.update(id!, data as any),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', id] }),
  });

  const addComment = useMutation({
    mutationFn: () => tasksApi.addComment(id!, newComment),
    onSuccess: () => {
      setNewComment('');
      qc.invalidateQueries({ queryKey: ['task', id] });
    },
  });

  const addSubtask = useMutation({
    mutationFn: () => tasksApi.createSubtask(id!, { title: newSubtask }),
    onSuccess: () => {
      setNewSubtask('');
      qc.invalidateQueries({ queryKey: ['task', id] });
    },
  });

  const toggleSubtask = useMutation({
    mutationFn: ({ subtaskId, completed }: { subtaskId: string; completed: boolean }) =>
      tasksApi.updateSubtask(id!, subtaskId, { completed }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', id] }),
  });

  const deleteSubtask = useMutation({
    mutationFn: (subtaskId: string) => tasksApi.deleteSubtask(id!, subtaskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task', id] }),
  });

  if (isLoading) return <div className="text-center py-12 text-gray-400">Загрузка...</div>;
  if (!task) return <div className="text-center py-12 text-red-400">Задача не найдена</div>;

  const completedSubtasks = task.subtasks.filter(s => s.completed).length;
  const totalSubtasks = task.subtasks.length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <button onClick={() => navigate(-1)} className="hover:text-gray-700">← Назад</button>
        {task.project && (
          <>
            <span>/</span>
            <span>{task.project.name}</span>
          </>
        )}
        {task.parentTask && (
          <>
            <span>/</span>
            <button
              className="hover:text-gray-700"
              onClick={() => navigate(`/tasks/${task.parentTask!.id}`)}
            >
              {task.parentTask.title}
            </button>
          </>
        )}
      </div>

      {/* Task header */}
      <div className="card p-6">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900 mb-3">{task.title}</h1>

            {/* Meta row */}
            <div className="flex flex-wrap gap-2 mb-4">
              {/* Status */}
              <select
                className="text-sm border border-gray-200 rounded-md px-2 py-1 bg-gray-50"
                value={task.status}
                onChange={e => updateTask.mutate({ status: e.target.value as TaskStatus })}
              >
                {statusOptions.map(s => (
                  <option key={s} value={s}>{statusLabels[s]}</option>
                ))}
              </select>

              {/* Category */}
              <select
                className="text-sm border border-gray-200 rounded-md px-2 py-1 bg-gray-50"
                value={task.category}
                onChange={e => updateTask.mutate({ category: e.target.value as TaskCategory })}
              >
                <option value="RUN">🔥 Run</option>
                <option value="CHANGE">🎯 Change</option>
              </select>

              {/* Priority */}
              <select
                className="text-sm border border-gray-200 rounded-md px-2 py-1 bg-gray-50"
                value={task.priority}
                onChange={e => updateTask.mutate({ priority: e.target.value as TaskPriority })}
              >
                <option value="LOW">↓ Низкий</option>
                <option value="MEDIUM">→ Средний</option>
                <option value="HIGH">↑ Высокий</option>
                <option value="CRITICAL">⚡ Критический</option>
              </select>

              {/* Assignee */}
              <select
                className="text-sm border border-gray-200 rounded-md px-2 py-1 bg-gray-50"
                value={task.assigneeId || ''}
                onChange={e => updateTask.mutate({ assigneeId: e.target.value || null })}
              >
                <option value="">Не назначен</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>

              {/* Deadline */}
              <input
                type="date"
                className="text-sm border border-gray-200 rounded-md px-2 py-1 bg-gray-50"
                value={task.deadline ? task.deadline.slice(0, 10) : ''}
                onChange={e => updateTask.mutate({ deadline: e.target.value || null })}
              />
            </div>

            {/* Description */}
            {editingDescription ? (
              <div>
                <textarea
                  className="input resize-none w-full"
                  rows={6}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Markdown описание..."
                />
                <div className="flex gap-2 mt-2">
                  <button
                    className="btn-primary text-xs"
                    onClick={() => {
                      updateTask.mutate({ description });
                      setEditingDescription(false);
                    }}
                  >
                    Сохранить
                  </button>
                  <button
                    className="btn-secondary text-xs"
                    onClick={() => setEditingDescription(false)}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="prose prose-sm max-w-none cursor-pointer hover:bg-gray-50 rounded-md p-2 -mx-2 min-h-12"
                onClick={() => {
                  setDescription(task.description || '');
                  setEditingDescription(true);
                }}
              >
                {task.description
                  ? <ReactMarkdown>{task.description}</ReactMarkdown>
                  : <span className="text-gray-400 text-sm">Нажмите для добавления описания...</span>
                }
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Subtasks */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">
            Подзадачи
            {totalSubtasks > 0 && (
              <span className="ml-2 text-gray-400 font-normal">{completedSubtasks}/{totalSubtasks}</span>
            )}
          </h3>
          {totalSubtasks > 0 && (
            <div className="flex-1 mx-4 bg-gray-100 rounded-full h-1.5">
              <div
                className="bg-green-500 h-1.5 rounded-full transition-all"
                style={{ width: `${(completedSubtasks / totalSubtasks) * 100}%` }}
              />
            </div>
          )}
        </div>

        <div className="space-y-1 mb-3">
          {task.subtasks.map(subtask => (
            <div key={subtask.id} className="flex items-center gap-2 group">
              <input
                type="checkbox"
                className="w-4 h-4 rounded"
                checked={subtask.completed}
                onChange={e => toggleSubtask.mutate({ subtaskId: subtask.id, completed: e.target.checked })}
              />
              <span className={`flex-1 text-sm ${subtask.completed ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                {subtask.title}
              </span>
              {subtask.assignee && (
                <span className="text-xs text-gray-400">{subtask.assignee.name}</span>
              )}
              <button
                className="text-xs text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                onClick={() => deleteSubtask.mutate(subtask.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <form
          onSubmit={e => { e.preventDefault(); if (newSubtask.trim()) addSubtask.mutate(); }}
          className="flex gap-2"
        >
          <input
            className="input flex-1 text-sm py-1.5"
            placeholder="Добавить подзадачу..."
            value={newSubtask}
            onChange={e => setNewSubtask(e.target.value)}
          />
          <button
            type="submit"
            className="btn-secondary text-xs"
            disabled={!newSubtask.trim()}
          >
            Добавить
          </button>
        </form>
      </div>

      {/* Sub-tasks (nested tasks) */}
      {(task.subTasks?.length || 0) > 0 && (
        <div className="card p-4">
          <h3 className="font-semibold text-sm mb-3">Вложенные задачи ({task.subTasks!.length})</h3>
          <div className="space-y-2">
            {task.subTasks!.map(sub => (
              <div
                key={sub.id}
                className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-md cursor-pointer hover:bg-gray-100"
                onClick={() => navigate(`/tasks/${sub.id}`)}
              >
                <span className={`w-2 h-2 rounded-full ${sub.status === 'DONE' ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span className="flex-1 text-sm text-gray-800">{sub.title}</span>
                {sub.assignee && <span className="text-xs text-gray-400">{sub.assignee.name}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Comments */}
      <div className="card p-4">
        <h3 className="font-semibold text-sm mb-3">
          Комментарии {task.comments?.length ? `(${task.comments.length})` : ''}
        </h3>

        <div className="space-y-3 mb-4">
          {task.comments?.map(comment => (
            <div key={comment.id} className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                {comment.author.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 bg-gray-50 rounded-lg px-3 py-2">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-sm font-medium">{comment.author.name}</span>
                  <span className="text-xs text-gray-400">
                    {format(new Date(comment.createdAt), 'd MMM HH:mm', { locale: ru })}
                  </span>
                </div>
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown>{comment.content}</ReactMarkdown>
                </div>
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={e => { e.preventDefault(); if (newComment.trim()) addComment.mutate(); }}
          className="space-y-2"
        >
          <textarea
            className="input resize-none"
            rows={3}
            placeholder="Написать комментарий... (@упоминания поддерживаются)"
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
          />
          <button
            type="submit"
            className="btn-primary text-xs"
            disabled={!newComment.trim() || addComment.isPending}
          >
            Отправить
          </button>
        </form>
      </div>

      {/* Audit log */}
      {(task.auditLogs?.length || 0) > 0 && (
        <div className="card p-4">
          <h3 className="font-semibold text-sm mb-2">История изменений</h3>
          <div className="space-y-1">
            {task.auditLogs?.map(log => (
              <div key={log.id} className="flex items-center gap-2 text-xs text-gray-500">
                <span className="font-medium text-gray-700">{log.user.name}</span>
                <span>{log.action}:</span>
                {log.oldValue && <span className="line-through text-gray-400">{log.oldValue}</span>}
                {log.newValue && <span className="text-gray-700">{log.newValue}</span>}
                <span className="ml-auto">
                  {format(new Date(log.createdAt), 'd MMM HH:mm', { locale: ru })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
