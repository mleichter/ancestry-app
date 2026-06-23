SHELL := /bin/bash
REPORTS  := test-reports
COMPOSE  := docker compose -f docker-compose.yml
BACKEND  := backend
FRONTEND := frontend

.PHONY: all test test-backend test-frontend test-e2e build up deploy report clean

# ── Test targets ──────────────────────────────────────────────────────────────

# Run unit tests (backend + frontend) — required before every build
test: test-backend test-frontend

test-backend:
	@mkdir -p $(REPORTS)
	@echo "▶  Backend tests (pytest / SQLite)..."
	@cd $(BACKEND) && \
	  DATABASE_URL=sqlite+aiosqlite:///./test.db \
	  MEDIA_STORAGE_PATH=/tmp/ancestry-test-media \
	  PYTHONPATH=. \
	  python3 -m pytest tests/ -q \
	    --html=../$(REPORTS)/backend.html \
	    --self-contained-html \
	    --tb=short 2>&1
	@rm -f $(BACKEND)/test.db

test-frontend:
	@mkdir -p $(REPORTS)
	@echo "▶  Frontend tests (vitest)..."
	@cd $(FRONTEND) && npm test 2>&1

# E2E tests run against the live deployed stack (call after 'make up')
test-e2e:
	@mkdir -p $(REPORTS)
	@echo "▶  E2E smoke tests (Playwright)..."
	@python3 -m pytest tests/e2e/ -v \
	  --html=$(REPORTS)/e2e.html \
	  --self-contained-html \
	  --tb=short 2>&1

# ── Build and deploy ──────────────────────────────────────────────────────────

build: test
	@echo "▶  Building Docker images..."
	@bash build.sh

up:
	@echo "▶  Starting services..."
	@$(COMPOSE) up -d

# Full deploy pipeline: unit tests → build → start → e2e → report
deploy: test build up test-e2e report
	@echo ""
	@echo "✅ Deployment complete. Test reports: $(REPORTS)/index.html"

# ── Reports ───────────────────────────────────────────────────────────────────

report:
	@python3 scripts/generate_report_index.py
	@echo "▶  Reports at $(REPORTS)/index.html"

# ── Utilities ─────────────────────────────────────────────────────────────────

clean:
	@rm -f $(REPORTS)/*.html $(REPORTS)/*.xml $(BACKEND)/test.db
	@echo "Cleaned test artifacts."

logs:
	@$(COMPOSE) logs -f

down:
	@$(COMPOSE) down
