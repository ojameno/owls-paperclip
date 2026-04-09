.PHONY: up down clean clean-all setup onboard bootstrap help

# Docker Compose project name
COMPOSE_PROJECT_NAME := paperclip
COMPOSE_FILE := docker/docker-compose.yml

help:
	@echo "Paperclip Docker Makefile"
	@echo ""
	@echo "Available targets:"
	@echo "  make up        - Start all services via Docker (with volume mounts for persistence)"
	@echo "  make down      - Stop all services"
	@echo "  make setup     - Run onboard and bootstrap (requires Docker running)"
	@echo "  make onboard   - Run onboard only (requires Docker running)"
	@echo "  make bootstrap - Run bootstrap-ceo only (requires Docker running)"
	@echo "  make typecheck - Run typecheck in Docker container"
	@echo "  make clean     - Remove containers and networks (preserve volumes)"
	@echo "  make clean-all - Remove everything including volumes (data loss!)"
	@echo "  make help      - Show this help message"
	@echo ""

up:
	@if ! docker images --format '{{.Repository}}:{{.Tag}}' | grep -q "owls-paperclip-server:latest"; then \
		echo "Docker image not found, building..."; \
		docker-compose -f $(COMPOSE_FILE) build; \
	else \
		echo "Using existing Docker image"; \
	fi
	@echo "Starting services..."
	@trap 'docker-compose -f $(COMPOSE_FILE) down; exit' INT TERM; \
	docker-compose -f $(COMPOSE_FILE) up --abort-on-container-exit

down:
	docker-compose -f $(COMPOSE_FILE) down

setup:
	@echo "Checking if Docker is running..."
	@if ! docker info > /dev/null 2>&1; then \
		echo "Error: Docker is not running. Please start Docker and try again."; \
		exit 1; \
	fi
	@$(MAKE) onboard
	@$(MAKE) bootstrap

onboard:
	@echo "Checking if Docker is running..."
	@if ! docker info > /dev/null 2>&1; then \
		echo "Error: Docker is not running. Please start Docker and try again."; \
		exit 1; \
	fi
	@echo "Docker is running. Running onboard..."
	@docker-compose -f $(COMPOSE_FILE) exec server pnpm paperclipai onboard

bootstrap:
	@echo "Checking if Docker is running..."
	@if ! docker info > /dev/null 2>&1; then \
		echo "Error: Docker is not running. Please start Docker and try again."; \
		exit 1; \
	fi
	@echo "Docker is running. Bootstrapping instance admin..."
	@docker-compose -f $(COMPOSE_FILE) exec server pnpm paperclipai auth bootstrap-ceo

typecheck:
	@echo "Checking if Docker is running..."
	@if ! docker info > /dev/null 2>&1; then \
		echo "Error: Docker is not running. Please start Docker and try again."; \
		exit 1; \
	fi
	@echo "Running typecheck in Docker..."
	@docker-compose -f $(COMPOSE_FILE) exec server pnpm -r typecheck

clean:
	docker-compose -f $(COMPOSE_FILE) down --remove-orphans
	docker-compose -f $(COMPOSE_FILE) rm -f -v
	docker images --format '{{.Repository}}:{{.Tag}}' | grep '^owls-paperclip-server:' | xargs -r docker rmi 2>/dev/null || true

clean-all:
	docker-compose -f $(COMPOSE_FILE) down -v --remove-orphans
	docker images --format '{{.Repository}}:{{.Tag}}' | grep '^owls-paperclip-server:' | xargs -r docker rmi 2>/dev/null || true
	docker volume ls --format '{{.Name}}' | grep 'paperclip' | xargs -r docker volume rm 2>/dev/null || true
	rm -rf ./data docker/data
