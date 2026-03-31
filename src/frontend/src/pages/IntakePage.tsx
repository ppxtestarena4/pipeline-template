import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { intakeApi, usersApi, projectsApi } from '../api';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import type { Intake, IntakeTask } from '../types';

const statusLabels: Record<string, string> = {
  PENDING: 'Ожидает',
  PROCESSING: 'Обработка',
  READY_FOR_MODERATION: 'Готово к модерации',
  MODERATED: 'Модерировано',
  FAILED: 'Ошибка',
};

const statusColors: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  PROCESSING: 'bg-yellow-100 text-yellow-700',
  READY_FOR_MODERATION: 'bg-blue-100 text-blue-700',
  MODERATED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

export default function IntakePage() {
  const qc = useQueryClient();
  const [textInput, setTextInput] = useState('');
  const [dragging, setDragging] = useState(false);
  const [selectedIntake, setSelectedIntake] = useState<Intake | null>(null);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: intakes = [], isLoading } = useQuery({
    queryKey: ['intakes'],
    queryFn: () => intakeApi.list().then(r => r.data),
    refetchInterval: 5000, // Poll for status updates
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list().then(r => r.data),
  });

  const submitText = useMutation({
    mutationFn: () => intakeApi.submitText(textInput),
    onSuccess: () => {
      setTextInput('');
      qc.invalidateQueries({ queryKey: ['intakes'] });
    },
  });

  const uploadFile = useMutation({
    mutationFn: (file: File) => intakeApi.uploadFile(file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intakes'] }),
  });

  const updateTask = useMutation({
    mutationFn: ({ intakeId, taskId, data }: { intakeId: string; taskId: string; data: Partial<IntakeTask> }) =>
      intakeApi.updateTask(intakeId, taskId, data as any),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intakes'] }),
  });

  const confirmTasks = useMutation({
    mutationFn: ({ intakeId, ids }: { intakeId: string; ids: string[] }) =>
      intakeApi.confirm(intakeId, ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['intakes'] });
      setSelectedIntake(null);
      setConfirmedIds(new Set());
    },
  });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => uploadFile.mutate(file));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => uploadFile.mutate(file));
    e.target.value = '';
  };

  const toggleConfirm = (id: string) => {
    setConfirmedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openIntake = (intake: Intake) => {
    setSelectedIntake(intake);
    // Pre-select all unconfirmed tasks
    const ids = intake.intakeTasks.filter(t => !t.confirmed && t.assigneeId && t.projectId).map(t => t.id);
    setConfirmedIds(new Set(ids));
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Входящие (Intake Pipeline)</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Input section */}
        <div className="space-y-4">
          {/* File drop zone */}
          <div
            className={`card p-6 border-2 border-dashed cursor-pointer transition-colors ${
              dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
            }`}
            onDragEnter={() => setDragging(true)}
            onDragLeave={() => setDragging(false)}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="text-center">
              <div className="text-3xl mb-2">📎</div>
              <p className="text-sm font-medium text-gray-700">
                Перетащите файл или нажмите для выбора
              </p>
              <p className="text-xs text-gray-400 mt-1">
                MP3, WAV, M4A, PDF, TXT, MD — до 100 МБ
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".mp3,.wav,.m4a,.pdf,.txt,.md"
              multiple
              onChange={handleFileSelect}
            />
          </div>

          {/* Text input */}
          <div className="card p-4">
            <label className="label">Ввести текст / транскрипт</label>
            <textarea
              className="input resize-none mb-3"
              rows={6}
              placeholder="Вставьте транскрипт встречи, поручения из письма или любой текст с задачами..."
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
            />
            <button
              className="btn-primary"
              disabled={!textInput.trim() || submitText.isPending}
              onClick={() => submitText.mutate()}
            >
              {submitText.isPending ? 'Обработка...' : 'Извлечь задачи'}
            </button>
          </div>
        </div>

        {/* Intake list */}
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="font-semibold text-sm">История входящих</h2>
          </div>
          <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
            {isLoading && (
              <div className="text-center py-6 text-gray-400 text-sm">Загрузка...</div>
            )}
            {intakes.length === 0 && !isLoading && (
              <div className="text-center py-6 text-gray-400 text-sm">Пусто</div>
            )}
            {intakes.map(intake => (
              <div
                key={intake.id}
                className="px-4 py-3 hover:bg-gray-50 cursor-pointer"
                onClick={() => intake.status === 'READY_FOR_MODERATION' && openIntake(intake)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-800">
                    {intake.originalName || `${intake.fileType || 'Текст'} — ${format(new Date(intake.createdAt), 'd MMM HH:mm', { locale: ru })}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`badge text-xs ${statusColors[intake.status]}`}>
                    {statusLabels[intake.status]}
                  </span>
                  {intake.intakeTasks.length > 0 && (
                    <span className="text-xs text-gray-400">
                      {intake.intakeTasks.length} задач
                    </span>
                  )}
                  {intake.status === 'READY_FOR_MODERATION' && (
                    <span className="text-xs text-blue-600 font-medium">Нажмите для модерации →</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Moderation modal */}
      {selectedIntake && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Модерация задач</h2>
              <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={() => setSelectedIntake(null)}>×</button>
            </div>

            <div className="p-6 space-y-4">
              {/* Meeting notes */}
              {selectedIntake.meetingNotes && (() => {
                try {
                  const notes = JSON.parse(selectedIntake.meetingNotes);
                  return (
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h3 className="text-sm font-semibold mb-2">Записка встречи</h3>
                      {notes.summary && <p className="text-sm text-gray-700 mb-2">{notes.summary}</p>}
                      {notes.decisions?.length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 font-medium mb-1">Решения:</p>
                          <ul className="text-sm text-gray-700 space-y-0.5 list-disc list-inside">
                            {notes.decisions.map((d: string, i: number) => <li key={i}>{d}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                } catch { return null; }
              })()}

              {/* Task list */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-3">
                  Выберите задачи для подтверждения ({confirmedIds.size} из {selectedIntake.intakeTasks.length}):
                </p>
                <div className="space-y-3">
                  {selectedIntake.intakeTasks.map(task => (
                    <div
                      key={task.id}
                      className={`border rounded-lg p-3 transition-colors ${
                        confirmedIds.has(task.id) ? 'border-blue-300 bg-blue-50' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={confirmedIds.has(task.id)}
                          onChange={() => toggleConfirm(task.id)}
                        />
                        <div className="flex-1 space-y-2">
                          <input
                            className="input text-sm py-1"
                            value={task.title}
                            onChange={e => updateTask.mutate({
                              intakeId: selectedIntake.id,
                              taskId: task.id,
                              data: { title: e.target.value },
                            })}
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-gray-500 mb-0.5 block">Исполнитель</label>
                              <select
                                className="input text-xs py-1"
                                value={task.assigneeId || ''}
                                onChange={e => updateTask.mutate({
                                  intakeId: selectedIntake.id,
                                  taskId: task.id,
                                  data: { assigneeId: e.target.value || undefined },
                                })}
                              >
                                <option value="">Не назначен</option>
                                {users.map(u => (
                                  <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 mb-0.5 block">Проект</label>
                              <select
                                className="input text-xs py-1"
                                value={task.projectId || ''}
                                onChange={e => updateTask.mutate({
                                  intakeId: selectedIntake.id,
                                  taskId: task.id,
                                  data: { projectId: e.target.value || undefined },
                                })}
                              >
                                <option value="">Без проекта</option>
                                {projects.map(p => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  className="btn-primary flex-1 justify-center"
                  disabled={confirmedIds.size === 0 || confirmTasks.isPending}
                  onClick={() => confirmTasks.mutate({
                    intakeId: selectedIntake.id,
                    ids: Array.from(confirmedIds),
                  })}
                >
                  {confirmTasks.isPending ? 'Создание задач...' : `Создать ${confirmedIds.size} задач(и)`}
                </button>
                <button className="btn-secondary" onClick={() => setSelectedIntake(null)}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
