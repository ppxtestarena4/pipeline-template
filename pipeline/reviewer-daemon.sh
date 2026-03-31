#!/usr/bin/env bash
# reviewer-daemon.sh — Агент-ревьюер (Reviewer)
# Берёт задачи из колонки "Review", проверяет код на соответствие спецификации,
# выносит вердикт PASS/FAIL и перемещает задачу в Testing или обратно в In Progress.
# Запускается через systemd (bravo-reviewer.service).

set -euo pipefail

DAEMON_NAME="reviewer"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Загружаем общие функции
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

# ---------------------------------------------------------------------------
# Константы
# ---------------------------------------------------------------------------

SLEEP_INTERVAL="${SLEEP_INTERVAL:-300}"   # 5 минут между итерациями
CODEX_TIMEOUT=900                          # 15 минут максимум на ревью

# ---------------------------------------------------------------------------
# Основная логика итерации
# ---------------------------------------------------------------------------

process_review() {
    local item_id="$1"
    local issue_number="$2"

    log "=== Начало ревью issue #${issue_number} (item: ${item_id}) ==="

    # 1. Назначить issue на себя
    assign_issue "${issue_number}"

    # 2. Получить спецификацию из тела issue
    local issue_spec
    issue_spec=$(get_issue_body "${issue_number}")
    log "Спецификация получена (${#issue_spec} символов)"

    # 3. Получить список изменённых файлов из feature-ветки vs main
    local branch_name="feature/issue-${issue_number}"
    cd "${REPO_DIR:-$(git rev-parse --show-toplevel)}"

    git fetch origin --quiet

    # Проверяем, что ветка существует
    if ! git ls-remote --exit-code --heads origin "${branch_name}" > /dev/null 2>&1; then
        log "ERROR: Ветка ${branch_name} не найдена в origin"
        comment_on_issue "${issue_number}" "❌ **Reviewer**: ветка \`${branch_name}\` не найдена. Невозможно выполнить ревью."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    fi

    git checkout "${branch_name}" --quiet
    git pull origin "${branch_name}" --quiet

    # Получить список и содержимое изменённых файлов
    local changed_files
    changed_files=$(git diff --name-only "origin/main...HEAD" 2>/dev/null || git diff --name-only HEAD~1 HEAD)

    if [[ -z "${changed_files}" ]]; then
        log "ERROR: Нет изменённых файлов в ветке ${branch_name}"
        comment_on_issue "${issue_number}" "❌ **Reviewer**: в ветке \`${branch_name}\` нет изменений относительно main. Возвращаем задачу в In Progress."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    fi

    log "Изменённые файлы для ревью: ${changed_files}"

    # Формируем содержимое изменённых файлов для контекста
    local files_content=""
    while IFS= read -r file; do
        if [[ -f "${file}" ]]; then
            files_content+=$'\n\n'"=== Файл: ${file} ===\n"
            files_content+=$(cat "${file}")
        fi
    done <<< "${changed_files}"

    # 4. Запустить Codex как QA-ревьюер
    local codex_prompt
    codex_prompt=$(cat <<PROMPT
Ты — опытный QA-инженер и технический ревьюер. Проведи code review.

## Спецификация задачи (Issue #${issue_number})

${issue_spec}

## Изменённые файлы

${files_content}

## Задача ревью

Проверь следующее:
1. **Соответствие спецификации** — весь ли функционал из спецификации реализован?
2. **Качество кода** — читаемость, структура, отсутствие дублирования
3. **Безопасность** — нет ли очевидных уязвимостей (инъекции, открытые секреты, небезопасные операции)
4. **Обработка ошибок** — корректно ли обрабатываются ошибки?
5. **Чеклист из issue** — выполнены ли все пункты "Критерии готовности"?

## Формат ответа

Дай структурированный отчёт и в ПОСЛЕДНЕЙ строке напиши ТОЛЬКО одно из двух:
VERDICT: PASS
VERDICT: FAIL

При FAIL обязательно укажи конкретные проблемы, которые нужно исправить.
PROMPT
)

    log "Запускаем codex exec для ревью issue #${issue_number}..."

    local review_output=""
    local codex_exit=0

    review_output=$(timeout "${CODEX_TIMEOUT}" codex exec --full-auto "${codex_prompt}" 2>&1) || codex_exit=$?

    if [[ ${codex_exit} -eq 124 ]]; then
        log "ERROR: codex exec превысил таймаут для ревью issue #${issue_number}"
        comment_on_issue "${issue_number}" "❌ **Reviewer**: превышен таймаут ревью (15 мин). Задача возвращена в In Progress."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    elif [[ ${codex_exit} -ne 0 ]]; then
        log "ERROR: codex exec завершился с кодом ${codex_exit}"
        comment_on_issue "${issue_number}" "❌ **Reviewer**: ошибка при выполнении ревью (exit ${codex_exit}). Задача возвращена в In Progress."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    fi

    log "Codex завершил ревью. Анализируем вердикт..."

    # 5. Парсим вердикт из последней строки
    local verdict=""
    verdict=$(echo "${review_output}" | grep -o 'VERDICT: \(PASS\|FAIL\)' | tail -n 1 | awk '{print $2}')

    if [[ -z "${verdict}" ]]; then
        log "WARN: Вердикт не найден в выводе codex. Считаем FAIL."
        verdict="FAIL"
    fi

    log "Вердикт ревью для issue #${issue_number}: ${verdict}"

    # 6. Действие по вердикту
    if [[ "${verdict}" == "PASS" ]]; then
        move_issue_to_status "${item_id}" "Testing"
        log "Issue #${issue_number} → Testing"

        comment_on_issue "${issue_number}" "✅ **Reviewer**: код прошёл ревью.

**Отчёт:**
${review_output}

Задача перемещена в **Testing**."

        log "=== Issue #${issue_number} прошёл ревью и передан в Testing ==="

    else
        move_issue_to_status "${item_id}" "In Progress"
        log "Issue #${issue_number} → In Progress (ревью не пройдено)"

        comment_on_issue "${issue_number}" "🔄 **Reviewer**: код не прошёл ревью. Требуются исправления.

**Отчёт ревью:**
${review_output}

Задача возвращена в **In Progress** для исправления."

        log "=== Issue #${issue_number} не прошёл ревью, возвращён в In Progress ==="
    fi

    unassign_issue "${issue_number}"
}

