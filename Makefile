BINARY=sync-images

.PHONY: tidy build test run lint

tidy:
	go mod tidy

build:
	go build -o bin/$(BINARY) ./cmd/sync-images

test:
	go test ./...

run:
	go run ./cmd/sync-images

lint:
	go vet ./...
