#!/usr/bin/env bash
# tester-daemon.sh — Агент-тестировщик (Tester)
# Берёт задачи из колонки "Testing", запускает runtime-проверки,
# выносит вердикт PASS/FAIL.
# При PASS — создаёт PR и перемещает в Done.
# Запускается через systemd (bravo-tester.service).
#
# ОТВЕТСТВЕННОСТЬ: Runtime-тесты (docker, curl, pytest, npm test)
# Статический code review — задача Reviewer.

set -euo pipefail

DAEMON_NAME="tester"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Загружаем общие функции
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

# ---------------------------------------------------------------------------
# Константы
# ---------------------------------------------------------------------------

SLEEP_INTERVAL="${SLEEP_INTERVAL:-300}"   # 5 минут между итерациями
CODEX_TIMEOUT=900                          # 15 минут максимум на тестирование

# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------

# create_pull_request <branch_name> <issue_number>
create_pull_request() {
    local branch_name="$1"
    local issue_number="$2"

    local issue_title
    issue_title=$(gh api "repos/${PIPELINE_REPO}/issues/${issue_number}" --jq '.title')

    local pr_body
    pr_body=$(cat <<BODY
## Описание

Автоматически созданный Pull Request по результатам прохождения конвейера.

**Реализует:** #${issue_number} — ${issue_title}

## Чеклист конвейера

- [x] Coder: реализация завершена
- [x] Reviewer: код прошёл ревью
- [x] Tester: тесты пройдены

Closes #${issue_number}
BODY
)

    local pr_url
    pr_url=$(gh pr create \
        --repo "${PIPELINE_REPO}" \
        --base main \
        --head "${branch_name}" \
        --title "feat: ${issue_title} (#${issue_number})" \
        --body "${pr_body}" \
        2>&1) || {
        log "WARN: PR уже существует или ошибка создания: ${pr_url}"
        pr_url=$(gh pr list --repo "${PIPELINE_REPO}" --head "${branch_name}" --json url --jq '.[0].url' 2>/dev/null || echo "не определён")
    }

    echo "${pr_url}"
}

# ---------------------------------------------------------------------------
# Основная логика итерации
# ---------------------------------------------------------------------------

