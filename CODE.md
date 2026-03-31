# CODE.md — Память проекта pipeline-template

> Этот файл читается Codex-агентами перед выполнением задач.
> Обновляй его при изменении архитектуры или структуры проекта.

---

## Описание проекта

**pipeline-template** — универсальный шаблон автономного конвейера разработки на основе трёх Codex-агентов.

Используется для любого проекта, которому нужна автоматизированная разработка:
- Perplexity (или человек) создаёт задачи в виде GitHub Issues с детальной спецификацией
- Три Codex-агента (`Coder`, `Reviewer`, `Tester`) выполняют, проверяют и тестируют задачи автоматически
- Вся координация происходит через GitHub Projects (канбан-доска)
- Агенты работают в бесконечном цикле на VPS через systemd

---

## Технологический стек

| Компонент | Технология |
|-----------|-----------|
| Координация задач | GitHub Projects v2 (GraphQL API) |
| Управление кодом | Git + GitHub |
| Исполнение агентов | Codex CLI (`codex exec --full-auto`) |
| Автозапуск | systemd unit-файлы |
| API интеграция | `gh` CLI (GitHub CLI) |
| Логирование | `/var/log/bravo/` + systemd journal |
| VPS | Contabo (164.68.116.250), пользователь: agent |

---

## Диаграмма конвейера (ASCII)

```
┌─────────────────────────────────────────────────────────────────────┐
│                      GitHub Projects (канбан)                        │
│                                                                       │
│  Backlog → To Do → In Progress → Review → Testing → Done            │
│     │         │          │           │        │        │             │
│     │         │          │           │        │        │             │
│  Perplexity  Human    Coder       Reviewer  Tester   Human          │
│  (создаёт)  (одобр.) (кодирует)  (ревьюит) (тестир.) (закрывает)   │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
    VPS Contabo (164.68.116.250)
    ├── systemd: bravo-coder.service    → pipeline/coder-daemon.sh
    ├── systemd: bravo-reviewer.service → pipeline/reviewer-daemon.sh
    └── systemd: bravo-tester.service  → pipeline/tester-daemon.sh
         │
         ▼
    Каждый агент:
    while true; do
        задача = найти_в_своей_колонке()
        if задача:
            обработать(задача)
            переместить_в_следующую_колонку()
        sleep 300
    done
```

---

## Описание колонок канбана

| Колонка | ID | Кто управляет | Действие |
|---------|-----|---------------|---------|
| **Backlog** | `05d4d819` | Perplexity | Создаёт issue, ждёт одобрения |
| **To Do** | `04190f37` | Human | Одобрил задачу → Coder берёт |
| **In Progress** | `ddb5c782` | Coder | Активная разработка |
| **Review** | `714d42a7` | Reviewer | Code review + проверка спеки |
| **Testing** | `2366049c` | Tester | Спека-чеклист + тесты |
| **Done** | `21ff5a3b` | Human | Финальная проверка, закрытие |

---

## Ролевая матрица агентов

| Роль | Daemon | Берёт из | Двигает в | Gate |
|------|--------|----------|-----------|------|
| **Coder** | `coder-daemon.sh` | To Do | Review | Файлы изменены (`git status`) |
| **Reviewer** | `reviewer-daemon.sh` | Review | Testing / In Progress | Codex PASS |
| **Tester** | `tester-daemon.sh` | Testing | Done / In Progress | Codex PASS + тесты |

---

## Структура репозитория

```
pipeline-template/
├── .github/
│   ├── workflows/
│   │   └── ci.yml                  # Базовый CI (lint, test)
│   └── ISSUE_TEMPLATE/
│       └── task.md                 # Шаблон issue для задач
├── pipeline/
│   ├── common.sh                   # Общие функции: GraphQL API, логирование
│   ├── coder-daemon.sh             # Агент-программист (бесконечный цикл)
│   ├── reviewer-daemon.sh          # Агент-ревьюер (бесконечный цикл)
│   ├── tester-daemon.sh            # Агент-тестировщик (бесконечный цикл)
│   └── install.sh                  # Установщик на VPS
├── systemd/
│   ├── bravo-coder.service         # Systemd unit для Coder
│   ├── bravo-reviewer.service      # Systemd unit для Reviewer
│   └── bravo-tester.service        # Systemd unit для Tester
├── src/                            # Исходный код продукта (заполняется агентами)
├── tests/                          # Тесты (заполняется агентами)
├── CODE.md                         # ← Этот файл (память проекта)
└── README.md                       # Пользовательская документация
```

