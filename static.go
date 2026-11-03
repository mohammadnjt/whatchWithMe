package main

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// spaHandler serves the built frontend from dist/, falling back to index.html for
// client-side routes. Unknown /api paths get a 404 instead of the app shell.
func (s *Server) spaHandler() http.Handler {
	files := http.FileServer(http.Dir(s.distDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}
		clean := path.Clean("/" + r.URL.Path)
		if strings.HasPrefix(clean, "/api") {
			http.NotFound(w, r)
			return
		}

		if info, err := os.Stat(filepath.Join(s.distDir, filepath.FromSlash(clean))); err == nil {
			if !info.IsDir() {
				files.ServeHTTP(w, r)
				return
			}
			if _, err := os.Stat(filepath.Join(s.distDir, filepath.FromSlash(clean), "index.html")); err == nil {
				files.ServeHTTP(w, r)
				return
			}
		}

		index := filepath.Join(s.distDir, "index.html")
		f, err := os.Open(index)
		if err != nil {
			http.Error(w, "Frontend is not built yet. Run `npm run build`.", http.StatusServiceUnavailable)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			http.Error(w, "Frontend is not built yet. Run `npm run build`.", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		http.ServeContent(w, r, "index.html", info.ModTime(), f)
	})
}
