# Open Aviation Telemetry
#
# The commands a reviewer needs, in the order they need them.
# Run `make` on its own for the list.

SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE ?= docker compose
API_URL  ?= http://localhost:8080
WEB_URL  ?= http://localhost:3000

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ------------------------------------------------------------------ local dev

.PHONY: bootstrap
bootstrap: ## Install dependencies
	pnpm install

.PHONY: lint
lint: ## Check formatting and types across every package
	pnpm format:check
	pnpm -r --filter "./packages/*" typecheck

.PHONY: test
test: ## Run the unit and component test suites
	pnpm vitest run

.PHONY: build
build: ## Compile every package
	pnpm -r --filter "./packages/*" build

.PHONY: check
check: lint test ## Everything CI runs on a pull request

# ------------------------------------------------------------------ the demo

.PHONY: up
up: ## Build and start the whole stack
	$(COMPOSE) up -d --build

.PHONY: demo
demo: up wait seed ## Start the stack and run the simulator — the one command to show this off
	@echo ""
	@echo "  Dashboard      $(WEB_URL)"
	@echo "  API docs       $(API_URL)/docs"
	@echo "  RabbitMQ UI    http://localhost:15672  (oat / oat)"
	@echo ""
	@echo "  make smoke     prove the pipeline end to end"
	@echo "  make down      stop everything and delete the data"
	@echo ""

.PHONY: wait
wait: ## Block until the API reports ready
	@echo "waiting for the stack to become ready..."
	@for i in $$(seq 1 90); do \
		if curl -sf $(API_URL)/ready > /dev/null 2>&1; then echo "ready"; exit 0; fi; \
		sleep 2; \
	done; \
	echo "the stack did not become ready in time; try 'make logs'"; \
	curl -s $(API_URL)/ready || true; \
	exit 1

.PHONY: seed
seed: ## Start the simulator at the calm profile
	@curl -sf -X POST $(API_URL)/api/v1/demo/start \
		-H 'content-type: application/json' \
		-d '{"profile":"calm"}' > /dev/null && echo "simulator started (calm: 10 aircraft)"

.PHONY: busy
busy: ## Switch the simulator to 100 aircraft
	@curl -sf -X POST $(API_URL)/api/v1/demo/start \
		-H 'content-type: application/json' -d '{"profile":"busy"}' > /dev/null && echo "busy"

.PHONY: burst
burst: ## Push a burst of telemetry to make consumer lag visible
	@curl -sf -X POST $(API_URL)/api/v1/demo/start \
		-H 'content-type: application/json' -d '{"profile":"burst"}' > /dev/null && echo "burst"

.PHONY: smoke
smoke: ## Prove the whole pipeline works against the running stack
	API_URL=$(API_URL) ./scripts/smoke-test.sh

.PHONY: e2e
e2e: ## Run the end-to-end suite against the running stack
	E2E_BASE_URL=$(API_URL) pnpm vitest run --config tests/e2e/vitest.config.ts

.PHONY: logs
logs: ## Follow logs from every service
	$(COMPOSE) logs -f --tail=80

.PHONY: status
status: ## Show container and readiness status
	@$(COMPOSE) ps
	@echo ""
	@echo "API readiness:"
	@curl -s $(API_URL)/ready | head -c 2000 || echo "  API not reachable"
	@echo ""

.PHONY: down
down: ## Stop everything and delete the volumes
	$(COMPOSE) down -v --remove-orphans

# ------------------------------------------------------------------ web build

.PHONY: research-data
research-data: ## Regenerate the research page's data from docs/research
	node scripts/build-research-data.mjs

.PHONY: web-build
web-build: ## Build the static client for publishing under a subdirectory
	VITE_API_BASE_URL="$(VITE_API_BASE_URL)" \
		pnpm --filter @oat/web exec vite build --base "$(BASE_PATH)"

# ------------------------------------------------------------------ terraform

.PHONY: tf-init
tf-init: ## Initialise Terraform for the demo environment
	cd infra/terraform/environments/demo && terraform init

.PHONY: tf-validate
tf-validate: ## Format-check and validate the Terraform
	terraform fmt -check -recursive infra/terraform
	cd infra/terraform/environments/demo && terraform init -backend=false -input=false > /dev/null && terraform validate

.PHONY: tf-plan
tf-plan: ## Show what would be created in AWS
	cd infra/terraform/environments/demo && terraform plan

.PHONY: tf-apply
tf-apply: ## Create the AWS infrastructure (costs money)
	cd infra/terraform/environments/demo && terraform apply

.PHONY: destroy
destroy: ## Destroy the AWS infrastructure
	cd infra/terraform/environments/demo && terraform destroy