---

## Конфигурация GitHub Projects

```
Project ID:     PVT_kwHOD_OjOs4BS_m8
Status Field:   PVTSSF_lAHOD_OjOs4BS_m8zhAXbHg
Repo:           ppxtestarena4/pipeline-template
```

Все ID задаются в `pipeline/common.sh` в массиве `COLUMN_IDS`.

---

## VPS — детали сервера

```
IP:       164.68.116.250
Пользователь: agent
Домашний каталог: /home/agent/
Репозиторий: /home/agent/pipeline-template/
Логи:     /var/log/bravo/
```

### Полезные команды на VPS

```bash
# Статус агентов
systemctl status bravo-coder bravo-reviewer bravo-tester

# Логи в реальном времени
journalctl -u bravo-coder -f
journalctl -u bravo-reviewer -f
journalctl -u bravo-tester -f

# Файловые логи
tail -f /var/log/bravo/coder.log
tail -f /var/log/bravo/reviewer.log
tail -f /var/log/bravo/tester.log

# Перезапуск
systemctl restart bravo-coder

# Остановить всё
systemctl stop bravo-coder bravo-reviewer bravo-tester
```

---

## Клонирование для нового проекта

### 1. Склонировать шаблон

```bash
git clone https://github.com/ppxtestarena4/pipeline-template.git my-new-project
cd my-new-project

# Обновить origin на новый репозиторий
git remote set-url origin https://github.com/YOUR_ORG/YOUR_REPO.git
git push -u origin main
```

### 2. Создать GitHub Project

1. Создай новый **GitHub Projects v2** для репозитория
2. Добавь колонки: `Backlog`, `To Do`, `In Progress`, `Review`, `Testing`, `Done`
3. Запиши Project ID и Field ID (через GraphQL API или UI)

```bash
# Получить ID проекта
gh api graphql -f query='{ viewer { projectsV2(first: 10) { nodes { id title } } } }'
```

### 3. Обновить конфигурацию

В файле `pipeline/common.sh` замени:

```bash
PIPELINE_REPO="YOUR_ORG/YOUR_REPO"
PROJECT_ID="YOUR_PROJECT_ID"
STATUS_FIELD_ID="YOUR_STATUS_FIELD_ID"
COLUMN_IDS=(...)  # Замени все option IDs
```

### 4. Запустить установщик на VPS

```bash
ssh agent@YOUR_VPS_IP
git clone https://github.com/YOUR_ORG/YOUR_REPO.git
cd YOUR_REPO
sudo bash pipeline/install.sh
```

### 5. Обновить CODE.md

Обнови этот файл для нового проекта: описание, стек, VPS-данные.

---

## Защитные механизмы

1. **Блокировка задачи** — агент назначает issue на себя (`assignee`), другие агенты пропускают назначенные задачи
2. **Таймаут codex** — 30 мин для Coder, 15 мин для Reviewer и Tester
3. **Gate-проверки** — Coder: `git status --porcelain` не пуст; Reviewer/Tester: `VERDICT: PASS` в выводе Codex
4. **Fallback при ошибке** — любая ошибка → лог + комментарий в issue + задача остаётся в колонке
5. **Логирование** — все действия в `/var/log/bravo/<daemon>.log` и systemd journal

---

## Соглашения о коде

- Все bash-скрипты начинаются с `set -euo pipefail`
- Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`
- Ссылки на issue в коммитах: `Refs: #N`
- Комментарии в коде — английские, документация — русская
- Логи пишутся через функцию `log()` из `common.sh`

---

---

## Система управления задачами (Issue #2 — BRD v1.4)

Полноценная система управления задачами для гибридных команд (люди + AI-агенты).

### Структура

