#!/usr/bin/env bash
# common.sh — Общие функции для всех daemon-агентов конвейера
# Используется: source common.sh

set -euo pipefail

# ---------------------------------------------------------------------------
# Конфигурация
# ---------------------------------------------------------------------------

# Репозиторий (переопределяется через env)
PIPELINE_REPO="${PIPELINE_REPO:-ppxtestarena4/pipeline-template}"

# GitHub Projects — идентификаторы
PROJECT_ID="PVT_kwHOD_OjOs4BS_m8"
STATUS_FIELD_ID="PVTSSF_lAHOD_OjOs4BS_m8zhAXbHg"

# ID колонок (option IDs в GitHub Projects v2)
declare -A COLUMN_IDS=(
    ["Backlog"]="05d4d819"
    ["To Do"]="04190f37"
    ["In Progress"]="ddb5c782"
    ["Review"]="714d42a7"
    ["Testing"]="2366049c"
    ["Done"]="21ff5a3b"
)

# Директория логов
LOG_DIR="/var/log/bravo"

# ---------------------------------------------------------------------------
# Логирование
# ---------------------------------------------------------------------------

# log <message> — пишет сообщение в лог-файл с временной меткой
log() {
    local message="$1"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local caller="${DAEMON_NAME:-common}"
    local log_file="${LOG_DIR}/${caller}.log"

    mkdir -p "${LOG_DIR}"
    echo "[${timestamp}] [${caller}] ${message}" | tee -a "${log_file}"
}

# ---------------------------------------------------------------------------
# GraphQL-утилиты
# ---------------------------------------------------------------------------

# _graphql <query> — выполняет GraphQL-запрос через gh api graphql
_graphql() {
    local query="$1"
    gh api graphql -f query="${query}"
}

# ---------------------------------------------------------------------------
# Работа с issue в GitHub Projects
# ---------------------------------------------------------------------------

# get_project_items_by_status <status_name>
# Возвращает список item ID + issue number для заданной колонки (по одному в строке: "ITEM_ID ISSUE_NUMBER")
get_project_items_by_status() {
    local status_name="$1"
    local column_id="${COLUMN_IDS[${status_name}]:-}"

    if [[ -z "${column_id}" ]]; then
        log "ERROR: Неизвестный статус: ${status_name}"
        return 1
    fi

    local query
    query=$(cat <<GRAPHQL
{
  node(id: "${PROJECT_ID}") {
    ... on ProjectV2 {
      items(first: 50) {
        nodes {
          id
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                optionId
                field {
                  ... on ProjectV2FieldCommon {
                    id
                  }
                }
              }
            }
          }
          content {
            ... on Issue {
              number
              assignees(first: 5) {
                nodes {
                  login
                }
              }
            }
          }
        }
      }
    }
  }
}
GRAPHQL
)

    gh api graphql -f query="${query}" \
        --jq ".data.node.items.nodes[] |
              select(.fieldValues.nodes[] |
                select(.field.id == \"${STATUS_FIELD_ID}\" and .optionId == \"${column_id}\")
              ) |
              \"\(.id) \(.content.number)\""
}

# get_first_unassigned_item_by_status <status_name>
# Возвращает первую незанятую задачу: "ITEM_ID ISSUE_NUMBER"
get_first_unassigned_item_by_status() {
    local status_name="$1"
    local column_id="${COLUMN_IDS[${status_name}]:-}"

    if [[ -z "${column_id}" ]]; then
        log "ERROR: Неизвестный статус: ${status_name}"
        return 1
    fi

    local query
    query=$(cat <<GRAPHQL
{
  node(id: "${PROJECT_ID}") {
    ... on ProjectV2 {
      items(first: 50) {
        nodes {
          id
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                optionId
                field {
                  ... on ProjectV2FieldCommon {
                    id
                  }
                }
              }
            }
          }
          content {
            ... on Issue {
              number
              assignees(first: 5) {
                nodes {
                  login
                }
              }
            }
          }
        }
      }
    }
  }
}
GRAPHQL
)

    gh api graphql -f query="${query}" \
        --jq ".data.node.items.nodes[] |
              select(.fieldValues.nodes[] |
                select(.field.id == \"${STATUS_FIELD_ID}\" and .optionId == \"${column_id}\")
              ) |
              select(.content.assignees.nodes | length == 0) |
              \"\(.id) \(.content.number)\"" \
        | head -n 1
}

# move_issue_to_status <item_id> <status_name>
# Перемещает item проекта в указанную колонку
move_issue_to_status() {
    local item_id="$1"
    local status_name="$2"
    local column_id="${COLUMN_IDS[${status_name}]:-}"

    if [[ -z "${column_id}" ]]; then
        log "ERROR: Неизвестный статус: ${status_name}"
        return 1
    fi

    local mutation
    mutation=$(cat <<GRAPHQL
mutation {
  updateProjectV2ItemFieldValue(input: {
    projectId: "${PROJECT_ID}"
    itemId: "${item_id}"
    fieldId: "${STATUS_FIELD_ID}"
    value: { singleSelectOptionId: "${column_id}" }
  }) {
    projectV2Item {
      id
    }
  }
}
GRAPHQL
)

    gh api graphql -f query="${mutation}" > /dev/null
    log "Задача ${item_id} перемещена в '${status_name}'"
}

