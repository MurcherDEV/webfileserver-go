FROM golang:1.22-alpine AS builder

WORKDIR /app

# Git is not strictly required for these dependencies, removing to avoid apk network errors

COPY go.mod ./
# Copy go.sum if it exists (for reproducibility), otherwise it will be generated
COPY go.sum* ./
RUN go mod download || true

COPY . .

# Generate go.sum and build the statically linked executable
RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o file-server .

# Use a minimal alpine image for the final stage
FROM alpine:latest  

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /root/

COPY --from=builder /app/file-server .

EXPOSE 8080

CMD ["./file-server"]
