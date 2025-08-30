# Makefile - common developer tasks for Lumina Outreach

.PHONY: install deps server client dev test lint

install:
	@echo "Installing root dependencies..."
	npm install

deps:
	@echo "Installing server and client dependencies..."
	cd server && npm install
	cd ../client && npm install

server:
	@echo "Starting server (dev)..."
	cd server && npm run dev

client:
	@echo "Starting client (dev)..."
	cd client && npm run dev

dev:
	@echo "Start both server and client in separate terminals or use your own multiprocess tool"
	@echo "Use 'make server' and 'make client' in separate shells"

test:
	@echo "Run server tests"
	cd server && npm test

lint:
	@echo "Run lint/typecheck if configured"
	npm run lint || true