# ---------------------------------------------------------------------------
# Работа с issue через REST API
# ---------------------------------------------------------------------------

# get_issue_body <issue_number>
# Возвращает заголовок и тело issue
get_issue_body() {
    local issue_number="$1"
    gh api "repos/${PIPELINE_REPO}/issues/${issue_number}" \
        --jq '"# " + .title + "\n\n" + .body'
}

# assign_issue <issue_number>
# Назначает issue текущему пользователю gh (агенту)
assign_issue() {
    local issue_number="$1"
    local current_user
    current_user=$(gh api user --jq '.login')

    gh api "repos/${PIPELINE_REPO}/issues/${issue_number}" \
        --method PATCH \
        --field "assignees[]=${current_user}" \
        > /dev/null

    log "Issue #${issue_number} назначено пользователю ${current_user}"
}

# comment_on_issue <issue_number> <body>
# Публикует комментарий к issue
comment_on_issue() {
    local issue_number="$1"
    local body="$2"

    gh api "repos/${PIPELINE_REPO}/issues/${issue_number}/comments" \
        --method POST \
        --field "body=${body}" \
        > /dev/null

    log "Комментарий к issue #${issue_number} опубликован"
}

# unassign_issue <issue_number>
# Снимает назначение с issue (при ошибке или возврате)
unassign_issue() {
    local issue_number="$1"
    gh api "repos/${PIPELINE_REPO}/issues/${issue_number}" \
        --method PATCH \
        --field "assignees[]=" \
        > /dev/null 2>&1 || true

    log "Назначение с issue #${issue_number} снято"
}

# ---------------------------------------------------------------------------
# Вспомогательные функции Git
# ---------------------------------------------------------------------------

# ensure_branch <branch_name>
# Создаёт ветку от main или переключается на неё, если уже существует
ensure_branch() {
    local branch_name="$1"

    git fetch origin main --quiet

    if git ls-remote --exit-code --heads origin "${branch_name}" > /dev/null 2>&1; then
        git checkout "${branch_name}" --quiet
        git pull origin "${branch_name}" --quiet
    else
        git checkout -b "${branch_name}" origin/main --quiet
    fi

    log "Переключились на ветку ${branch_name}"
}

# ---------------------------------------------------------------------------
# Проверка зависимостей
# ---------------------------------------------------------------------------

check_dependencies() {
    local deps=("gh" "git" "codex")
    local missing=()

    for dep in "${deps[@]}"; do
        if ! command -v "${dep}" &> /dev/null; then
            missing+=("${dep}")
        fi
    done

    if [[ ${#missing[@]} -gt 0 ]]; then
        log "ERROR: Отсутствуют зависимости: ${missing[*]}"
        exit 1
    fi
}

# get_first_item_by_status <status_name>
# Возвращает первую задачу в колонке (любую, включая assigned): "ITEM_ID ISSUE_NUMBER"
# Используется Reviewer и Tester, которые сами управляют назначением.
get_first_item_by_status() {
    local status_name="$1"
    local column_id="${COLUMN_IDS[${status_name}]:-}"

    if [[ -z "${column_id}" ]]; then
        log "ERROR: Неизвестный статус: ${status_name}"
        return 1
    fi

    local query
    query=$(cat <<GRAPHQL
{
  node(id: "${PROJECT_ID}") {
    ... on ProjectV2 {
      items(first: 50) {
        nodes {
          id
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                optionId
                field {
                  ... on ProjectV2FieldCommon {
                    id
                  }
                }
              }
            }
          }
          content {
            ... on Issue {
              number
              state
            }
          }
        }
      }
    }
  }
}
GRAPHQL
)

    gh api graphql -f query="${query}" \
        --jq ".data.node.items.nodes[] |
              select(.content.state == \"OPEN\") |
              select(.fieldValues.nodes[] |
                select(.field.id == \"${STATUS_FIELD_ID}\" and .optionId == \"${column_id}\")
              ) |
              \"\(.id) \(.content.number)\"" \
        | head -n 1
}

# get_first_item_by_status <status_name>
# Возвращает первую задачу в колонке (любую, включая assigned): "ITEM_ID ISSUE_NUMBER"
# Используется Reviewer и Tester, которые сами управляют назначением.
get_first_item_by_status() {
    local status_name="$1"
    local column_id="${COLUMN_IDS[${status_name}]:-}"

    if [[ -z "${column_id}" ]]; then
        log "ERROR: Неизвестный статус: ${status_name}"
        return 1
    fi

    local query
    query=$(cat <<GRAPHQL
{
  node(id: "${PROJECT_ID}") {
    ... on ProjectV2 {
      items(first: 50) {
        nodes {
          id
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                optionId
                field {
                  ... on ProjectV2FieldCommon {
                    id
                  }
                }
              }
            }
          }
          content {
            ... on Issue {
              number
              state
            }
          }
        }
      }
    }
  }
}
GRAPHQL
)

    gh api graphql -f query="${query}" \
        --jq ".data.node.items.nodes[] |
              select(.content.state == \"OPEN\") |
              select(.fieldValues.nodes[] |
                select(.field.id == \"${STATUS_FIELD_ID}\" and .optionId == \"${column_id}\")
              ) |
              \"\(.id) \(.content.number)\"" \
        | head -n 1
}
