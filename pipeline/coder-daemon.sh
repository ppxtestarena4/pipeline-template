#!/usr/bin/env bash
# coder-daemon.sh — Агент-программист (Coder)
# Берёт задачи из колонки "To Do", реализует код, пушит в Review.
# Запускается через systemd (bravo-coder.service).
#
# ЗАЩИТНЫЕ МЕХАНИЗМЫ:
# 1. Токен-контроль: отслеживает бюджет задач за 5-часовое окно
# 2. Branch safety: гарантирует работу на feature-ветке
# 3. Git prohibition: Claude Code не может выполнять git-команды

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
CODER_TIMEOUT=1800                        # 30 минут максимум на Claude Code

# ---------------------------------------------------------------------------
# Токен-контроль
# ---------------------------------------------------------------------------

TOKEN_STATE_FILE="/var/log/bravo/coder-token-state"

# Лимиты задач за 5-часовое окно (~44K токенов, ~10-15K на задачу)
TASKS_LIMIT_OFFPEAK=3
TASKS_LIMIT_PEAK=2
TOKEN_WINDOW_HOURS=5

# Peak часы: 16-22 MSK = 13-19 UTC
PEAK_START_UTC=13
PEAK_END_UTC=19

is_peak_hour() {
    local current_hour
    current_hour=$(date -u +%H | sed 's/^0//')
    [[ ${current_hour} -ge ${PEAK_START_UTC} && ${current_hour} -lt ${PEAK_END_UTC} ]]
}

get_tasks_limit() {
    if is_peak_hour; then echo "${TASKS_LIMIT_PEAK}"; else echo "${TASKS_LIMIT_OFFPEAK}"; fi
}

init_token_state() {
    if [[ ! -f "${TOKEN_STATE_FILE}" ]]; then
        echo "0 $(date +%s)" > "${TOKEN_STATE_FILE}"
        log "Инициализирован файл токен-состояния"
    fi
}

read_token_state() {
    init_token_state
    cat "${TOKEN_STATE_FILE}"
}

write_token_state() {
    echo "$1 $2" > "${TOKEN_STATE_FILE}"
}

check_token_budget() {
    local state tasks_done window_start now elapsed window_seconds limit remaining window_remaining_min
    state=$(read_token_state)
    tasks_done=$(echo "${state}" | awk '{print $1}')
    window_start=$(echo "${state}" | awk '{print $2}')
    now=$(date +%s)
    window_seconds=$((TOKEN_WINDOW_HOURS * 3600))
    elapsed=$((now - window_start))

    if [[ ${elapsed} -ge ${window_seconds} ]]; then
        log "Токен-окно истекло (${elapsed}s >= ${window_seconds}s). Сброс счётчика."
        write_token_state 0 "${now}"
        tasks_done=0
    fi

    limit=$(get_tasks_limit)
    remaining=$((limit - tasks_done))
    window_remaining_min=$(( (window_seconds - elapsed) / 60 ))

    if [[ ${tasks_done} -ge ${limit} ]]; then
        log "⛔ ТОКЕН-ЛИМИТ: выполнено ${tasks_done}/${limit} задач за текущее окно."
        log "   Окно сбросится через ${window_remaining_min} мин."
        is_peak_hour && log "   Сейчас peak-часы (${PEAK_START_UTC}-${PEAK_END_UTC} UTC), лимит снижен."
        return 1
    fi

    log "Токен-бюджет: ${tasks_done}/${limit} задач использовано. Осталось: ${remaining}. Окно: ещё ${window_remaining_min} мин."
    return 0
}

record_task_completed() {
    local state tasks_done window_start
    state=$(read_token_state)
    tasks_done=$(echo "${state}" | awk '{print $1}')
    window_start=$(echo "${state}" | awk '{print $2}')
    tasks_done=$((tasks_done + 1))
    write_token_state "${tasks_done}" "${window_start}"
    log "Записано: ${tasks_done} задач выполнено в текущем окне."
}

