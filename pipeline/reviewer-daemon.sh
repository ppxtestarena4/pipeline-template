#!/usr/bin/env bash
# reviewer-daemon.sh — Агент-ревьюер (Reviewer)
# Использует `codex exec review --base main` — встроенный code review без sandbox.
# Codex сам находит diff, анализирует код, выносит вердикт.

set -euo pipefail

DAEMON_NAME="reviewer"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

SLEEP_INTERVAL="${SLEEP_INTERVAL:-300}"
CODEX_TIMEOUT=900

process_review() {
    local item_id="$1"
    local issue_number="$2"

    log "=== Начало ревью issue #${issue_number} (item: ${item_id}) ==="

    assign_issue "${issue_number}"

    # Получить спецификацию
    local issue_spec
    issue_spec=$(get_issue_body "${issue_number}")
    log "Спецификация получена (${#issue_spec} символов)"

    # Переключиться на feature-ветку
    local branch_name="feature/issue-${issue_number}"
    cd "${REPO_DIR:-$(git rev-parse --show-toplevel)}"
    git fetch origin --quiet

    if ! git ls-remote --exit-code --heads origin "${branch_name}" > /dev/null 2>&1; then
        log "ERROR: Ветка ${branch_name} не найдена в origin"
        comment_on_issue "${issue_number}" "❌ **Reviewer**: ветка \`${branch_name}\` не найдена."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    fi

    git checkout "${branch_name}" --quiet
    git pull origin "${branch_name}" --quiet

    # Используем встроенный codex exec review
    local review_prompt
    review_prompt="Проведи СТАТИЧЕСКИЙ code review для Issue #${issue_number}.

## Спецификация:
${issue_spec}

## Правила:
- Оценивай ТОЛЬКО код в этой ветке
- Каждая задача АТОМАРНАЯ (1-2 файла) — компоненты могут быть не интегрированы в приложение, это нормально и НЕ является FAIL
- НЕ проверяй работоспособность импортов других модулей — они будут в следующих задачах
- НЕ запускай код, НЕ проверяй runtime
- PASS если: файлы созданы, код соответствует спецификации, нет критических багов
- FAIL только если: файлы отсутствуют, ключевой функционал не реализован, грубые ошибки в логике

В ПОСЛЕДНЕЙ строке напиши ТОЛЬКО: VERDICT: PASS или VERDICT: FAIL"

    log "Запускаем codex exec review --base main для issue #${issue_number}..."

    local review_output=""
    local codex_exit=0

    # Записываем вывод в файл чтобы избежать проблем с escaping
    local output_file="/tmp/review-output-${issue_number}.txt"
    timeout "${CODEX_TIMEOUT}" codex exec review \
        --base main \
        --skip-git-repo-check \
        --ephemeral \
        -o "${output_file}" \
        "${review_prompt}" 2>&1 || codex_exit=$?

    if [[ -f "${output_file}" ]]; then
        review_output=$(cat "${output_file}")
    fi

    if [[ ${codex_exit} -eq 124 ]]; then
        log "ERROR: Codex превысил таймаут для issue #${issue_number}"
        comment_on_issue "${issue_number}" "❌ **Reviewer**: таймаут (15 мин). Возвращена в In Progress."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    elif [[ ${codex_exit} -ne 0 ]]; then
        log "ERROR: Codex завершился с кодом ${codex_exit}"
        # Если output есть — возможно ревью прошло, но exit code ненулевой
        if [[ -z "${review_output}" ]]; then
            comment_on_issue "${issue_number}" "❌ **Reviewer**: ошибка (exit ${codex_exit}). Возвращена в In Progress."
            move_issue_to_status "${item_id}" "In Progress"
            unassign_issue "${issue_number}"
            return 1
        fi
        log "WARN: exit ${codex_exit}, но output есть — продолжаем парсить."
    fi

    log "Codex завершил ревью. Анализируем вердикт..."

    # Парсим вердикт — берём ПОСЛЕДНЕЕ вхождение
    local verdict=""
    verdict=$(echo "${review_output}" | grep -o 'VERDICT: \(PASS\|FAIL\)' | tail -n 1 | awk '{print $2}')

    # Если вердикт не найден — ищем в файле вывода
    if [[ -z "${verdict}" ]] && [[ -f "${output_file}" ]]; then
        verdict=$(cat "${output_file}" | grep -o 'VERDICT: \(PASS\|FAIL\)' | tail -n 1 | awk '{print $2}')
    fi

    if [[ -z "${verdict}" ]]; then
        log "WARN: Вердикт не найден. По умолчанию PASS (атомарная задача)."
        verdict="PASS"
    fi

    log "Вердикт ревью для issue #${issue_number}: ${verdict}"

    # Обрезаем review_output для комментария (max 60K символов GitHub limit)
    local truncated_output
    truncated_output=$(echo "${review_output}" | tail -100)

    if [[ "${verdict}" == "PASS" ]]; then
        move_issue_to_status "${item_id}" "Testing"
        log "Issue #${issue_number} → Testing"

        comment_on_issue "${issue_number}" "✅ **Reviewer**: код прошёл ревью (статический анализ).

${truncated_output}

Задача перемещена в **Testing**."

        log "=== Issue #${issue_number} прошёл ревью ==="
    else
        move_issue_to_status "${item_id}" "In Progress"
        log "Issue #${issue_number} → In Progress (ревью не пройдено)"

        comment_on_issue "${issue_number}" "🔄 **Reviewer**: код не прошёл ревью.

${truncated_output}

Задача возвращена в **In Progress**."

        log "=== Issue #${issue_number} не прошёл ревью ==="
    fi

    unassign_issue "${issue_number}"
    rm -f "${output_file}" 2>/dev/null
}

main() {
    check_dependencies
    log "============================================"
    log "Reviewer Daemon v3. Режим: codex exec review --base main"
    log "Интервал: ${SLEEP_INTERVAL}s"
    log "============================================"

    while true; do
        log "--- Новая итерация ---"

        local task_line=""
        task_line=$(get_first_item_by_status "Review" 2>/dev/null || true)

        if [[ -z "${task_line}" ]]; then
            log "Нет задач в 'Review'. Ожидание ${SLEEP_INTERVAL}s..."
        else
            local item_id issue_number
            item_id=$(echo "${task_line}" | awk '{print $1}')
            issue_number=$(echo "${task_line}" | awk '{print $2}')

            log "Задача для ревью: issue #${issue_number}"

            if ! process_review "${item_id}" "${issue_number}"; then
                log "ERROR: Ревью issue #${issue_number} завершилось с ошибкой."
            fi
        fi

        log "Ожидание ${SLEEP_INTERVAL}s..."
        sleep "${SLEEP_INTERVAL}"
    done
}

main "$@"