# ---------------------------------------------------------------------------
# Главный цикл
# ---------------------------------------------------------------------------

main() {
    check_dependencies
    log "============================================"
    log "Reviewer Daemon запущен. Репозиторий: ${PIPELINE_REPO}"
    log "Интервал опроса: ${SLEEP_INTERVAL}s"
    log "============================================"

    while true; do
        log "--- Новая итерация ---"

        # Найти первую незанятую задачу в "Review"
        local task_line=""
        task_line=$(get_project_items_by_status "Review" 2>/dev/null | head -1)
        task_line=$(echo "$task_line" 2>/dev/null || true)

        if [[ -z "${task_line}" ]]; then
            log "Нет задач в 'Review'. Ожидание ${SLEEP_INTERVAL}s..."
        else
            local item_id issue_number
            item_id=$(echo "${task_line}" | awk '{print $1}')
            issue_number=$(echo "${task_line}" | awk '{print $2}')

            log "Найдена задача для ревью: issue #${issue_number} (item: ${item_id})"

            if ! process_review "${item_id}" "${issue_number}"; then
                log "ERROR: Ревью issue #${issue_number} завершилось с ошибкой. Продолжаем цикл."
            fi
        fi

        log "Ожидание ${SLEEP_INTERVAL}s до следующей итерации..."
        sleep "${SLEEP_INTERVAL}"
    done
}

main "$@"