record_task_failed() {
    local exit_code="$1"
    if [[ ${exit_code} -eq 1 ]]; then
        log "⚠️ Claude Code exit 1 — возможно rate limit. Помечаем окно как исчерпанное."
        local limit window_start
        limit=$(get_tasks_limit)
        window_start=$(echo "$(read_token_state)" | awk '{print $2}')
        write_token_state "${limit}" "${window_start}"
    else
        record_task_completed
    fi
}

calculate_sleep_until_window_reset() {
    local state window_start now window_seconds reset_at wait_seconds
    state=$(read_token_state)
    window_start=$(echo "${state}" | awk '{print $2}')
    now=$(date +%s)
    window_seconds=$((TOKEN_WINDOW_HOURS * 3600))
    reset_at=$((window_start + window_seconds))
    wait_seconds=$((reset_at - now))
    [[ ${wait_seconds} -lt 0 ]] && wait_seconds=0
    echo "${wait_seconds}"
}

# ---------------------------------------------------------------------------
# Основная логика итерации
# ---------------------------------------------------------------------------

process_task() {
    local item_id="$1"
    local issue_number="$2"

    log "=== Начало обработки issue #${issue_number} (item: ${item_id}) ==="

    # 0. Очистка рабочей директории — предотвращает утечку между задачами
    cd "${REPO_DIR:-$(git rev-parse --show-toplevel)}"
    git checkout main --quiet 2>/dev/null || true
    git reset --hard origin/main --quiet 2>/dev/null || true
    git clean -fdx --quiet 2>/dev/null || true
    log "Рабочая директория очищена"

    # 1. Назначить issue на себя
    assign_issue "${issue_number}"

    # 2. Переместить в "In Progress"
    move_issue_to_status "${item_id}" "In Progress"
    log "Issue #${issue_number} → In Progress"

    # 3. Получить спецификацию
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

    # 5. Запустить Claude Code
    local coder_prompt
    coder_prompt=$(cat <<PROMPT
Ты — опытный разработчик. Прочитай файл CODE.md в этом репозитории для понимания проекта.

Затем реализуй следующую задачу из GitHub Issue #${issue_number}:

${issue_spec}

Инструкции:
- Создай или измени все файлы, указанные в спецификации
- Следуй архитектуре, описанной в CODE.md
- Пиши чистый, хорошо документированный код
- Убедись, что все критерии готовности из issue выполнены
- Не создавай лишних файлов, не предусмотренных спецификацией
- НЕ выполняй git-команды (git add, commit, push, checkout) — этим управляет скрипт-обёртка
PROMPT
)

    log "Запускаем Claude Code для issue #${issue_number}..."

    local coder_exit=0
    timeout "${CODER_TIMEOUT}" claude -p "${coder_prompt}" --output-format text --allowedTools Edit,Write || coder_exit=$?

    # ЗАЩИТА: принудительно вернуться на feature-ветку после Claude Code
    local current_branch
    current_branch=$(git branch --show-current 2>/dev/null || echo "unknown")
    if [[ "${current_branch}" != "${branch_name}" ]]; then
        log "WARN: Claude Code переключил ветку на '${current_branch}'. Возвращаемся на '${branch_name}'."
        git stash --include-untracked 2>/dev/null || true
        git checkout "${branch_name}" --quiet 2>/dev/null || git checkout -b "${branch_name}" --quiet
        git stash pop 2>/dev/null || true
    fi

    # Обработка ошибок Claude Code
    if [[ ${coder_exit} -eq 124 ]]; then
        log "ERROR: Claude Code превысил таймаут (${CODER_TIMEOUT}s) для issue #${issue_number}"
        comment_on_issue "${issue_number}" "❌ **Coder**: превышен таймаут (30 мин). Задача остаётся в In Progress."
        unassign_issue "${issue_number}"
        record_task_failed "${coder_exit}"
        return 1
    elif [[ ${coder_exit} -ne 0 ]]; then
        log "ERROR: Claude Code завершился с кодом ${coder_exit} для issue #${issue_number}"
        comment_on_issue "${issue_number}" "❌ **Coder**: ошибка (exit ${coder_exit}). Задача остаётся в In Progress."
        unassign_issue "${issue_number}"
        record_task_failed "${coder_exit}"
        return 1
    fi

    # 6. Gate-проверка: должны быть изменения
    local git_status
    git_status=$(git status --porcelain)

    if [[ -z "${git_status}" ]]; then
        log "GATE FAILED: нет изменённых файлов для issue #${issue_number}"
        comment_on_issue "${issue_number}" "⚠️ **Coder**: gate не пройден — нет изменённых файлов. Задача остаётся в In Progress."
        unassign_issue "${issue_number}"
        record_task_completed  # токены потрачены
        return 1
    fi

    log "Gate пройден. Изменённые файлы:"
    log "${git_status}"

    # 7. Финальная проверка ветки + коммит + push
    current_branch=$(git branch --show-current 2>/dev/null || echo "unknown")
    if [[ "${current_branch}" != "${branch_name}" ]]; then
        log "ERROR: Перед коммитом на ветке '${current_branch}' вместо '${branch_name}'. Аварийный переход."
        git checkout "${branch_name}" --quiet 2>/dev/null || true
    fi

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

    # 8a. Снять назначение — чтобы Reviewer мог подхватить задачу
    unassign_issue "${issue_number}"

    # 9. Оставить комментарий
    local changed_files
    changed_files=$(git diff --name-only HEAD~1 HEAD | sed 's/^/- /')
    comment_on_issue "${issue_number}" "✅ **Coder**: реализация завершена. Ветка: \`${branch_name}\`

**Изменённые файлы:**
${changed_files}

Задача перемещена в **Review** для проверки."

    # 10. Записать успешное выполнение
    record_task_completed

    log "=== Issue #${issue_number} успешно обработан и передан в Review ==="
}

