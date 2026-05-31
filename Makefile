BINARY=mirrorpilot
GO ?= GOTOOLCHAIN=go1.24.0+auto go

.PHONY: tidy build test run lint

tidy:
	$(GO) mod tidy

build:
	$(GO) build -o bin/$(BINARY) ./cmd/mirrorpilot

test:
	$(GO) test ./...

run:
	$(GO) run ./cmd/mirrorpilot

lint:
	$(GO) vet ./...
