#!/usr/bin/env bash
# coder-daemon.sh — Агент-программист (Coder)
# Берёт задачи из колонки "To Do", реализует код, пушит в Review.
# Запускается через systemd (bravo-coder.service).
#
# ТОКЕН-КОНТРОЛЬ:
# Claude Pro имеет лимит ~44K токенов за 5-часовое окно.
# Каждая атомарная задача расходует ~10-15K токенов.
# В peak-часы (16-22 MSK / 13-19 UTC) расход выше.
# Демон отслеживает количество выполненных задач за окно
# и останавливается при достижении лимита.

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
CODER_TIMEOUT=1800                        # 30 минут максимум на Claude Code

# ---------------------------------------------------------------------------
# Токен-контроль
# ---------------------------------------------------------------------------

# Файл для хранения состояния токен-бюджета
TOKEN_STATE_FILE="/var/log/bravo/coder-token-state"

# Лимиты задач за 5-часовое окно
# Каждая атомарная задача ≈ 10-15K токенов, лимит ≈ 44K
TASKS_LIMIT_OFFPEAK=3   # Off-peak: можно 3 задачи за окно (30-45K из 44K)
TASKS_LIMIT_PEAK=2      # Peak: можно 2 задачи (быстрее расход, меньше запас)
TOKEN_WINDOW_HOURS=5     # Длина окна лимита Claude Pro

# Peak часы: 16-22 MSK = 13-19 UTC (самое загруженное время, токены тратятся быстрее)
PEAK_START_UTC=13
PEAK_END_UTC=19

# is_peak_hour — проверяет, сейчас ли пиковое время
is_peak_hour() {
    local current_hour
    current_hour=$(date -u +%H | sed 's/^0//')
    if [[ ${current_hour} -ge ${PEAK_START_UTC} && ${current_hour} -lt ${PEAK_END_UTC} ]]; then
        return 0  # true — peak
    fi
    return 1  # false — off-peak
}

# get_tasks_limit — возвращает лимит задач для текущего времени
get_tasks_limit() {
    if is_peak_hour; then
        echo "${TASKS_LIMIT_PEAK}"
    else
        echo "${TASKS_LIMIT_OFFPEAK}"
    fi
}

# init_token_state — инициализирует файл состояния, если не существует
init_token_state() {
    if [[ ! -f "${TOKEN_STATE_FILE}" ]]; then
        echo "0 $(date +%s)" > "${TOKEN_STATE_FILE}"
        log "Инициализирован файл токен-состояния"
    fi
}

# read_token_state — читает текущее состояние: (tasks_done, window_start_epoch)
read_token_state() {
    init_token_state
    cat "${TOKEN_STATE_FILE}"
}

# write_token_state — записывает состояние
write_token_state() {
    local tasks_done="$1"
    local window_start="$2"
    echo "${tasks_done} ${window_start}" > "${TOKEN_STATE_FILE}"
}

# check_token_budget — проверяет, есть ли бюджет для новой задачи
# Возвращает 0 (true) — можно брать, 1 (false) — нельзя
check_token_budget() {
    local state
    state=$(read_token_state)
    local tasks_done window_start
    tasks_done=$(echo "${state}" | awk '{print $1}')
    window_start=$(echo "${state}" | awk '{print $2}')

    local now
    now=$(date +%s)
    local window_seconds=$((TOKEN_WINDOW_HOURS * 3600))
    local elapsed=$((now - window_start))

    # Если окно истекло — сбросить счётчик
    if [[ ${elapsed} -ge ${window_seconds} ]]; then
        log "Токен-окно истекло (${elapsed}s >= ${window_seconds}s). Сброс счётчика."
        write_token_state 0 "${now}"
        tasks_done=0
    fi

    local limit
    limit=$(get_tasks_limit)

    local remaining=$((limit - tasks_done))
    local window_remaining_min=$(( (window_seconds - elapsed) / 60 ))

    if [[ ${tasks_done} -ge ${limit} ]]; then
        log "⛔ ТОКЕН-ЛИМИТ: выполнено ${tasks_done}/${limit} задач за текущее окно."
        log "   Окно сбросится через ${window_remaining_min} мин."
        if is_peak_hour; then
            log "   Сейчас peak-часы (${PEAK_START_UTC}-${PEAK_END_UTC} UTC), лимит снижен."
        fi
        return 1  # нельзя брать
    fi

    log "Токен-бюджет: ${tasks_done}/${limit} задач использовано. Осталось: ${remaining}. Окно: ещё ${window_remaining_min} мин."
    return 0  # можно брать
}

