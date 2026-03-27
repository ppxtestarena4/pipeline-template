#!/usr/bin/env bash
# coder-daemon.sh — Агент-программист (Coder)
# Берёт задачи из колонки "To Do", реализует код, пушит в Review.
# Запускается через systemd (bravo-coder.service).

set -euo pipefail

DAEMON_NAME="coder"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Загружаем общие функции
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

# ---------------------------------------------------------------------------
# Константы
# ---------------------------------------------------------------------------

SLEEP_INTERVAL="${SLEEP_INTERVAL:-300}"   # 5 минут между итерациями
MAX_RETRIES=3                              # Максимум попыток кодирования на задачу
CODEX_TIMEOUT=1800                        # 30 минут максимум на codex exec

# ---------------------------------------------------------------------------
# Основная логика итерации
# ---------------------------------------------------------------------------

process_task() {
    local item_id="$1"
    local issue_number="$2"

    log "=== Начало обработки issue #${issue_number} (item: ${item_id}) ==="

    # 1. Назначить issue на себя (предотвращаем двойной захват)
    assign_issue "${issue_number}"

    # 2. Переместить в "In Progress"
    move_issue_to_status "${item_id}" "In Progress"
    log "Issue #${issue_number} → In Progress"

    # 3. Получить спецификацию из тела issue
    local issue_spec
    issue_spec=$(get_issue_body "${issue_number}")
    log "Спецификация получена (${#issue_spec} символов)"

    # 4. Создать/переключиться на feature-ветку
    local branch_name="feature/issue-${issue_number}"
    cd "${REPO_DIR:-$(git rev-parse --show-toplevel)}"

    git checkout main --quiet
    git pull origin main --quiet

    if git ls-remote --exit-code --heads origin "${branch_name}" > /dev/null 2>&1; then
        git checkout "${branch_name}" --quiet
        git pull origin "${branch_name}" --quiet
    else
        git checkout -b "${branch_name}" --quiet
    fi

    log "Ветка ${branch_name} готова"

    # 5. Запустить Codex для реализации
    local codex_prompt
    codex_prompt=$(cat <<PROMPT
Ты — опытный разработчик. Прочитай файл CODE.md в этом репозитории для понимания проекта.

Затем реализуй следующую задачу из GitHub Issue #${issue_number}:

${issue_spec}

Инструкции:
- Создай или измени все файлы, указанные в спецификации
- Следуй архитектуре, описанной в CODE.md
- Пиши чистый, хорошо документированный код
- Убедись, что все критерии готовности из issue выполнены
- Не создавай лишних файлов, не предусмотренных спецификацией
PROMPT
)

    log "Запускаем codex exec для issue #${issue_number}..."

    local codex_exit=0
    timeout "${CODEX_TIMEOUT}" codex exec --full-auto "${codex_prompt}" || codex_exit=$?

    if [[ ${codex_exit} -eq 124 ]]; then
        log "ERROR: codex exec превысил таймаут (${CODEX_TIMEOUT}s) для issue #${issue_number}"
        comment_on_issue "${issue_number}" "❌ **Coder**: превышен таймаут выполнения (30 мин). Задача остаётся в In Progress."
        unassign_issue "${issue_number}"
        return 1
    elif [[ ${codex_exit} -ne 0 ]]; then
        log "ERROR: codex exec завершился с кодом ${codex_exit} для issue #${issue_number}"
        comment_on_issue "${issue_number}" "❌ **Coder**: ошибка выполнения codex (exit ${codex_exit}). Задача остаётся в In Progress."
        unassign_issue "${issue_number}"
        return 1
    fi

    # 6. Gate-проверка: должны быть изменения в файлах
    local git_status
    git_status=$(git status --porcelain)

    if [[ -z "${git_status}" ]]; then
        log "GATE FAILED: нет изменённых файлов для issue #${issue_number}"
        comment_on_issue "${issue_number}" "⚠️ **Coder**: gate не пройден — codex не создал/изменил ни одного файла. Задача остаётся в In Progress для повторной попытки."
        unassign_issue "${issue_number}"
        return 1
    fi

    log "Gate пройден. Изменённые файлы:"
    log "${git_status}"

    # 7. Зафиксировать и запушить изменения
    git add -A

    local commit_msg
    commit_msg=$(cat <<MSG
feat: implement issue #${issue_number}

Implements specification from GitHub Issue #${issue_number}.
Auto-implemented by Coder agent (pipeline/coder-daemon.sh).

Refs: #${issue_number}
MSG
)

    git commit -m "${commit_msg}"
    git push origin "${branch_name}"
    log "Изменения запушены в ${branch_name}"

    # 8. Переместить в Review
    move_issue_to_status "${item_id}" "Review"
    log "Issue #${issue_number} → Review"

    # 9. Оставить комментарий
    local changed_files
    changed_files=$(git diff --name-only HEAD~1 HEAD | sed 's/^/- /')
    comment_on_issue "${issue_number}" "✅ **Coder**: реализация завершена. Ветка: \`${branch_name}\`

**Изменённые файлы:**
${changed_files}

Задача перемещена в **Review** для проверки."

    log "=== Issue #${issue_number} успешно обработан и передан в Review ==="
}

# ---------------------------------------------------------------------------
# Главный цикл
# ---------------------------------------------------------------------------

main() {
    check_dependencies
    log "============================================"
    log "Coder Daemon запущен. Репозиторий: ${PIPELINE_REPO}"
    log "Интервал опроса: ${SLEEP_INTERVAL}s"
    log "============================================"

    while true; do
        log "--- Новая итерация ---"

        # Найти первую незанятую задачу в "To Do"
        local task_line=""
        task_line=$(get_first_unassigned_item_by_status "To Do" 2>/dev/null || true)

        if [[ -z "${task_line}" ]]; then
            log "Нет задач в 'To Do'. Ожидание ${SLEEP_INTERVAL}s..."
        else
            local item_id issue_number
            item_id=$(echo "${task_line}" | awk '{print $1}')
            issue_number=$(echo "${task_line}" | awk '{print $2}')

            log "Найдена задача: issue #${issue_number} (item: ${item_id})"

            # Обработать задачу с защитой от ошибок
            if ! process_task "${item_id}" "${issue_number}"; then
                log "ERROR: Обработка issue #${issue_number} завершилась с ошибкой. Продолжаем цикл."
            fi
        fi

        log "Ожидание ${SLEEP_INTERVAL}s до следующей итерации..."
        sleep "${SLEEP_INTERVAL}"
    done
}

main "$@"
