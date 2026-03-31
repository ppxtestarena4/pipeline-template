import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi, usersApi } from '../api';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export default function ProjectsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', memberIds: [] as string[] });

  const isManager = user?.role === 'MANAGER' || user?.role === 'ADMIN';

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', showArchived],
    queryFn: () => projectsApi.list(showArchived).then(r => r.data),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
    enabled: isManager,
  });

  const createProject = useMutation({
    mutationFn: () => projectsApi.create(form),
    onSuccess: () => {
      setForm({ name: '', description: '', memberIds: [] });
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  const archiveProject = useMutation({
    mutationFn: (id: string) => projectsApi.archive(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Проекты</h1>
        <div className="flex gap-2">
          <button
            className={`btn-secondary ${showArchived ? 'text-gray-900' : ''}`}
            onClick={() => setShowArchived(!showArchived)}
          >
            {showArchived ? 'Скрыть архив' : 'Архив'}
          </button>
          {isManager && (
            <button className="btn-primary" onClick={() => setShowCreate(true)}>
              + Проект
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Загрузка...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(project => (
            <div
              key={project.id}
              className={`card p-5 cursor-pointer hover:shadow-md transition-all ${
                project.archived ? 'opacity-60' : ''
              }`}
              onClick={() => navigate(`/board?projectId=${project.id}`)}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-gray-900 text-lg">{project.name}</h3>
                {isManager && !project.archived && (
                  <button
                    className="text-xs text-gray-300 hover:text-red-500 ml-2"
                    title="Архивировать"
                    onClick={e => {
                      e.stopPropagation();
                      if (confirm(`Архивировать проект «${project.name}»?`)) {
                        archiveProject.mutate(project.id);
                      }
                    }}
                  >
                    ⊘
                  </button>
                )}
              </div>

              {project.description && (
                <p className="text-sm text-gray-500 mb-3 line-clamp-2">{project.description}</p>
              )}

              <div className="flex items-center justify-between">
                <div className="flex -space-x-1">
                  {project.members.slice(0, 5).map(m => (
                    <div
                      key={m.user.id}
                      className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 border-2 border-white flex items-center justify-center text-xs font-bold"
                      title={m.user.name}
                    >
                      {m.user.name.slice(0, 1)}
                    </div>
                  ))}
                  {project.members.length > 5 && (
                    <div className="w-7 h-7 rounded-full bg-gray-100 text-gray-500 border-2 border-white flex items-center justify-center text-xs">
                      +{project.members.length - 5}
                    </div>
                  )}
                </div>
                <span className="text-xs text-gray-400">
                  {project._count?.tasks || 0} задач
                </span>
              </div>

              {project.archived && (
                <div className="mt-2">
                  <span className="badge bg-gray-100 text-gray-500 text-xs">Архив</span>
                </div>
              )}
            </div>
          ))}
          {projects.length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-400">
              {showArchived ? 'Нет архивных проектов' : 'Нет активных проектов'}
            </div>
          )}
        </div>
      )}

      {/* Create project modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Новый проект</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Название *</label>
                <input
                  className="input"
                  placeholder="Название проекта"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div>
                <label className="label">Описание</label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  placeholder="Markdown поддерживается..."
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Участники</label>
                <select
                  className="input"
                  multiple
                  value={form.memberIds}
                  onChange={e => {
                    const selected = Array.from(e.target.selectedOptions).map(o => o.value);
                    setForm(f => ({ ...f, memberIds: selected }));
                  }}
                >
                  {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </select>
                <p className="text-xs text-gray-400 mt-1">Ctrl+клик для множественного выбора</p>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button className="btn-secondary" onClick={() => setShowCreate(false)}>Отмена</button>
                <button
                  className="btn-primary"
                  disabled={!form.name.trim() || createProject.isPending}
                  onClick={() => createProject.mutate()}
                >
                  Создать
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
