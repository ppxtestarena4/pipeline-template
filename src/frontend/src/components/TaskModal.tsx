import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi, projectsApi, usersApi } from '../api';
import type { Task, TaskPriority, TaskCategory } from '../types';

interface Props {
  projectId?: string;
  parentTaskId?: string;
  onClose: () => void;
  onCreate?: (task: Task) => void;
}

export default function TaskModal({ projectId, parentTaskId, onClose, onCreate }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: '',
    description: '',
    assigneeId: '',
    priority: 'MEDIUM' as TaskPriority,
    category: 'RUN' as TaskCategory,
    deadline: '',
    projectId: projectId || '',
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list().then(r => r.data),
    enabled: !projectId,
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: (data: typeof form) =>
      tasksApi.create({ ...data, parentTaskId }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      onCreate?.(res.data);
      onClose();
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.projectId) return;
    mutation.mutate(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Новая задача</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Название *</label>
            <input
              className="input"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Что нужно сделать?"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="label">Описание</label>
            <textarea
              className="input resize-none"
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Markdown поддерживается..."
            />
          </div>

          {!projectId && (
            <div>
              <label className="label">Проект *</label>
              <select
                className="input"
                value={form.projectId}
                onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}
                required
              >
                <option value="">Выберите проект</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Категория</label>
              <select
                className="input"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as TaskCategory }))}
              >
                <option value="RUN">Run (текущие)</option>
                <option value="CHANGE">Change (стратегические)</option>
              </select>
            </div>
            <div>
              <label className="label">Приоритет</label>
              <select
                className="input"
                value={form.priority}
                onChange={e => setForm(f => ({ ...f, priority: e.target.value as TaskPriority }))}
              >
                <option value="LOW">Низкий</option>
                <option value="MEDIUM">Средний</option>
                <option value="HIGH">Высокий</option>
                <option value="CRITICAL">Критический</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Исполнитель</label>
              <select
                className="input"
                value={form.assigneeId}
                onChange={e => setForm(f => ({ ...f, assigneeId: e.target.value }))}
              >
                <option value="">Не назначен</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Дедлайн</label>
              <input
                type="date"
                className="input"
                value={form.deadline}
                onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex gap-2 pt-2 justify-end">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Отмена
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={mutation.isPending || !form.title.trim()}
            >
              {mutation.isPending ? 'Создание...' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
