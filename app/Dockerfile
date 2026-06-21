FROM golang:1.22-alpine AS builder

WORKDIR /app

# Git is not strictly required for these dependencies, removing to avoid apk network errors

COPY go.mod ./
# Copy go.sum if it exists (for reproducibility), otherwise it will be generated
COPY go.sum* ./
RUN go mod download || true

COPY . .

# Download local assets (Boxicons) to eliminate external internet dependencies on the client
RUN apk add --no-cache curl && \
    mkdir -p frontend/assets/css frontend/assets/fonts && \
    curl -sL "https://cdnjs.cloudflare.com/ajax/libs/boxicons/2.1.4/css/boxicons.min.css" -o frontend/assets/css/boxicons.min.css && \
    curl -sL "https://cdnjs.cloudflare.com/ajax/libs/boxicons/2.1.4/fonts/boxicons.woff2" -o frontend/assets/fonts/boxicons.woff2 && \
    curl -sL "https://cdnjs.cloudflare.com/ajax/libs/boxicons/2.1.4/fonts/boxicons.woff" -o frontend/assets/fonts/boxicons.woff && \
    curl -sL "https://cdnjs.cloudflare.com/ajax/libs/boxicons/2.1.4/fonts/boxicons.ttf" -o frontend/assets/fonts/boxicons.ttf && \
    mkdir -p frontend/assets/js && \
    curl -sL "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js" -o frontend/assets/js/mammoth.browser.min.js && \
    curl -sL "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" -o frontend/assets/js/jszip.min.js

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
