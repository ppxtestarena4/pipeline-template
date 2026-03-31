import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reportsApi, usersApi } from '../api';
import { useAuth } from '../hooks/useAuth';
import { format, startOfWeek, endOfWeek, subWeeks } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { ReportData } from '../types';
import { useNavigate } from 'react-router-dom';

const periodOptions = [
  { label: 'Эта неделя', value: 'week' },
  { label: '2 недели', value: '2weeks' },
  { label: 'Месяц', value: 'month' },
];

function getPeriod(value: string): { start: string; end: string } {
  const now = new Date();
  const end = format(now, 'yyyy-MM-dd');
  if (value === 'week') {
    const start = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    return { start, end };
  }
  if (value === '2weeks') {
    const start = format(subWeeks(now, 2), 'yyyy-MM-dd');
    return { start, end };
  }
  // month
  const start = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
  return { start, end };
}

function ReportSection({ title, emoji, tasks, level }: {
  title: string; emoji: string; tasks: ReportData['level1']; level: 1 | 2 | 3;
}) {
  const navigate = useNavigate();
  if (tasks.length === 0) return null;

  return (
    <div className="mb-4">
      <h4 className="text-sm font-semibold text-gray-700 mb-2">{emoji} {title}</h4>
      <div className="space-y-2">
        {tasks.map(task => {
          const completed = task.subtasks.filter(s => s.completed).length;
          const total = task.subtasks.length;
          return (
            <div
              key={task.id}
              className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100"
              onClick={() => navigate(`/tasks/${task.id}`)}
            >
              <span className="text-sm">
                {level === 1 ? '✅' : level === 2 ? '◔' : '○'}
              </span>
              <span className="flex-1 text-sm text-gray-800">{task.title}</span>
              {total > 0 && (
                <span className="text-xs text-gray-400 font-medium">{completed}/{total}</span>
              )}
              <span className={`badge text-xs ${task.category === 'RUN' ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'}`}>
                {task.category}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedPeriod, setSelectedPeriod] = useState('week');
  const [selectedUserId, setSelectedUserId] = useState(user!.id);
  const [comment, setComment] = useState('');
  const [managerComment, setManagerComment] = useState('');

  const { start, end } = getPeriod(selectedPeriod);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
    enabled: user?.role === 'MANAGER' || user?.role === 'ADMIN',
  });

  const { data: reportData, isLoading } = useQuery({
    queryKey: ['report-generate', selectedUserId, start, end],
    queryFn: () => reportsApi.generate({
      userId: selectedUserId,
      periodStart: start,
      periodEnd: end,
    }).then(r => r.data),
  });

  const { data: existingReports = [] } = useQuery({
    queryKey: ['reports', selectedUserId, start, end],
    queryFn: () => reportsApi.list({ userId: selectedUserId, periodStart: start, periodEnd: end }).then(r => r.data),
  });

  const latestReport = existingReports[0];

  const submitReport = useMutation({
    mutationFn: () => reportsApi.create({ periodStart: start, periodEnd: end, comment }),
    onSuccess: () => {
      setComment('');
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });

  const approveReport = useMutation({
    mutationFn: (id: string) => reportsApi.update(id, { status: 'APPROVED', managerComment }),
    onSuccess: () => {
      setManagerComment('');
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });

  const commentReport = useMutation({
    mutationFn: (id: string) => reportsApi.update(id, { status: 'COMMENTED', managerComment }),
    onSuccess: () => {
      setManagerComment('');
      qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });

  const isManager = user?.role === 'MANAGER' || user?.role === 'ADMIN';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Отчёты</h1>

        <div className="flex gap-2 items-center flex-wrap">
          {/* Period selector */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {periodOptions.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSelectedPeriod(opt.value)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                  selectedPeriod === opt.value
                    ? 'bg-white shadow-sm text-gray-900'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* User selector (for managers) */}
          {isManager && (
            <select
              className="input w-auto text-sm"
              value={selectedUserId}
              onChange={e => setSelectedUserId(e.target.value)}
            >
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Генерация отчёта...</div>
      ) : reportData ? (
        <div className="space-y-4">
          {/* Summary metrics */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">
                {reportData.user?.name} — отчёт за период
              </h2>
              <span className="text-sm text-gray-500">
                {format(new Date(reportData.periodStart), 'd MMM', { locale: ru })} –{' '}
                {format(new Date(reportData.periodEnd), 'd MMM', { locale: ru })}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{reportData.metrics.totalDone}</div>
                <div className="text-xs text-gray-500">Выполнено</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">{reportData.metrics.totalInProgress}</div>
                <div className="text-xs text-gray-500">В работе</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{reportData.metrics.totalBlocked}</div>
                <div className="text-xs text-gray-500">Заблокировано</div>
              </div>
            </div>
          </div>

          {/* 3-level hierarchy */}
          <div className="card p-4">
            <h3 className="font-semibold mb-4">Выполненные задачи</h3>
            <ReportSection
              title="Уровень 1: Полностью выполненные (поставленные руководителем)"
              emoji="⭐"
              tasks={reportData.level1}
              level={1}
            />
            <ReportSection
              title="Уровень 2: Частично выполненные (поставленные руководителем)"
              emoji="🔶"
              tasks={reportData.level2}
              level={2}
            />
            <ReportSection
              title="Уровень 3: Выполненные самостоятельно"
              emoji="○"
              tasks={reportData.level3}
              level={3}
            />
            {reportData.level1.length === 0 && reportData.level2.length === 0 && reportData.level3.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">Нет выполненных задач за период</p>
            )}
          </div>

          {/* In progress */}
          {reportData.inProgress.length > 0 && (
            <div className="card p-4">
              <h3 className="font-semibold mb-3">В работе</h3>
              <div className="space-y-1">
                {reportData.inProgress.map(task => (
                  <div key={task.id} className="flex items-center gap-2 text-sm py-1">
                    <span className="text-yellow-500">●</span>
                    <span className="text-gray-800">{task.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Blocked */}
          {reportData.blocked.length > 0 && (
            <div className="card p-4 border-red-100">
              <h3 className="font-semibold mb-3 text-red-700">Заблокировано</h3>
              <div className="space-y-1">
                {reportData.blocked.map(task => (
                  <div key={task.id} className="flex items-center gap-2 text-sm py-1">
                    <span className="text-red-500">⛔</span>
                    <span className="text-gray-800">{task.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Employee comment + submit */}
          {selectedUserId === user!.id && !latestReport && (
            <div className="card p-4">
              <h3 className="font-semibold mb-2">Комментарий к отчёту</h3>
              <textarea
                className="input resize-none mb-3"
                rows={3}
                placeholder="Добавьте пояснения, блокеры, планы..."
                value={comment}
                onChange={e => setComment(e.target.value)}
              />
              <button
                className="btn-primary"
                onClick={() => submitReport.mutate()}
                disabled={submitReport.isPending}
              >
                Сдать отчёт
              </button>
            </div>
          )}

          {/* Submitted report status */}
          {latestReport && (
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`badge ${
                  latestReport.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                  latestReport.status === 'COMMENTED' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-blue-100 text-blue-700'
                }`}>
                  {latestReport.status === 'APPROVED' ? 'Утверждён' :
                   latestReport.status === 'COMMENTED' ? 'С замечаниями' : 'Сдан'}
                </span>
                <span className="text-sm text-gray-500">
                  {format(new Date(latestReport.createdAt), 'd MMM HH:mm', { locale: ru })}
                </span>
              </div>
              {latestReport.comment && (
                <p className="text-sm text-gray-700 mb-2">
                  <span className="font-medium">Комментарий:</span> {latestReport.comment}
                </p>
              )}
              {latestReport.managerComment && (
                <p className="text-sm text-gray-700">
                  <span className="font-medium">Руководитель:</span> {latestReport.managerComment}
                </p>
              )}

              {/* Manager actions */}
              {isManager && selectedUserId !== user!.id && latestReport.status === 'SUBMITTED' && (
                <div className="mt-3 space-y-2">
                  <textarea
                    className="input resize-none text-sm"
                    rows={2}
                    placeholder="Комментарий руководителя..."
                    value={managerComment}
                    onChange={e => setManagerComment(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      className="btn-primary text-sm"
                      onClick={() => approveReport.mutate(latestReport.id)}
                      disabled={approveReport.isPending}
                    >
                      ✓ Утвердить
                    </button>
                    <button
                      className="btn-secondary text-sm"
                      onClick={() => commentReport.mutate(latestReport.id)}
                      disabled={commentReport.isPending || !managerComment.trim()}
                    >
                      Оставить замечание
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
