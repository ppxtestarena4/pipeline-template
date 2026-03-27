# pipeline-template

Универсальный шаблон автономного конвейера разработки на основе трёх Codex-агентов и GitHub Projects.

---

## Что это такое

**pipeline-template** — готовая инфраструктура для автоматической разработки программного обеспечения:

- **Perplexity** (или человек) создаёт задачи в GitHub Issues с детальными спецификациями
- **Три Codex-агента** на VPS выполняют задачи автоматически, без участия человека:
  - `Coder` — берёт задачу, реализует код, пушит в ветку
  - `Reviewer` — проверяет код на соответствие спецификации
  - `Tester` — проверяет по чеклисту, запускает тесты, создаёт PR
- Вся координация через **GitHub Projects v2** (канбан: Backlog → To Do → In Progress → Review → Testing → Done)
- Агенты работают **непрерывно** как systemd-сервисы — перезапускаются автоматически после ребута

Шаблон клонируется для каждого нового проекта и настраивается за 10 минут.

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Projects (канбан)                       │
│                                                                   │
│  Backlog ──► To Do ──► In Progress ──► Review ──► Testing ──► Done
│     │           │                                              │  │
│  Perplexity   Human                                         Tester│
│  создаёт      одобряет                                   создаёт PR
│                                                                   │
└────────────────────────────┬────────────────────────────────────-┘
                             │
                    VPS (systemd)
                    ├── bravo-coder.service
                    │     └─ coder-daemon.sh (опрос каждые 5 мин)
                    │         To Do → [codex exec] → Review
                    │
                    ├── bravo-reviewer.service
                    │     └─ reviewer-daemon.sh (опрос каждые 5 мин)
                    │         Review → [codex exec] → Testing / In Progress
                    │
                    └── bravo-tester.service
                          └─ tester-daemon.sh (опрос каждые 5 мин)
                              Testing → [codex exec] → Done / In Progress
```

---

## Быстрый старт

### 1. Клонировать шаблон

```bash
git clone https://github.com/ppxtestarena4/pipeline-template.git my-project
cd my-project
git remote set-url origin https://github.com/YOUR_ORG/YOUR_REPO.git
git push -u origin main
```

### 2. Настроить GitHub Project

1. Создай новый **GitHub Projects v2** для репозитория
2. Добавь колонки: `Backlog`, `To Do`, `In Progress`, `Review`, `Testing`, `Done`
3. Обнови ID в `pipeline/common.sh`:

```bash
PIPELINE_REPO="YOUR_ORG/YOUR_REPO"
PROJECT_ID="YOUR_PROJECT_ID"
STATUS_FIELD_ID="YOUR_STATUS_FIELD_ID"
declare -A COLUMN_IDS=(
    ["Backlog"]="OPTION_ID"
    ["To Do"]="OPTION_ID"
    ...
)
```

### 3. Развернуть на VPS

```bash
ssh agent@YOUR_VPS_IP

# Клонировать репозиторий
git clone https://github.com/YOUR_ORG/YOUR_REPO.git
cd YOUR_REPO

# Авторизовать инструменты
gh auth login
codex auth   # или задать OPENAI_API_KEY

# Установить агентов
sudo bash pipeline/install.sh
```

Установщик:
- Создаёт `/var/log/bravo/`
- Копирует systemd unit-файлы в `/etc/systemd/system/`
- Запрашивает `OPENAI_API_KEY` и `PIPELINE_REPO`
- Включает и запускает все три сервиса

---

## Как добавлять задачи через Perplexity

1. Открой репозиторий на GitHub → **Issues** → **New Issue**
2. Выбери шаблон **«Задача Bravo»**
3. Заполни спецификацию:
   - **Описание** — что нужно сделать (1-2 предложения)
   - **Спецификация** — детальные требования к реализации
   - **Файлы** — чеклист файлов для создания/изменения
   - **Критерии готовности** — по чему Tester поймёт, что всё сделано
4. Добавь issue в GitHub Project в колонку **Backlog**
5. После проверки переведи в **To Do** — Coder подхватит автоматически

### Пример хорошей спецификации

```markdown
## Описание
Добавить эндпоинт /api/users, возвращающий список пользователей.

## Спецификация
- GET /api/users → JSON массив [{id, name, email}]
- Лимит 100 записей, поддержка ?page=N
- Обработка ошибок: 500 с сообщением при сбое БД

## Файлы
- [ ] `src/routes/users.py` — роутер
- [ ] `tests/test_users.py` — тесты

## Критерии готовности
- [ ] Эндпоинт возвращает корректный JSON
- [ ] Пагинация работает
- [ ] Тест покрывает happy path и ошибку
```

---

## Мониторинг агентов

### Статус сервисов

```bash
systemctl status bravo-coder bravo-reviewer bravo-tester
```

### Логи в реальном времени

```bash
# Через journalctl
journalctl -u bravo-coder -f
journalctl -u bravo-reviewer -f
journalctl -u bravo-tester -f

# Через файлы
tail -f /var/log/bravo/coder.log
tail -f /var/log/bravo/reviewer.log
tail -f /var/log/bravo/tester.log
```

### Управление

```bash
# Перезапустить агента
systemctl restart bravo-coder

# Остановить всех
systemctl stop bravo-coder bravo-reviewer bravo-tester

# Запустить всех
systemctl start bravo-coder bravo-reviewer bravo-tester
```

---

## Клонирование для нового проекта

1. **Клонируй** этот репозиторий (см. выше)
2. **Обнови** `pipeline/common.sh` — Project ID, Field ID, Column IDs, Repo
3. **Обнови** `CODE.md` — описание нового проекта, VPS-данные
4. **Запусти** `pipeline/install.sh` на VPS
5. **Создай** первую задачу через шаблон issue и добавь в `To Do`

Один VPS может обслуживать несколько проектов — запускай агентов с разными `PIPELINE_REPO`.

---

## Требования

| Компонент | Версия |
|-----------|--------|
| VPS OS | Ubuntu 22.04+ / Debian 12+ |
| `gh` CLI | 2.x+ (авторизован через `gh auth login`) |
| `codex` CLI | последняя версия |
| `git` | 2.x+ |
| `systemd` | 249+ |
| Доступ | `OPENAI_API_KEY` для Codex |

---

## Структура файлов

```
pipeline-template/
├── pipeline/
│   ├── common.sh           # Общие функции и конфигурация
│   ├── coder-daemon.sh     # Агент-программист
│   ├── reviewer-daemon.sh  # Агент-ревьюер
│   ├── tester-daemon.sh    # Агент-тестировщик
│   └── install.sh          # Установщик
├── systemd/
│   ├── bravo-coder.service
│   ├── bravo-reviewer.service
│   └── bravo-tester.service
├── .github/
│   └── ISSUE_TEMPLATE/
│       └── task.md         # Шаблон задачи
├── src/                    # Код проекта (заполняется агентами)
├── tests/                  # Тесты (заполняются агентами)
├── CODE.md                 # Архитектурная документация для агентов
└── README.md               # Этот файл
```

---

## Лицензия

MIT — используй и адаптируй свободно.