process_testing() {
    local item_id="$1"
    local issue_number="$2"

    log "=== Начало тестирования issue #${issue_number} (item: ${item_id}) ==="

    # 1. Назначить issue на себя
    assign_issue "${issue_number}"

    # 2. Получить спецификацию
    local issue_spec
    issue_spec=$(get_issue_body "${issue_number}")
    log "Спецификация получена (${#issue_spec} символов)"

    # 3. Переключиться на feature-ветку
    local branch_name="feature/issue-${issue_number}"
    cd "${REPO_DIR:-$(git rev-parse --show-toplevel)}"

    git fetch origin --quiet

    if ! git ls-remote --exit-code --heads origin "${branch_name}" > /dev/null 2>&1; then
        log "ERROR: Ветка ${branch_name} не найдена"
        comment_on_issue "${issue_number}" "❌ **Tester**: ветка \`${branch_name}\` не найдена."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    fi

    git checkout "${branch_name}" --quiet
    git pull origin "${branch_name}" --quiet

    # 4. Получить список изменённых файлов (multi-strategy)
    local changed_files=""

    changed_files=$(git diff --name-only "origin/main...HEAD" 2>/dev/null || true)

    if [[ -z "${changed_files}" ]]; then
        log "WARN: diff origin/main...HEAD пуст. Пробуем HEAD~1."
        changed_files=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || true)
    fi

    if [[ -z "${changed_files}" ]]; then
        log "WARN: Ищем коммит issue #${issue_number} в main."
        local impl_commit
        impl_commit=$(git log origin/main --oneline --grep="implement issue #${issue_number}" -1 --format="%H" 2>/dev/null || true)
        if [[ -n "${impl_commit}" ]]; then
            changed_files=$(git diff --name-only "${impl_commit}~1" "${impl_commit}" 2>/dev/null || true)
            if [[ -n "${changed_files}" ]]; then
                git checkout "${impl_commit}" --quiet 2>/dev/null || true
            fi
        fi
    fi

    local files_content=""
    while IFS= read -r file; do
        if [[ -f "${file}" ]]; then
            files_content+=$'\n\n'"=== Файл: ${file} ==="$'\n'
            files_content+=$(cat "${file}")
        fi
    done <<< "${changed_files}"

    # 5. Запустить реальные тесты
    local test_results="Результаты runtime-тестов:"
    local any_test_ran=false

    # 5a. Docker Compose (если есть docker-compose.yml)
    if [[ -f "docker-compose.yml" ]] || [[ -f "docker-compose.yaml" ]]; then
        if command -v docker &>/dev/null; then
            log "Найден docker-compose.yml, пробуем docker compose build..."
            local docker_build_result
            docker_build_result=$(docker compose build 2>&1) && {
                test_results+="\n\n### Docker Build: SUCCESS"
                any_test_ran=true

                log "Docker build OK. Пробуем docker compose up..."
                docker compose up -d 2>&1
                sleep 10

                # Проверяем health endpoint
                if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
                    local health_response
                    health_response=$(curl -s http://localhost:8000/health)
                    test_results+="\n### GET /health: SUCCESS — ${health_response}"
                else
                    test_results+="\n### GET /health: FAILED (сервис не ответил)"
                fi

                # Проверяем PostgreSQL
                if docker compose exec -T db pg_isready 2>/dev/null; then
                    test_results+="\n### PostgreSQL: READY"
                else
                    test_results+="\n### PostgreSQL: NOT READY или не настроен"
                fi

                # Cleanup
                docker compose down 2>/dev/null || true
            } || {
                test_results+="\n\n### Docker Build: FAILED\n${docker_build_result}"
                any_test_ran=true
            }
        else
            test_results+="\n\n### Docker: не установлен на VPS"
        fi
    fi

    # 5b. pytest
    if find . -name "test_*.py" -maxdepth 3 2>/dev/null | grep -q .; then
        log "Найдены pytest-тесты, запускаем..."
        local pytest_result
        pytest_result=$(python3 -m pytest --tb=short 2>&1) || true
        test_results+="\n\n### pytest:\n${pytest_result}"
        any_test_ran=true
    fi

    # 5c. npm test
    if [[ -f "package.json" ]] && grep -q '"test"' package.json 2>/dev/null; then
        log "Найдены npm-тесты, запускаем..."
        local npm_result
        npm_result=$(npm test 2>&1) || true
        test_results+="\n\n### npm test:\n${npm_result}"
        any_test_ran=true
    fi

    # 5d. Python syntax check для всех .py файлов
    if echo "${changed_files}" | grep -q '\.py$'; then
        log "Проверяем синтаксис Python-файлов..."
        local syntax_ok=true
        while IFS= read -r pyfile; do
            if [[ -f "${pyfile}" ]]; then
                if ! python3 -m py_compile "${pyfile}" 2>/dev/null; then
                    test_results+="\n### Syntax ERROR: ${pyfile}"
                    syntax_ok=false
                fi
            fi
        done <<< "$(echo "${changed_files}" | grep '\.py$')"
        if [[ "${syntax_ok}" == true ]]; then
            test_results+="\n\n### Python syntax: OK (все файлы валидны)"
        fi
        any_test_ran=true
    fi

    if [[ "${any_test_ran}" == false ]]; then
        test_results+="\n\nАвтоматические тесты не обнаружены."
    fi

    log "Runtime-тесты завершены"

    # 6. Запустить Codex для финальной оценки
    local codex_prompt
    codex_prompt=$(cat <<PROMPT
Ты — опытный QA-тестировщик. Оцени результаты тестирования.

## Спецификация задачи (Issue #${issue_number})

${issue_spec}

## Реализованный код

${files_content}

## Результаты runtime-тестов

${test_results}

## Задача

На основе кода и результатов тестов определи:
1. **Критерии готовности** из issue — выполнены ли по коду и тестам?
2. **Gate** — все файлы существуют, код соответствует спецификации?
3. **Runtime** — тесты прошли или есть ошибки?

## ВАЖНЫЕ ПРАВИЛА

- Если docker/runtime тесты не запускались (нет docker-compose.yml для этой задачи) — это НЕ причина для FAIL
- Если синтаксис Python OK и код соответствует спецификации — это PASS
- FAIL только если: код не соответствует спецификации, критические баги, тесты упали

## Формат ответа

Краткий отчёт и в ПОСЛЕДНЕЙ строке ТОЛЬКО:
VERDICT: PASS
VERDICT: FAIL
PROMPT
)

    log "Запускаем Codex для оценки issue #${issue_number}..."

    local test_output=""
    local codex_exit=0

    test_output=$(timeout "${CODEX_TIMEOUT}" codex exec --full-auto --skip-git-repo-check "${codex_prompt}" 2>&1) || codex_exit=$?

    if [[ ${codex_exit} -eq 124 ]]; then
        log "ERROR: Codex превысил таймаут для issue #${issue_number}"
        comment_on_issue "${issue_number}" "❌ **Tester**: превышен таймаут (15 мин). Задача возвращена в In Progress."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    elif [[ ${codex_exit} -ne 0 ]]; then
        log "ERROR: Codex завершился с кодом ${codex_exit}"
        comment_on_issue "${issue_number}" "❌ **Tester**: ошибка (exit ${codex_exit}). Задача возвращена в In Progress."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    fi

    log "Codex завершил оценку. Анализируем вердикт..."

    # 7. Парсим вердикт
    local verdict=""
    verdict=$(echo "${test_output}" | grep -o 'VERDICT: \(PASS\|FAIL\)' | tail -n 1 | awk '{print $2}')

    if [[ -z "${verdict}" ]]; then
        log "WARN: Вердикт не найден. Считаем FAIL."
        verdict="FAIL"
    fi

    log "Вердикт тестирования для issue #${issue_number}: ${verdict}"

    # 8. Действие по вердикту
    if [[ "${verdict}" == "PASS" ]]; then
        move_issue_to_status "${item_id}" "Done"
        log "Issue #${issue_number} → Done"

        local pr_url
        pr_url=$(create_pull_request "${branch_name}" "${issue_number}")
        log "Pull Request создан: ${pr_url}"

        comment_on_issue "${issue_number}" "✅ **Tester**: тестирование пройдено!

**Runtime-тесты:**
$(echo -e "${test_results}")

**Оценка Codex:**
${test_output}

**Pull Request:** ${pr_url}

Задача перемещена в **Done**."

        log "=== Issue #${issue_number} → Done ==="

    else
        move_issue_to_status "${item_id}" "In Progress"
        log "Issue #${issue_number} → In Progress (тесты не пройдены)"

        comment_on_issue "${issue_number}" "🔄 **Tester**: тестирование не пройдено.

**Runtime-тесты:**
$(echo -e "${test_results}")

**Оценка Codex:**
${test_output}

Задача возвращена в **In Progress**."

        log "=== Issue #${issue_number} не прошёл тестирование ==="
    fi

    unassign_issue "${issue_number}"
}