# record_task_completed — увеличивает счётчик выполненных задач
record_task_completed() {
    local state
    state=$(read_token_state)
    local tasks_done window_start
    tasks_done=$(echo "${state}" | awk '{print $1}')
    window_start=$(echo "${state}" | awk '{print $2}')

    tasks_done=$((tasks_done + 1))
    write_token_state "${tasks_done}" "${window_start}"
    log "Записано: ${tasks_done} задач выполнено в текущем окне."
}

# record_task_failed — записывает неудачную задачу (тоже расходует токены!)
record_task_failed() {
    local exit_code="$1"
    # Если Claude Code стартовал и работал (exit != 124 timeout), он потратил токены
    # При exit 1 от rate limit — тем более израсходовал всё окно
    if [[ ${exit_code} -eq 1 ]]; then
        # Exit 1 часто означает rate limit — считаем что окно исчерпано
        log "⚠️ Claude Code exit 1 — возможно rate limit. Помечаем окно как исчерпанное."
        local now
        now=$(date +%s)
        local limit
        limit=$(get_tasks_limit)
        write_token_state "${limit}" "$(echo "$(read_token_state)" | awk '{print $2}')"
    else
        # Другие ошибки — тоже расход, но частичный
        record_task_completed
    fi
}

# calculate_sleep_until_window_reset — сколько секунд ждать до сброса окна
calculate_sleep_until_window_reset() {
    local state
    state=$(read_token_state)
    local window_start
    window_start=$(echo "${state}" | awk '{print $2}')
    local now
    now=$(date +%s)
    local window_seconds=$((TOKEN_WINDOW_HOURS * 3600))
    local reset_at=$((window_start + window_seconds))
    local wait_seconds=$((reset_at - now))

    if [[ ${wait_seconds} -lt 0 ]]; then
        wait_seconds=0
    fi

    echo "${wait_seconds}"
}

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

    # 5. Запустить Claude Code для реализации
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
PROMPT
)

    log "Запускаем Claude Code для issue #${issue_number}..."

    local coder_exit=0
    timeout "${CODER_TIMEOUT}" claude -p "${coder_prompt}" --output-format text --allowedTools Edit,Bash,Write || coder_exit=$?

    if [[ ${coder_exit} -eq 124 ]]; then
        log "ERROR: Claude Code превысил таймаут (${CODER_TIMEOUT}s) для issue #${issue_number}"
        comment_on_issue "${issue_number}" "❌ **Coder**: превышен таймаут выполнения (30 мин). Задача остаётся в In Progress."
        unassign_issue "${issue_number}"
        record_task_failed "${coder_exit}"
        return 1
    elif [[ ${coder_exit} -ne 0 ]]; then
        log "ERROR: Claude Code завершился с кодом ${coder_exit} для issue #${issue_number}"
        comment_on_issue "${issue_number}" "❌ **Coder**: ошибка выполнения (exit ${coder_exit}). Задача остаётся в In Progress."
        unassign_issue "${issue_number}"
        record_task_failed "${coder_exit}"
        return 1
    fi

    # 6. Gate-проверка: должны быть изменения в файлах
    local git_status
    git_status=$(git status --porcelain)

    if [[ -z "${git_status}" ]]; then
        log "GATE FAILED: нет изменённых файлов для issue #${issue_number}"
        comment_on_issue "${issue_number}" "⚠️ **Coder**: gate не пройден — не создано/изменено ни одного файла. Задача остаётся в In Progress."
        unassign_issue "${issue_number}"
        record_task_completed  # токены потрачены, даже если результата нет
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

    # 10. Записать успешное выполнение задачи
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
    log "Токен-лимит: ${TASKS_LIMIT_OFFPEAK} задач (off-peak) / ${TASKS_LIMIT_PEAK} (peak)"
    log "Peak часы: ${PEAK_START_UTC}-${PEAK_END_UTC} UTC"
    log "============================================"

    while true; do
        log "--- Новая итерация ---"

        # ТОКЕН-КОНТРОЛЬ: проверить бюджет перед поиском задачи
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