# ---------------------------------------------------------------------------
# Главный цикл
# ---------------------------------------------------------------------------

main() {
    check_dependencies
    init_token_state
    log "============================================"
    log "Coder Daemon запущен. Репозиторий: ${PIPELINE_REPO}"
    log "Интервал опроса: ${SLEEP_INTERVAL}s"
    log "Токен-лимит: ${TASKS_LIMIT_OFFPEAK} (off-peak) / ${TASKS_LIMIT_PEAK} (peak)"
    log "Peak часы: ${PEAK_START_UTC}-${PEAK_END_UTC} UTC"
    log "============================================"

    while true; do
        log "--- Новая итерация ---"

        # Токен-контроль
        if ! check_token_budget; then
            local wait_secs
            wait_secs=$(calculate_sleep_until_window_reset)
            if [[ ${wait_secs} -gt 0 ]]; then
                local wait_mins=$((wait_secs / 60))
                log "💤 Засыпаю на ${wait_mins} мин до сброса токен-окна..."
                sleep "${wait_secs}"
                log "Просыпаюсь — токен-окно должно было сброситься."
                continue
            fi
        fi

        # Найти задачу в "To Do"
        local task_line=""
        task_line=$(get_first_unassigned_item_by_status "To Do" 2>/dev/null || true)

        if [[ -z "${task_line}" ]]; then
            log "Нет задач в 'To Do'. Ожидание ${SLEEP_INTERVAL}s..."
        else
            local item_id issue_number
            item_id=$(echo "${task_line}" | awk '{print $1}')
            issue_number=$(echo "${task_line}" | awk '{print $2}')

            log "Найдена задача: issue #${issue_number} (item: ${item_id})"

            if ! process_task "${item_id}" "${issue_number}"; then
                log "ERROR: Обработка issue #${issue_number} завершилась с ошибкой. Продолжаем цикл."
            fi
        fi

        log "Ожидание ${SLEEP_INTERVAL}s до следующей итерации..."
        sleep "${SLEEP_INTERVAL}"
    done
}

main "$@"
