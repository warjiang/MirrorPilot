BINARY=mirrorpilot

.PHONY: tidy build test run lint

tidy:
	go mod tidy

build:
	go build -o bin/$(BINARY) ./cmd/mirrorpilot

test:
	go test ./...

run:
	go run ./cmd/mirrorpilot

lint:
	go vet ./...
