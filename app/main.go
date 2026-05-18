package main

import (
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/net/webdav"
)

//go:embed frontend/*
var frontendFS embed.FS

const (
	dataDir     = "/data"
	defaultUser = "admin"
	// bcrypt hash for "admin"
	defaultHash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
)

func init() {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		log.Fatalf("Failed to create data directory: %v", err)
	}
}

type FileInfo struct {
	Name  string `json:"name"`
	IsDir bool   `json:"is_dir"`
	Size  int64  `json:"size"`
	Path  string `json:"path"`
}

func main() {
	webdavHandler := &webdav.Handler{
		Prefix:     "/webdav",
		FileSystem: webdav.Dir(dataDir),
		LockSystem: webdav.NewMemLS(),
		Logger: func(r *http.Request, err error) {
			if err != nil {
				log.Printf("WebDAV [%s]: %s, ERROR: %v", r.Method, r.URL, err)
			}
		},
	}

	mux := http.NewServeMux()

	subFS, err := fs.Sub(frontendFS, "frontend")
	if err != nil {
		log.Fatal(err)
	}

	mux.Handle("/", http.FileServer(http.FS(subFS)))
	mux.Handle("/webdav/", webdavHandler)

	mux.HandleFunc("/api/files", handleListFiles)
	mux.HandleFunc("/api/upload", handleUpload)
	mux.HandleFunc("/api/download", handleDownload)
	mux.HandleFunc("/api/delete", handleDelete)

	authHandler := basicAuth(mux)

	log.Println("Starting server on :8080")
	if err := http.ListenAndServe(":8080", authHandler); err != nil {
		log.Fatal(err)
	}
}

func basicAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != defaultUser || bcrypt.CompareHashAndPassword([]byte(defaultHash), []byte(pass)) != nil {
			w.Header().Set("WWW-Authenticate", `Basic realm="Restricted"`)
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func handleListFiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	reqPath := r.URL.Query().Get("path")
	if reqPath == "" {
		reqPath = "/"
	}

	fullPath := filepath.Join(dataDir, filepath.Clean(reqPath))
	if !strings.HasPrefix(fullPath, dataDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	entries, err := os.ReadDir(fullPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	files := make([]FileInfo, 0)
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, FileInfo{
			Name:  e.Name(),
			IsDir: e.IsDir(),
			Size:  info.Size(),
			Path:  filepath.ToSlash(filepath.Join(reqPath, e.Name())),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

func handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	reqPath := r.URL.Query().Get("path")
	if reqPath == "" {
		reqPath = "/"
	}

	err := r.ParseMultipartForm(10 << 20) // 10MB memory max, rest on disk
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	defer file.Close()

	fullPath := filepath.Join(dataDir, filepath.Clean(reqPath), header.Filename)
	if !strings.HasPrefix(fullPath, dataDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	out, err := os.Create(fullPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer out.Close()

	_, err = io.Copy(out, file)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

func handleDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	reqPath := r.URL.Query().Get("path")
	if reqPath == "" {
		http.Error(w, "Path required", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(dataDir, filepath.Clean(reqPath))
	if !strings.HasPrefix(fullPath, dataDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	http.ServeFile(w, r, fullPath)
}

func handleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	reqPath := r.URL.Query().Get("path")
	if reqPath == "" || reqPath == "/" {
		http.Error(w, "Path required and cannot be root", http.StatusBadRequest)
		return
	}

	fullPath := filepath.Join(dataDir, filepath.Clean(reqPath))
	if !strings.HasPrefix(fullPath, dataDir) {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	err := os.RemoveAll(fullPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}
