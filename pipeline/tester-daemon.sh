#!/usr/bin/env bash
# tester-daemon.sh — Агент-тестировщик (Tester)
# Берёт задачи из колонки "Testing", проверяет соответствие спека-чеклисту,
# запускает тесты, выносит вердикт PASS/FAIL.
# При PASS — создаёт PR и перемещает в Done.
# Запускается через systemd (bravo-tester.service).

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
# Создаёт Pull Request из feature-ветки в main
create_pull_request() {
    local branch_name="$1"
    local issue_number="$2"

    local issue_title
    issue_title=$(gh api "repos/${PIPELINE_REPO}/issues/${issue_number}" --jq '.title')

    local pr_body
    pr_body=$(cat <<BODY
## Описание

Автоматически созданный Pull Request по результатам прохождения всего конвейера.

**Реализует:** #${issue_number} — ${issue_title}

## Чеклист конвейера

- [x] Coder: реализация завершена
- [x] Reviewer: код прошёл ревью
- [x] Tester: все тесты пройдены

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

    # 3. Переключиться на feature-ветку и получить код
    local branch_name="feature/issue-${issue_number}"
    cd "${REPO_DIR:-$(git rev-parse --show-toplevel)}"

    git fetch origin --quiet

    if ! git ls-remote --exit-code --heads origin "${branch_name}" > /dev/null 2>&1; then
        log "ERROR: Ветка ${branch_name} не найдена"
        comment_on_issue "${issue_number}" "❌ **Tester**: ветка \`${branch_name}\` не найдена. Невозможно выполнить тестирование."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    fi

    git checkout "${branch_name}" --quiet
    git pull origin "${branch_name}" --quiet

    # 4. Получить список и содержимое изменённых файлов
    local changed_files
    changed_files=$(git diff --name-only "origin/main...HEAD" 2>/dev/null || git diff --name-only HEAD~1 HEAD)

    local files_content=""
    while IFS= read -r file; do
        if [[ -f "${file}" ]]; then
            files_content+=$'\n\n'"=== Файл: ${file} ===\n"
            files_content+=$(cat "${file}")
        fi
    done <<< "${changed_files}"

    # 5. Попробовать запустить реальные тесты (если есть)
    local test_results="Автоматические тесты не обнаружены в репозитории."

    if [[ -f "tests/run_tests.sh" ]]; then
        log "Найден tests/run_tests.sh, запускаем..."
        test_results=$(bash tests/run_tests.sh 2>&1) || {
            log "Тесты завершились с ошибкой"
            test_results="ОШИБКА ЗАПУСКА ТЕСТОВ:\n${test_results}"
        }
    elif [[ -f "pytest.ini" ]] || [[ -f "setup.cfg" ]] || find . -name "test_*.py" -maxdepth 3 | grep -q .; then
        log "Найдены pytest-тесты, запускаем..."
        test_results=$(python -m pytest --tb=short 2>&1) || {
            log "pytest завершился с ошибкой"
        }
    elif find . -name "*.test.js" -maxdepth 4 | grep -q . || [[ -f "package.json" ]]; then
        if command -v npm &>/dev/null && grep -q '"test"' package.json 2>/dev/null; then
            log "Найдены npm-тесты, запускаем..."
            test_results=$(npm test 2>&1) || {
                log "npm test завершился с ошибкой"
            }
        fi
    fi

    # 6. Запустить Codex как тестировщика
    local codex_prompt
    codex_prompt=$(cat <<PROMPT
Ты — опытный QA-тестировщик. Проверь реализацию на соответствие спецификации.

## Спецификация задачи (Issue #${issue_number})

${issue_spec}

## Реализованный код

${files_content}

## Результаты автоматических тестов

${test_results}

## Задача тестирования

Проверь следующее:
1. **Спека-чеклист** — каждый пункт "Критерии готовности" из issue выполнен?
2. **Gate: Coder → QA** — все файлы из чеклиста существуют?
3. **Gate: QA → Review** — код соответствует спецификации?
4. **Функциональность** — реализованный код логически правильный?
5. **Результаты тестов** — автоматические тесты прошли (если были)?
6. **Граничные случаи** — обработаны ли ошибки и граничные случаи?

## Формат ответа

Дай подробный отчёт по каждому пункту. В ПОСЛЕДНЕЙ строке напиши ТОЛЬКО одно:
VERDICT: PASS
VERDICT: FAIL

При FAIL укажи конкретно, что не соответствует спецификации.
PROMPT
)

    log "Запускаем codex exec для тестирования issue #${issue_number}..."

    local test_output=""
    local codex_exit=0

    test_output=$(timeout "${CODEX_TIMEOUT}" codex exec --full-auto "${codex_prompt}" 2>&1) || codex_exit=$?

    if [[ ${codex_exit} -eq 124 ]]; then
        log "ERROR: codex exec превысил таймаут для тестирования issue #${issue_number}"
        comment_on_issue "${issue_number}" "❌ **Tester**: превышен таймаут тестирования (15 мин). Задача возвращена в In Progress."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    elif [[ ${codex_exit} -ne 0 ]]; then
        log "ERROR: codex exec завершился с кодом ${codex_exit}"
        comment_on_issue "${issue_number}" "❌ **Tester**: ошибка при выполнении тестирования (exit ${codex_exit}). Задача возвращена в In Progress."
        move_issue_to_status "${item_id}" "In Progress"
        unassign_issue "${issue_number}"
        return 1
    fi

    log "Codex завершил тестирование. Анализируем вердикт..."

    # 7. Парсим вердикт
    local verdict=""
    verdict=$(echo "${test_output}" | grep -o 'VERDICT: \(PASS\|FAIL\)' | tail -n 1 | awk '{print $2}')

    if [[ -z "${verdict}" ]]; then
        log "WARN: Вердикт не найден в выводе codex. Считаем FAIL."
        verdict="FAIL"
    fi

    log "Вердикт тестирования для issue #${issue_number}: ${verdict}"

    # 8. Действие по вердикту
    if [[ "${verdict}" == "PASS" ]]; then
        # Переместить в Done
        move_issue_to_status "${item_id}" "Done"
        log "Issue #${issue_number} → Done"

        # Создать Pull Request
        local pr_url
        pr_url=$(create_pull_request "${branch_name}" "${issue_number}")
        log "Pull Request создан: ${pr_url}"

        comment_on_issue "${issue_number}" "✅ **Tester**: все тесты пройдены!

**Отчёт тестирования:**
${test_output}

**Pull Request:** ${pr_url}

Задача перемещена в **Done**. Ожидается финальная проверка человеком."

        log "=== Issue #${issue_number} прошёл тестирование → Done ==="

    else
        # Вернуть в In Progress
        move_issue_to_status "${item_id}" "In Progress"
        log "Issue #${issue_number} → In Progress (тестирование не пройдено)"

        comment_on_issue "${issue_number}" "🔄 **Tester**: тестирование не пройдено. Требуются исправления.

**Отчёт тестирования:**
${test_output}

Задача возвращена в **In Progress** для исправления."

        log "=== Issue #${issue_number} не прошёл тестирование, возвращён в In Progress ==="
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
    log "============================================"

    while true; do
        log "--- Новая итерация ---"

        # Найти первую незанятую задачу в "Testing"
        local task_line=""
        task_line=$(get_first_unassigned_item_by_status "Testing" 2>/dev/null || true)

        if [[ -z "${task_line}" ]]; then
            log "Нет задач в 'Testing'. Ожидание ${SLEEP_INTERVAL}s..."
        else
            local item_id issue_number
            item_id=$(echo "${task_line}" | awk '{print $1}')
            issue_number=$(echo "${task_line}" | awk '{print $2}')

            log "Найдена задача для тестирования: issue #${issue_number} (item: ${item_id})"

            if ! process_testing "${item_id}" "${issue_number}"; then
                log "ERROR: Тестирование issue #${issue_number} завершилось с ошибкой. Продолжаем цикл."
            fi
        fi

        log "Ожидание ${SLEEP_INTERVAL}s до следующей итерации..."
        sleep "${SLEEP_INTERVAL}"
    done
}

main "$@"
