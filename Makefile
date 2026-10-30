.DEFAULT_GOAL := help

.PHONY: help install dev build build-debug test-build test lint version release tag chrome screenshot clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies from package-lock.json
	npm ci

dev: ## Start Vite dev server
	npm run dev

build: ## Type-check and build production extension into dist/
	npm run build

build-debug: ## Type-check and build debug extension into dist/
	npm run build:debug

# In a linked worktree the common git dir is the main checkout's .git, so its parent is the
# main checkout, whose dist/ is the one loaded in Chrome.
MAIN_DIR = $(shell dirname "$$(git rev-parse --path-format=absolute --git-common-dir)")

test-build: ## Type-check and build this checkout into the main checkout's dist/
	npx tsc && npx vite build --outDir "$(MAIN_DIR)/dist" --emptyOutDir

test: ## Run unit tests
	node --test tests/*.test.mjs

lint: ## Run ESLint
	npm run lint

version: ## Update extension version in package.json and manifest.json
	./tools/update-version.sh

release: ## Build and package zip for Chrome Web Store into releases/
	./tools/build-release.sh

tag: ## Create local release-{version} git tag
	./tools/create-release-tag.sh

chrome: ## Launch Chrome with a fresh test profile
	./tools/start-test-chrome.sh

screenshot: build ## Retake asset/sidebar.png with fake data (needs network; Playwright goes to tmp/)
	npm install --no-save --no-package-lock --prefix tmp/screenshot playwright@1.57.0
	tmp/screenshot/node_modules/.bin/playwright install chromium
	node tools/screenshot/take.mjs

clean: ## Remove build output
	rm -rf dist releases
