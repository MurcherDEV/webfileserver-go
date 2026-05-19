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

const dataDir = "/data"

var (
	authUser string
	authHash []byte
)

func init() {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		log.Fatalf("Failed to create data directory: %v", err)
	}

	// Read credentials from environment variables (defaults: admin / admin)
	authUser = os.Getenv("AUTH_USER")
	if authUser == "" {
		authUser = "admin"
	}

	authPass := os.Getenv("AUTH_PASS")
	if authPass == "" {
		authPass = "admin"
	}

	// Generate bcrypt hash at startup so we don't need a pre-computed hash
	hash, err := bcrypt.GenerateFromPassword([]byte(authPass), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("Failed to hash password: %v", err)
	}
	authHash = hash
	log.Printf("Auth configured for user: %s", authUser)
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

	// Serve frontend files without basic auth to prevent native browser popup
	mux.Handle("/", http.FileServer(http.FS(subFS)))

	// Protect WebDAV with basic auth (send challenge to prompt OS client)
	mux.Handle("/webdav/", basicAuth(webdavHandler, true))

	// Protect API endpoints with basic auth (no challenge to prevent browser popup)
	apiMux := http.NewServeMux()
	apiMux.HandleFunc("/api/files", handleListFiles)
	apiMux.HandleFunc("/api/upload", handleUpload)
	apiMux.HandleFunc("/api/download", handleDownload)
	apiMux.HandleFunc("/api/delete", handleDelete)
	
	mux.Handle("/api/", basicAuth(apiMux, false))

	log.Println("Starting server on :8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatal(err)
	}
}

func basicAuth(next http.Handler, sendChallenge bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != authUser || bcrypt.CompareHashAndPassword(authHash, []byte(pass)) != nil {
			if sendChallenge {
				w.Header().Set("WWW-Authenticate", `Basic realm="Restricted"`)
			}
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func safePath(reqPath string) (string, bool) {
	cleaned := filepath.Clean(reqPath)
	fullPath := filepath.Join(dataDir, cleaned)
	// Ensure the path is strictly within dataDir
	if fullPath != dataDir && !strings.HasPrefix(fullPath, dataDir+string(os.PathSeparator)) {
		return "", false
	}
	return fullPath, true
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

	fullPath, ok := safePath(reqPath)
	if !ok {
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

	fullPath := filepath.Join(dataDir, filepath.Clean(reqPath), filepath.Base(header.Filename))
	if !strings.HasPrefix(fullPath, dataDir+string(os.PathSeparator)) {
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

	w.Header().Set("Content-Type", "application/json")
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

	fullPath, ok := safePath(reqPath)
	if !ok {
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

	fullPath, ok := safePath(reqPath)
	if !ok {
		http.Error(w, "Invalid path", http.StatusBadRequest)
		return
	}

	err := os.RemoveAll(fullPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}
