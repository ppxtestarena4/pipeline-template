import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import { usersApi, tasksApi, projectsApi } from '../api';
import DirectReportTabs from '../components/DirectReportTabs';
import { useNavigate } from 'react-router-dom';

const statusLabels: Record<string, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'В работе',
  REVIEW: 'Review',
  TESTING: 'Testing',
  DONE: 'Готово',
};

const statusColors: Record<string, string> = {
  BACKLOG: 'bg-gray-100 text-gray-700',
  TODO: 'bg-blue-50 text-blue-700',
  IN_PROGRESS: 'bg-yellow-50 text-yellow-700',
  REVIEW: 'bg-purple-50 text-purple-700',
  TESTING: 'bg-indigo-50 text-indigo-700',
  DONE: 'bg-green-50 text-green-700',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);

  const { data: currentUserData } = useQuery({
    queryKey: ['user', 'me-full'],
    queryFn: () => usersApi.get(user!.id).then(r => r.data),
  });

  const directReports = currentUserData?.directReports || [];
  const viewingUserId = selectedReportId || user!.id;

  // Tasks for the selected user
  const { data: taskData } = useQuery({
    queryKey: ['tasks', 'dashboard', viewingUserId],
    queryFn: () => tasksApi.list({ assigneeId: viewingUserId, limit: 100 }).then(r => r.data),
  });

  const tasks = taskData?.tasks || [];

  // Count by status
  const byStatus = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});

  // Projects
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list().then(r => r.data),
  });

  const visibleProjects = selectedReportId
    ? projects.filter(p => p.ownerId === selectedReportId || p.members.some(m => m.user.id === selectedReportId))
    : projects;

  // Attention tasks (overdue or blocked) per user for badges
  const attentionCounts: Record<string, number> = {};
  for (const report of directReports) {
    attentionCounts[report.id] = 0; // Would be populated with real data
  }

  const viewingName = selectedReportId
    ? directReports.find(r => r.id === selectedReportId)?.name
    : 'Мои задачи';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Дашборд</h1>
      </div>

      {/* Direct report switcher */}
      {(user?.role === 'MANAGER' || user?.role === 'ADMIN') && directReports.length > 0 && (
        <div>
          <DirectReportTabs
            currentUser={user!}
            directReports={directReports as any}
            selectedId={selectedReportId}
            onSelect={setSelectedReportId}
            taskCounts={attentionCounts}
          />
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {Object.entries(statusLabels).map(([status, label]) => (
          <div
            key={status}
            className="card p-3 cursor-pointer hover:shadow-md"
            onClick={() => navigate(`/board?assigneeId=${viewingUserId}&status=${status}`)}
          >
            <div className={`badge ${statusColors[status]} mb-1`}>{label}</div>
            <div className="text-2xl font-bold text-gray-900">{byStatus[status] || 0}</div>
          </div>
        ))}
      </div>

      {/* Projects overview */}
      <div>
        <h2 className="text-lg font-semibold mb-3">
          Проекты {viewingName ? `— ${viewingName}` : ''}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleProjects.map(project => (
            <div
              key={project.id}
              className="card p-4 cursor-pointer hover:shadow-md"
              onClick={() => navigate(`/board?projectId=${project.id}`)}
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-gray-900">{project.name}</h3>
                <span className="text-xs text-gray-400">{project._count?.tasks || 0} задач</span>
              </div>
              {project.description && (
                <p className="text-sm text-gray-500 line-clamp-2 mb-3">{project.description}</p>
              )}
              <div className="flex items-center gap-1">
                {project.members.slice(0, 5).map(m => (
                  <div
                    key={m.user.id}
                    className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold"
                    title={m.user.name}
                  >
                    {m.user.name.slice(0, 1)}
                  </div>
                ))}
                {project.members.length > 5 && (
                  <span className="text-xs text-gray-400">+{project.members.length - 5}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent tasks */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Последние задачи</h2>
          <button
            className="text-sm text-blue-600 hover:underline"
            onClick={() => navigate(`/board?assigneeId=${viewingUserId}`)}
          >
            Все задачи →
          </button>
        </div>
        <div className="space-y-2">
          {tasks.slice(0, 8).map(task => (
            <div
              key={task.id}
              className="card px-4 py-3 flex items-center gap-3 cursor-pointer hover:shadow-sm"
              onClick={() => navigate(`/tasks/${task.id}`)}
            >
              <span className={`badge text-xs ${statusColors[task.status]}`}>
                {statusLabels[task.status]}
              </span>
              <span className="flex-1 text-sm text-gray-800 truncate">{task.title}</span>
              {task.assignee && (
                <span className="text-xs text-gray-400">{task.assignee.name}</span>
              )}
              {task.deadline && (
                <span className={`text-xs ${new Date(task.deadline) < new Date() && task.status !== 'DONE' ? 'text-red-500' : 'text-gray-400'}`}>
                  {new Date(task.deadline).toLocaleDateString('ru')}
                </span>
              )}
            </div>
          ))}
          {tasks.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">Задач нет</p>
          )}
        </div>
      </div>
    </div>
  );
}
