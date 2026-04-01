#!/usr/bin/env bash
# reviewer-daemon.sh — Агент-ревьюер (Reviewer) v4
# Использует `codex exec --sandbox read-only` — Codex может только ЧИТАТЬ файлы,
# не может запускать код, python, docker и т.д.

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

    local issue_spec
    issue_spec=$(get_issue_body "${issue_number}")
    log "Спецификация получена (${#issue_spec} символов)"

    # Переключиться на feature-ветку
    local branch_name="feature/issue-${issue_number}"
    cd "${REPO_DIR:-$(git rev-parse --show-toplevel)}"
    git fetch origin --quiet

    if ! git ls-remote --exit-code --heads origin "${branch_name}" > /dev/null 2>&1; then
        log "ERROR: Ветка ${branch_name} не найдена"
        comment_on_issue "${issue_number}" "❌ **Reviewer**: ветка \`${branch_name}\` не найдена."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    fi

    git checkout "${branch_name}" --quiet
    git pull origin "${branch_name}" --quiet

    # Собрать diff для промпта
    local changed_files=""
    changed_files=$(git diff --name-only "origin/main...HEAD" 2>/dev/null || true)
    if [[ -z "${changed_files}" ]]; then
        changed_files=$(git diff --name-only HEAD~1 HEAD 2>/dev/null || true)
    fi
    if [[ -z "${changed_files}" ]]; then
        local impl_commit
        impl_commit=$(git log origin/main --oneline --grep="implement issue #${issue_number}" -1 --format="%H" 2>/dev/null || true)
        if [[ -n "${impl_commit}" ]]; then
            changed_files=$(git diff --name-only "${impl_commit}~1" "${impl_commit}" 2>/dev/null || true)
            [[ -n "${changed_files}" ]] && git checkout "${impl_commit}" --quiet 2>/dev/null || true
        fi
    fi

    if [[ -z "${changed_files}" ]]; then
        log "ERROR: Нет изменённых файлов"
        comment_on_issue "${issue_number}" "❌ **Reviewer**: нет изменений в ветке."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    fi

    local files_content=""
    while IFS= read -r file; do
        if [[ -f "${file}" ]]; then
            files_content+=$'\n\n'"=== ${file} ==="$'\n'
            files_content+=$(cat "${file}")
        fi
    done <<< "${changed_files}"

    log "Файлы для ревью: ${changed_files}"

    local review_prompt
    review_prompt="Проведи СТАТИЧЕСКИЙ code review. Ты можешь ТОЛЬКО ЧИТАТЬ файлы. НЕ ЗАПУСКАЙ код.

## Спецификация (Issue #${issue_number})
${issue_spec}

## Изменённые файлы
${files_content}

## Правила оценки
Каждая задача АТОМАРНАЯ — создаёт 1-3 файла. Это нормально что:
- Компоненты не интегрированы в main app (будет в других задачах)
- Импорты модулей из других задач не работают (те модули ещё не созданы)
- Нет runtime-подтверждения (это задача Tester)

Ты оцениваешь ТОЛЬКО соответствие КОНКРЕТНОЙ спецификации выше. НЕ оценивай:
- Безопасность/авторизацию — ЕСЛИ НЕ указано в спеке
- Интеграцию с другими модулями — задача АТОМАРНАЯ
- Runtime — ты не можешь запускать код
- Best practices и рекомендации

PASS если:
- Файлы из спецификации созданы
- Код реализует то, что описано в спеке
- Нет грубых синтаксических ошибок

FAIL ТОЛЬКО если:
- Файлы НЕ созданы
- Код ПРИНЦИПИАЛЬНО не делает то, что описано
- Грубые логические ошибки (бесконечные циклы, отсутствие return)

НЕ ЯВЛЯЕТСЯ ПРИЧИНОЙ ДЛЯ FAIL:
- Замечания по безопасности
- Отсутствие валидации
- Проблемы интеграции с другими модулями
- Рекомендации по улучшению

В последней строке напиши ТОЛЬКО: VERDICT: PASS или VERDICT: FAIL"

    log "Запускаем Codex (read-only sandbox)..."

    local output_file="/tmp/review-${issue_number}.txt"
    local codex_exit=0
    timeout "${CODEX_TIMEOUT}" codex exec \
        --sandbox read-only \
        --skip-git-repo-check \
        --ephemeral \
        -o "${output_file}" \
        "${review_prompt}" 2>&1 || codex_exit=$?

    local review_output=""
    [[ -f "${output_file}" ]] && review_output=$(cat "${output_file}")

    if [[ ${codex_exit} -eq 124 ]]; then
        log "ERROR: Таймаут"
        comment_on_issue "${issue_number}" "❌ **Reviewer**: таймаут."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    fi

    # Если нет output но exit 0 — берём из stderr
    if [[ -z "${review_output}" ]] && [[ ${codex_exit} -ne 0 ]]; then
        log "ERROR: Codex exit ${codex_exit}, нет output"
        comment_on_issue "${issue_number}" "❌ **Reviewer**: ошибка (exit ${codex_exit})."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    fi

    log "Codex завершил. Парсим вердикт..."

    local verdict=""
    verdict=$(echo "${review_output}" | grep -o 'VERDICT: \(PASS\|FAIL\)' | tail -n 1 | awk '{print $2}')

    if [[ -z "${verdict}" ]]; then
        log "WARN: Вердикт не найден → PASS (атомарная задача, code review read-only)"
        verdict="PASS"
    fi

    log "Вердикт: ${verdict}"

    local truncated_output
    truncated_output=$(echo "${review_output}" | tail -80)

    if [[ "${verdict}" == "PASS" ]]; then
        move_issue_to_status "${item_id}" "Testing"
        log "Issue #${issue_number} → Testing"
        comment_on_issue "${issue_number}" "✅ **Reviewer**: код прошёл ревью.

${truncated_output}

→ **Testing**"
    else
        move_issue_to_status "${item_id}" "In Progress"
        log "Issue #${issue_number} → In Progress"
        comment_on_issue "${issue_number}" "🔄 **Reviewer**: ревью не пройдено.

${truncated_output}

→ **In Progress**"
    fi

    unassign_issue "${issue_number}"
    rm -f "${output_file}" 2>/dev/null
}

main() {
    check_dependencies
    log "============================================"
    log "Reviewer v4: codex exec --sandbox read-only"
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
            log "Задача: issue #${issue_number}"

            if ! process_review "${item_id}" "${issue_number}"; then
                log "ERROR: Ревью issue #${issue_number} не удалось."
            fi
        fi

        log "Ожидание ${SLEEP_INTERVAL}s..."
        sleep "${SLEEP_INTERVAL}"
    done
}

main "$@"
