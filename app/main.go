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
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
	"golang.org/x/net/webdav"
)

//go:embed frontend/*
var frontendFS embed.FS

const dataDir = "/data"
const trashDir = "/data/.trash"
const starredFile = "/data/.starred.json"

var starredMutex sync.RWMutex

var (
	authUser string
	authHash []byte
)

type FileInfo struct {
	Name      string `json:"name"`
	IsDir     bool   `json:"is_dir"`
	Size      int64  `json:"size"`
	Path      string `json:"path"`
	IsStarred bool   `json:"is_starred"`
}

func loadStarred() map[string]bool {
	starredMutex.RLock()
	defer starredMutex.RUnlock()
	starred := make(map[string]bool)
	data, err := os.ReadFile(starredFile)
	if err == nil {
		var list []string
		json.Unmarshal(data, &list)
		for _, item := range list {
			starred[item] = true
		}
	}
	return starred
}

func saveStarred(starred map[string]bool) {
	starredMutex.Lock()
	defer starredMutex.Unlock()
	var list []string
	for k := range starred {
		list = append(list, k)
	}
	data, _ := json.Marshal(list)
	os.WriteFile(starredFile, data, 0644)
}

func init() {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		log.Fatalf("Failed to create data directory: %v", err)
	}
	if err := os.MkdirAll(trashDir, 0755); err != nil {
		log.Fatalf("Failed to create trash directory: %v", err)
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
	apiMux.HandleFunc("/api/mkdir", handleMkdir)
	apiMux.HandleFunc("/api/search", handleSearch)
	apiMux.HandleFunc("/api/star", handleStar)
	apiMux.HandleFunc("/api/trash", handleTrash)
	apiMux.HandleFunc("/api/restore", handleRestore)
	
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

	starred := loadStarred()
	onlyStarred := r.URL.Query().Get("starred") == "true"

	files := make([]FileInfo, 0)
	for _, e := range entries {
		// Skip internal folders
		if e.Name() == ".trash" || e.Name() == ".starred.json" {
			continue
		}

		info, err := e.Info()
		if err != nil {
			continue
		}
		
		relPath := filepath.ToSlash(filepath.Join(reqPath, e.Name()))
		if relPath == "" || relPath[0] != '/' {
			relPath = "/" + relPath
		}
		isStar := starred[relPath]

		if onlyStarred && !isStar {
			continue
		}

		files = append(files, FileInfo{
			Name:      e.Name(),
			IsDir:     e.IsDir(),
			Size:      info.Size(),
			Path:      relPath,
			IsStarred: isStar,
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

	// If already in trash, permanently delete
	if strings.HasPrefix(reqPath, "/.trash/") {
		err := os.RemoveAll(fullPath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		// Soft delete to .trash with timestamp
		fileName := filepath.Base(fullPath)
		trashName := fmt.Sprintf("%d_%s", time.Now().Unix(), fileName)
		trashPath := filepath.Join(trashDir, trashName)

		err := os.Rename(fullPath, trashPath)
		if err != nil {
			// Fallback to remove if rename fails
			err = os.RemoveAll(fullPath)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

func handleMkdir(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
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

	if err := os.MkdirAll(fullPath, 0755); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	query := strings.ToLower(r.URL.Query().Get("q"))
	if query == "" {
		http.Error(w, "Query required", http.StatusBadRequest)
		return
	}

	files := make([]FileInfo, 0)

	err := filepath.WalkDir(dataDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		
		// Skip root dir itself
		if path == dataDir {
			return nil
		}

		if strings.Contains(strings.ToLower(d.Name()), query) {
			info, err := d.Info()
			if err != nil {
				return nil // skip file on error
			}
			
			// Calculate relative path from dataDir
			relPath, err := filepath.Rel(dataDir, path)
			if err != nil {
				return nil
			}
			relPath = "/" + filepath.ToSlash(relPath)

			files = append(files, FileInfo{
				Name:  d.Name(),
				IsDir: d.IsDir(),
				Size:  info.Size(),
				Path:  relPath,
			})
		}
		return nil
	})

	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

func handleStar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	reqPath := r.URL.Query().Get("path")
	if reqPath == "" {
		http.Error(w, "Path required", http.StatusBadRequest)
		return
	}
	
	// Normalize path
	relPath := filepath.ToSlash(filepath.Clean(reqPath))
	if relPath == "" || relPath[0] != '/' {
		relPath = "/" + relPath
	}

	starred := loadStarred()
	if starred[relPath] {
		delete(starred, relPath)
	} else {
		starred[relPath] = true
	}
	saveStarred(starred)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

func handleTrash(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	entries, err := os.ReadDir(trashDir)
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
			Path:  "/.trash/" + e.Name(),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

func handleRestore(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	reqPath := r.URL.Query().Get("path")
	if reqPath == "" {
		http.Error(w, "Path required", http.StatusBadRequest)
		return
	}

	fileName := filepath.Base(reqPath)
	trashPath := filepath.Join(trashDir, fileName)
	
	// Determine original name (strip timestamp)
	parts := strings.SplitN(fileName, "_", 2)
	originalName := fileName
	if len(parts) == 2 {
		originalName = parts[1]
	}

	// Restore to root
	restorePath := filepath.Join(dataDir, originalName)

	err := os.Rename(trashPath, restorePath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}
