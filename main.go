// WatchTogether backend (Go).
//
// Serves the REST API under /api, the WebSocket sync channel (any path with an
// Upgrade header, the frontend uses /ws) and the built frontend from dist/.
//
// It is meant to run under BAS: BAS starts it from the app folder, passes the
// port in PORT and stops it with SIGTERM. Settings that BAS keeps to itself
// (ADMIN_USERNAME, ADMIN_PASSWORD, ...) are read from this folder's own .env.
package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

var (
	logInfo = log.New(os.Stdout, "", 0)
	logErr  = log.New(os.Stderr, "", 0)
)

type Server struct {
	dataDir     string
	uploadDir   string
	subtitleDir string
	distDir     string

	adminUsername string
	adminPassword string
	secret        []byte // signs status tokens of pending users (data/secret.key)

	// authMu guards users and sessions. It may be held while taking mu, never the other way round.
	authMu   sync.Mutex
	users    []*UserRecord
	sessions map[string]*Session

	// mu guards rooms, WebSocket clients, films and subtitles.
	mu             sync.Mutex
	rooms          map[string]*Room
	roomOrder      []string
	clients        map[*Client]struct{}
	films          []*Film
	subtitles      []*SubtitleTrack
	extractJobs    map[string]*extractJob // keyed by video URL
	retentionHours float64

	roomSave roomSaver

	turn turnConfig // ICE settings for voice; resolved once at startup
}

