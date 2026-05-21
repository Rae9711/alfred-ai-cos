# Albert dev tasks. Run `make help` for the list.
# Backend uses uv, mobile + shared-types use bun. No workspace tool.

.DEFAULT_GOAL := help
BACKEND := backend
SHARED := packages/shared-types
MOBILE := mobile

.PHONY: help install lint typecheck test verify backend-verify shared-verify mobile-verify \
        run worker beat migrate seed fmt

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\n", $$1, $$2}'

install: ## Install all dependencies (backend + JS workspaces)
	cd $(BACKEND) && uv sync
	bun install

# --- Verification gate (mirrors CI) ---

lint: ## Lint + format-check the backend (ruff)
	cd $(BACKEND) && uv run ruff check app tests && uv run ruff format --check app tests

typecheck: ## Type-check everything (mypy + tsc x2)
	cd $(BACKEND) && uv run mypy app
	cd $(SHARED) && bunx tsc --noEmit
	cd $(MOBILE) && bunx tsc --noEmit

test: ## Run the backend test suite
	cd $(BACKEND) && uv run pytest

backend-verify: ## Full backend gate
	cd $(BACKEND) && uv run ruff check app tests && uv run ruff format --check app tests \
		&& uv run mypy app && uv run pytest

shared-verify: ## Type-check shared-types
	cd $(SHARED) && bunx tsc --noEmit

mobile-verify: ## Type-check the mobile app
	cd $(MOBILE) && bunx tsc --noEmit

verify: backend-verify shared-verify mobile-verify ## The full gate: lint, type-check, test, tsc x2
	@echo "All checks passed."

fmt: ## Auto-fix lint + format the backend
	cd $(BACKEND) && uv run ruff check app tests --fix && uv run ruff format app tests

# --- Run ---

run: ## Run the API (uvicorn, reload)
	cd $(BACKEND) && uv run uvicorn app.main:app --reload

worker: ## Run the Celery worker
	cd $(BACKEND) && uv run celery -A app.workers.celery_app worker --loglevel=info

beat: ## Run the Celery beat scheduler
	cd $(BACKEND) && uv run celery -A app.workers.celery_app beat --loglevel=info

migrate: ## Apply database migrations
	cd $(BACKEND) && uv run alembic upgrade head

seed: ## Print the dev-seed curl flow (no Google needed)
	@echo 'BASE=http://localhost:8000/api/v1'
	@echo 'TOKEN=$$(curl -s -X POST "$$BASE/auth/dev-session?email=you@example.com" | python3 -c "import sys,json;print(json.load(sys.stdin)[\"access_token\"])")'
	@echo 'curl -s -X POST "$$BASE/dev/seed" -H "Authorization: Bearer $$TOKEN" | python3 -m json.tool'
	@echo 'curl -s "$$BASE/today" -H "Authorization: Bearer $$TOKEN" | python3 -m json.tool'