# ---------------------------------------------------------------------------
# Главный цикл
# ---------------------------------------------------------------------------

main() {
    check_dependencies
    log "============================================"
    log "Tester Daemon запущен. Репозиторий: ${PIPELINE_REPO}"
    log "Интервал опроса: ${SLEEP_INTERVAL}s"
    log "Режим: Runtime-тесты (docker, pytest, syntax)"
    log "============================================"

    while true; do
        log "--- Новая итерация ---"

        local task_line=""
        task_line=$(get_first_item_by_status "Testing" 2>/dev/null || true)

        if [[ -z "${task_line}" ]]; then
            log "Нет задач в 'Testing'. Ожидание ${SLEEP_INTERVAL}s..."
        else
            local item_id issue_number
            item_id=$(echo "${task_line}" | awk '{print $1}')
            issue_number=$(echo "${task_line}" | awk '{print $2}')

            log "Найдена задача для тестирования: issue #${issue_number} (item: ${item_id})"

            if ! process_testing "${item_id}" "${issue_number}"; then
                log "ERROR: Тестирование issue #${issue_number} завершилось с ошибкой."
            fi
        fi

        log "Ожидание ${SLEEP_INTERVAL}s до следующей итерации..."
        sleep "${SLEEP_INTERVAL}"
    done
}

main "$@"