func main() {
	rootDir, err := os.Getwd()
	if err != nil {
		logErr.Fatalf("[Server] Cannot resolve working directory: %v", err)
	}
	loadDotEnv(filepath.Join(rootDir, ".env"))

	s := &Server{
		dataDir:       filepath.Join(rootDir, "data"),
		uploadDir:     filepath.Join(rootDir, "uploads"),
		subtitleDir:   filepath.Join(rootDir, "data", "subtitles"),
		distDir:       filepath.Join(rootDir, "dist"),
		adminUsername: envOr("ADMIN_USERNAME", "admin"),
		adminPassword: envOr("ADMIN_PASSWORD", "admin123"),
		sessions:      map[string]*Session{},
		rooms:         map[string]*Room{},
		clients:       map[*Client]struct{}{},
		extractJobs:   map[string]*extractJob{},
	}
	if v, err := strconv.ParseFloat(strings.TrimSpace(os.Getenv("FILE_RETENTION_HOURS")), 64); err == nil && v > 0 {
		s.retentionHours = v
	}
	if s.adminPassword == "admin123" || s.adminPassword == "admin" {
		logErr.Printf("[Auth] WARNING: ADMIN_PASSWORD is not set in .env; the default admin password is in use.")
	}

	for _, dir := range []string{s.dataDir, s.uploadDir, s.subtitleDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			logErr.Fatalf("[Server] Cannot create %s: %v", dir, err)
		}
	}

	if err := s.loadSecret(); err != nil {
		logErr.Fatalf("[Auth] Cannot create data/secret.key: %v", err)
	}
	s.loadUsers()
	s.mu.Lock()
	s.loadFilms()
	s.loadSubtitles()
	s.loadRooms()
	s.mu.Unlock()

	// Voice needs ICE servers; the relay is optional and logs its own failures.
	s.turn = s.loadTURNConfig()
	if relay := s.startTURN(s.turn); relay != nil {
		defer relay.Close()
	}
	if !ffmpegAvailable() {
		logInfo.Printf("[Subs] ffmpeg/ffprobe not found: subtitles muxed into a video cannot be extracted. " +
			"Subtitle files can still be uploaded or fetched by link.")
	}

	if _, err := os.Stat(filepath.Join(s.distDir, "index.html")); err != nil {
		logErr.Printf("[Server] WARNING: %s is missing. Build the frontend with `npm run build`.", filepath.Join(s.distDir, "index.html"))
	}

	port := 3000
	if p, err := strconv.Atoi(strings.TrimSpace(os.Getenv("PORT"))); err == nil && p > 0 {
		port = p
	}
	addr := net.JoinHostPort(envOr("HOST", "0.0.0.0"), strconv.Itoa(port))

	srv := &http.Server{
		Addr:              addr,
		Handler:           s.routes(),
		ReadHeaderTimeout: 20 * time.Second,
		// No read/write timeouts: uploads and video streams can legitimately run for a long time.
	}

	go s.housekeeping()

	shutdownDone := make(chan struct{})
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
		<-sig
		logInfo.Printf("[Server] Shutting down...")
		s.closeAllClients()
		s.saveRoomsNow()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			srv.Close()
		}
		close(shutdownDone)
	}()

	logInfo.Printf("WatchTogether server (Go) running on http://%s", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logErr.Fatalf("[Server] %v", err)
	}
	<-shutdownDone
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	// Auth
	mux.HandleFunc("POST /api/auth/login-or-register", s.handleLogin)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("GET /api/auth/me", s.handleMe)
	mux.HandleFunc("GET /api/auth/status", s.handleAuthStatus)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)

	// Admin: users
	mux.HandleFunc("GET /api/admin/users", s.requireAdmin(s.handleAdminListUsers))
	mux.HandleFunc("POST /api/admin/users/{id}/approve", s.requireAdmin(s.handleAdminApprove))
	mux.HandleFunc("POST /api/admin/users/{id}/reject", s.requireAdmin(s.handleAdminReject))
	mux.HandleFunc("DELETE /api/admin/users/{id}", s.requireAdmin(s.handleAdminDeleteUser))

	// Admin: storage
	mux.HandleFunc("GET /api/admin/storage", s.requireAdmin(s.handleAdminStorage))
	mux.HandleFunc("POST /api/admin/storage/retention", s.requireAdmin(s.handleAdminRetention))
	mux.HandleFunc("POST /api/admin/storage/cleanup", s.requireAdmin(s.handleAdminCleanup))
	mux.HandleFunc("DELETE /api/admin/storage/files/{filename}", s.requireAdmin(s.handleAdminDeleteFile))

	// Films & videos (logged-in users only; browsers authenticate media requests with the session cookie)
	mux.HandleFunc("GET /api/films", s.requireUser(s.handleListFilms))
	mux.HandleFunc("POST /api/upload", s.requireUser(s.handleUpload))
	mux.HandleFunc("GET /api/video-stream/{filename}", s.requireUser(s.handleVideoStream))
	mux.HandleFunc("GET /api/proxy-stream", s.requireUser(s.handleProxyStream))
	mux.HandleFunc("POST /api/check-url", s.requireUser(s.handleCheckURL))
	mux.HandleFunc("POST /api/storage/remote-fetch", s.requireUser(s.handleRemoteFetch))

	// Subtitles. The .vtt files themselves are fetched by the <track> element,
	// which sends no Authorization header, so they rely on the session cookie.
	mux.HandleFunc("GET /api/subtitles", s.requireUser(s.handleListSubtitles))
	mux.HandleFunc("GET /api/subtitles/file/{filename}", s.requireUser(s.handleSubtitleFile))
	mux.HandleFunc("POST /api/subtitles/upload", s.requireUser(s.handleUploadSubtitle))
	mux.HandleFunc("POST /api/subtitles/from-url", s.requireUser(s.handleSubtitleFromURL))
	mux.HandleFunc("POST /api/subtitles/extract", s.requireUser(s.handleExtractSubtitles))
	mux.HandleFunc("DELETE /api/subtitles/{id}", s.requireUser(s.handleDeleteSubtitle))

	// Voice chat: ICE servers for the WebRTC mesh (signalling runs over the WebSocket).
	mux.HandleFunc("GET /api/rtc/ice", s.requireUser(s.handleICEConfig))

	// Rooms
	mux.HandleFunc("GET /api/rooms", s.requireUser(s.handleListRooms))
	mux.HandleFunc("POST /api/rooms", s.requireUser(s.handleCreateRoom))

	// Frontend (SPA)
	mux.Handle("/", s.spaHandler())

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Like the original ws server, a WebSocket upgrade on any path joins the sync channel.
		if isWebSocketUpgrade(r) {
			s.serveWS(w, r)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

// housekeeping sweeps expired uploads every 30 minutes and drops expired sessions.
func (s *Server) housekeeping() {
	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		s.cleanExpiredFiles()
		s.mu.Unlock()
		s.pruneSessions()
	}
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}