```
src/
├── backend/                    # Node.js + Express + TypeScript
│   ├── prisma/
│   │   ├── schema.prisma       # Схема БД (PostgreSQL)
│   │   ├── seed.ts             # Тестовые данные
│   │   └── migrations/         # SQL-миграции
│   ├── src/
│   │   ├── index.ts            # Точка входа, WebSocket
│   │   ├── db.ts               # Prisma client
│   │   ├── middleware/
│   │   │   ├── auth.ts         # JWT + API-токен авторизация
│   │   │   └── error.ts        # Обработка ошибок
│   │   ├── routes/
│   │   │   ├── auth.ts         # POST /login, /register, /create-agent, GET /me
│   │   │   ├── users.ts        # CRUD пользователей, direct reports
│   │   │   ├── projects.ts     # CRUD проектов, статистика
│   │   │   ├── tasks.ts        # CRUD задач, kanban, subtasks, comments
│   │   │   ├── reports.ts      # Отчёты (3-уровневая иерархия), модерация
│   │   │   ├── intake.ts       # Intake pipeline: текст/файл → AI → задачи
│   │   │   ├── notifications.ts # Уведомления
│   │   │   └── goals.ts        # Еженедельные цели
│   │   └── services/
│   │       ├── ai.ts           # Claude API: извлечение задач, маршрутизация
│   │       └── notifications.ts # WebSocket push, createNotification()
│   ├── Dockerfile
│   └── package.json
│
├── frontend/                   # React 18 + TypeScript + Vite + Tailwind
│   ├── src/
│   │   ├── api/                # Axios-клиент + все API-запросы
│   │   ├── components/
│   │   │   ├── Layout.tsx      # Sidebar + header + notifications
│   │   │   ├── TaskCard.tsx    # Карточка задачи с метаданными
│   │   │   ├── TaskModal.tsx   # Модальное окно создания задачи
│   │   │   ├── DirectReportTabs.tsx # Переключатель direct reports
│   │   │   └── NotificationPanel.tsx
│   │   ├── hooks/
│   │   │   └── useAuth.ts      # Auth context + login/logout
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── DashboardPage.tsx  # Обзор + статистика по сотруднику
│   │   │   ├── KanbanPage.tsx     # Drag & drop канбан (dnd-kit)
│   │   │   ├── TaskDetailPage.tsx # Детали, subtasks, комментарии, audit log
│   │   │   ├── ReportsPage.tsx    # Генерация отчётов, 3 уровня
│   │   │   ├── IntakePage.tsx     # Drag & drop файлов, модерация задач
│   │   │   ├── GoalsPage.tsx      # Еженедельные цели
│   │   │   └── ProjectsPage.tsx   # Управление проектами
│   │   └── types/index.ts      # TypeScript-типы
│   ├── Dockerfile
│   └── package.json
│
nginx/
│   └── nginx.conf              # Reverse proxy: API + WS + SPA
│
docker-compose.yml              # postgres + backend + frontend + nginx
.env.example                    # Шаблон переменных окружения
```

### Запуск для разработки

```bash
# 1. Запустить PostgreSQL
docker run -e POSTGRES_DB=techtcb -e POSTGRES_USER=techtcb \
  -e POSTGRES_PASSWORD=techtcb_secret -p 5432:5432 postgres:16-alpine

# 2. Backend
cd src/backend
cp .env.example .env       # отредактируй при необходимости
npm install
npm run db:migrate:dev
npm run db:seed
npm run dev

# 3. Frontend
cd src/frontend
npm install
npm run dev
```

### Деплой через Docker Compose

```bash
cp .env.example .env       # Заполни все переменные
docker compose up -d
docker compose exec backend npm run db:seed   # опционально
```

### API для AI-агентов (FR-41–FR-45)

```bash
# Получить задачи в колонке TODO
curl -H "Authorization: Bearer <api_token>" \
  http://localhost/api/tasks?status=TODO&assigneeId=<agent_id>

# Взять задачу (переместить в IN_PROGRESS)
curl -X POST -H "Authorization: Bearer <api_token>" \
  -H "Content-Type: application/json" \
  -d '{"status":"IN_PROGRESS"}' \
  http://localhost/api/tasks/<task_id>/move

# Добавить комментарий
curl -X POST -H "Authorization: Bearer <api_token>" \
  -H "Content-Type: application/json" \
  -d '{"content":"Выполнено. VERDICT: PASS"}' \
  http://localhost/api/tasks/<task_id>/comments
```

### Основные учётные данные (seed)

| Роль | Email | Пароль |
|------|-------|--------|
| Администратор | admin@techtcb.local | admin123 |
| Руководитель | manager@techtcb.local | manager123 |
| Сотрудник | melnikov@techtcb.local | employee123 |

*Последнее обновление: 2026-03-31*
