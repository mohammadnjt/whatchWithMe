package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

const maxUploadBytes = 500 << 20 // 500 MB

// Film is a video file stored on the server (uploaded, or downloaded from a link on request).
// Plain links that rooms play directly are not films and are never stored.
type Film struct {
	ID            string  `json:"id"` // same as Filename
	Filename      string  `json:"filename"`
	Title         string  `json:"title"`
	Size          int64   `json:"size"`
	MimeType      string  `json:"mimeType"`
	UploadedAt    float64 `json:"uploadedAt"` // ms since epoch
	UploadedBy    string  `json:"uploadedBy,omitempty"`
	LastWatchedAt float64 `json:"lastWatchedAt,omitempty"` // last time a room started playing it
	URL           string  `json:"url"`
}

// lastActivity is when the film was last uploaded or watched; auto-deletion counts from it.
func (f *Film) lastActivity() float64 {
	if f.LastWatchedAt > f.UploadedAt {
		return f.LastWatchedAt
	}
	return f.UploadedAt
}

func streamURL(filename string) string { return "/api/video-stream/" + filename }

func (s *Server) filmsPath() string { return filepath.Join(s.dataDir, "films.json") }

func (s *Server) findFilm(filename string) (int, *Film) {
	for i, f := range s.films {
		if f.Filename == filename {
			return i, f
		}
	}
	return -1, nil
}

func (s *Server) filmByURL(u string) *Film {
	for _, f := range s.films {
		if f.URL == u {
			return f
		}
	}
	return nil
}

// upsertFilm adds or replaces a film, keeping its position. Caller holds mu.
func (s *Server) upsertFilm(f *Film) {
	if i, _ := s.findFilm(f.Filename); i >= 0 {
		s.films[i] = f
		return
	}
	s.films = append(s.films, f)
}

func (s *Server) removeFilm(filename string) {
	if i, _ := s.findFilm(filename); i >= 0 {
		s.films = append(s.films[:i], s.films[i+1:]...)
	}
}

// loadFilms reads films.json (migrating the older uploaded_files.json once) and registers
// any file in uploads/ that is not listed. Caller holds mu.
func (s *Server) loadFilms() {
	data, err := os.ReadFile(s.filmsPath())
	switch {
	case err == nil:
		var list []*Film
		if err := json.Unmarshal(data, &list); err != nil {
			logErr.Printf("[Films] Cannot parse films.json: %v", err)
			backupCorrupt(s.filmsPath())
		}
		for _, f := range list {
			if f != nil && f.Filename != "" {
				s.upsertFilm(f)
			}
		}
	case errors.Is(err, os.ErrNotExist):
		s.migrateUploadedFiles()
	default:
		logErr.Printf("[Films] Cannot read films.json: %v", err)
	}

	entries, err := os.ReadDir(s.uploadDir)
	if err != nil {
		return
	}
	added := false
	for _, e := range entries {
		if !e.Type().IsRegular() || strings.Contains(e.Name(), ".tmp-") {
			continue
		}
		if _, f := s.findFilm(e.Name()); f != nil {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		s.films = append(s.films, &Film{
			ID: e.Name(), Filename: e.Name(), Title: e.Name(), Size: info.Size(), MimeType: "video/mp4",
			UploadedAt: float64(info.ModTime().UnixNano()) / 1e6, URL: streamURL(e.Name()),
		})
		added = true
	}
	if added {
		s.saveFilms()
	}
}

// migrateUploadedFiles converts data/uploaded_files.json from earlier versions into films.json.
func (s *Server) migrateUploadedFiles() {
	legacy := filepath.Join(s.dataDir, "uploaded_files.json")
	data, err := os.ReadFile(legacy)
	if err != nil {
		return
	}
	var list []struct {
		Filename     string  `json:"filename"`
		OriginalName string  `json:"originalName"`
		Size         int64   `json:"size"`
		MimeType     string  `json:"mimeType"`
		UploadedAt   float64 `json:"uploadedAt"`
		UploadedBy   string  `json:"uploadedBy"`
	}
	if err := json.Unmarshal(data, &list); err != nil {
		logErr.Printf("[Films] Cannot migrate uploaded_files.json: %v", err)
		return
	}
	for _, f := range list {
		if f.Filename == "" {
			continue
		}
		title := titleFromFilename(f.OriginalName)
		if f.OriginalName == "" {
			title = f.Filename
		}
		s.upsertFilm(&Film{
			ID: f.Filename, Filename: f.Filename, Title: title, Size: f.Size, MimeType: f.MimeType,
			UploadedAt: f.UploadedAt, UploadedBy: f.UploadedBy, URL: streamURL(f.Filename),
		})
	}
	s.saveFilms()
	if err := os.Rename(legacy, legacy+".migrated"); err == nil {
		logInfo.Printf("[Films] Migrated %d entries from uploaded_files.json to films.json", len(list))
	}
}

// saveFilms persists films.json. Caller holds mu.
func (s *Server) saveFilms() {
	list := s.films
	if list == nil {
		list = []*Film{}
	}
	if err := writeJSONFile(s.filmsPath(), list); err != nil {
		logErr.Printf("[Films] Cannot save films.json: %v", err)
	}
}

// touchFilm records that a room started playing videoURL, if it is a stored film. Caller holds mu.
func (s *Server) touchFilm(videoURL string) {
	if f := s.filmByURL(videoURL); f != nil {
		f.LastWatchedAt = float64(nowMs())
		s.saveFilms()
	}
}

// activeVideoURLs lists the videos loaded in any room; they are never auto-deleted. Caller holds mu.
func (s *Server) activeVideoURLs() map[string]bool {
	active := map[string]bool{}
	for _, r := range s.rooms {
		if v, _ := r.Movie["videoUrl"].(string); v != "" {
			active[v] = true
		}
	}
	return active
}

// cleanExpiredFiles deletes films not uploaded or watched within the retention period. Caller holds mu.
func (s *Server) cleanExpiredFiles() (deleted int, freed int64) {
	if s.retentionHours <= 0 {
		return 0, 0
	}
	cutoff := float64(nowMs()) - s.retentionHours*3600*1000
	active := s.activeVideoURLs()
	for _, f := range append([]*Film(nil), s.films...) {
		if active[f.URL] || f.lastActivity() > cutoff {
			continue
		}
		size := f.Size
		if info, err := os.Stat(filepath.Join(s.uploadDir, f.Filename)); err == nil {
			size = info.Size()
		}
		if err := os.Remove(filepath.Join(s.uploadDir, f.Filename)); err != nil && !errors.Is(err, os.ErrNotExist) {
			logErr.Printf("[Films] Cannot delete %s: %v", f.Filename, err)
			continue
		}
		s.removeFilm(f.Filename)
		deleted++
		freed += size
		logInfo.Printf("[Films] Deleted expired film: %s (%s)", f.Title, formatBytes(size))
	}
	if deleted > 0 {
		s.saveFilms()
	}
	return deleted, freed
}

type filmItem struct {
	ID                 string   `json:"id"`
	Filename           string   `json:"filename"`
	Title              string   `json:"title"`
	Size               int64    `json:"size"`
	FormattedSize      string   `json:"formattedSize"`
	UploadedAt         float64  `json:"uploadedAt"`
	UploadedBy         string   `json:"uploadedBy"`
	LastWatchedAt      *float64 `json:"lastWatchedAt"`
	ExpiresAt          *float64 `json:"expiresAt"`
	TimeLeftMs         *float64 `json:"timeLeftMs"`
	FormattedTimeLeft  string   `json:"formattedTimeLeft"`
	URL                string   `json:"url"`
	IsCurrentlyPlaying bool     `json:"isCurrentlyPlaying"`
}

// formatTimeLeft describes the time until auto-deletion, as shown in the admin panel.
func formatTimeLeft(left float64) string {
	if left <= 0 {
		return "منقضی شده (آماده حذف)"
	}
	hours := int64(left / 3600000)
	mins := int64(math.Mod(left, 3600000) / 60000)
	if hours > 0 {
		return fmt.Sprintf("%d ساعت و %d دقیقه", hours, mins)
	}
	return fmt.Sprintf("%d دقیقه", mins)
}

// filmList returns the films that exist on disk, newest first, and their total size.
func (s *Server) filmList() ([]filmItem, int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	active := s.activeVideoURLs()
	var total int64
	items := []filmItem{}
	for _, f := range s.films {
		info, err := os.Stat(filepath.Join(s.uploadDir, f.Filename))
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		total += info.Size()
		item := filmItem{
			ID: f.Filename, Filename: f.Filename, Title: f.Title, Size: info.Size(),
			FormattedSize: formatBytes(info.Size()), UploadedAt: f.UploadedAt, UploadedBy: f.UploadedBy,
			FormattedTimeLeft: "همیشگی (بدون انقضا)", URL: f.URL, IsCurrentlyPlaying: active[f.URL],
		}
		if f.LastWatchedAt > 0 {
			v := f.LastWatchedAt
			item.LastWatchedAt = &v
		}
		if s.retentionHours > 0 {
			expires := f.lastActivity() + s.retentionHours*3600*1000
			left := math.Max(0, expires-float64(nowMs()))
			item.ExpiresAt, item.TimeLeftMs = &expires, &left
			item.FormattedTimeLeft = formatTimeLeft(left)
		}
		items = append(items, item)
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].UploadedAt > items[j].UploadedAt })
	return items, total
}

// GET /api/films: films on the server that any user can start watching.
func (s *Server) handleListFilms(w http.ResponseWriter, r *http.Request) {
	items, _ := s.filmList()
	writeJSON(w, http.StatusOK, items)
}

// GET /api/admin/storage
func (s *Server) handleAdminStorage(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	s.loadFilms()
	retention := s.retentionHours
	s.mu.Unlock()
	items, total := s.filmList()
	writeJSON(w, http.StatusOK, map[string]any{
		"films": items, "totalFiles": len(items), "totalBytes": total, "formattedTotalSize": formatBytes(total),
		"retentionHours": retention, "maxStorageBytes": int64(10 << 30),
	})
}

// POST /api/admin/storage/retention
func (s *Server) handleAdminRetention(w http.ResponseWriter, r *http.Request) {
	hours, ok := readJSON(r)["hours"].(float64)
	if !ok || hours < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "مدت باید عدد مثبت یا صفر باشد."})
		return
	}
	s.mu.Lock()
	s.retentionHours = hours
	deleted, freed := s.cleanExpiredFiles()
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true, "retentionHours": hours, "cleanedFiles": deleted, "freedSize": formatBytes(freed),
	})
}

// POST /api/admin/storage/cleanup
func (s *Server) handleAdminCleanup(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	deleted, freed := s.cleanExpiredFiles()
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true, "deletedCount": deleted, "freedBytes": freed, "formattedFreedSize": formatBytes(freed),
	})
}

// DELETE /api/admin/storage/files/{filename}
func (s *Server) handleAdminDeleteFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("filename")
	if !validFileName(name) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "نام فایل نامعتبر است."})
		return
	}
	s.mu.Lock()
	if err := os.Remove(filepath.Join(s.uploadDir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
		logErr.Printf("[Films] Cannot delete %s: %v", name, err)
	}
	s.removeFilm(name)
	s.saveFilms()
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func titleFromFilename(name string) string {
	if t := strings.TrimSuffix(name, filepath.Ext(name)); t != "" {
		return t
	}
	return name
}

// POST /api/upload (multipart, field "video")
func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+(1<<20))
	mr, err := r.MultipartReader()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "فایلی ارسال نشد."})
		return
	}

	const tooBigMsg = "حجم فایل بیش از ۵۰۰ مگابایت است."
	var film *Film
	savedPath := ""
	fail := func(status int, msg string) {
		if savedPath != "" {
			os.Remove(savedPath)
		}
		writeJSON(w, status, map[string]any{"error": msg})
	}

	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				fail(http.StatusRequestEntityTooLarge, tooBigMsg)
			} else {
				fail(http.StatusBadRequest, "آپلود ناقص ماند.")
			}
			return
		}
		if part.FormName() != "video" || part.FileName() == "" || film != nil {
			part.Close()
			continue
		}

		original := part.FileName()
		filename := fmt.Sprintf("movie-%d-%d%s", nowMs(), rand.IntN(1e9), safeExt(original))
		dest := filepath.Join(s.uploadDir, filename)
		f, err := os.Create(dest)
		if err != nil {
			logErr.Printf("[Upload] Cannot create %s: %v", dest, err)
			fail(http.StatusInternalServerError, "ذخیره فایل روی سرور ناموفق بود.")
			return
		}
		savedPath = dest
		n, err := io.Copy(f, part)
		closeErr := f.Close()
		var tooBig *http.MaxBytesError
		switch {
		case errors.As(err, &tooBig) || n > maxUploadBytes:
			fail(http.StatusRequestEntityTooLarge, tooBigMsg)
			return
		case err != nil:
			fail(http.StatusBadRequest, "آپلود ناقص ماند.")
			return
		case closeErr != nil:
			fail(http.StatusInternalServerError, "ذخیره فایل روی سرور ناموفق بود.")
			return
		}
		mime := part.Header.Get("Content-Type")
		if mime == "" {
			mime = "application/octet-stream"
		}
		film = &Film{
			ID: filename, Filename: filename, Title: titleFromFilename(original), Size: n, MimeType: mime,
			URL: streamURL(filename),
		}
	}

	if film == nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "فایلی ارسال نشد."})
		return
	}
	film.UploadedAt = float64(nowMs())
	film.UploadedBy = s.displayNameOf(sessionOf(r))

	s.mu.Lock()
	s.upsertFilm(film)
	s.saveFilms()
	s.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"url": film.URL, "filename": film.Filename, "title": film.Title, "size": film.Size, "mimeType": film.MimeType,
	})
}

// GET /api/video-stream/{filename} (Range requests supported for seeking)
func (s *Server) handleVideoStream(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("filename")
	if !validFileName(name) {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	f, err := os.Open(filepath.Join(s.uploadDir, name))
	if err != nil {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.Error(w, "File not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "video/mp4")
	http.ServeContent(w, r, name, info.ModTime(), f)
}

// POST /api/storage/remote-fetch: downloads a remote video into the server's films.
func (s *Server) handleRemoteFetch(w http.ResponseWriter, r *http.Request) {
	body := readJSON(r)
	target, ok := body["url"].(string)
	if !ok || target == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "آدرس URL الزامی است."})
		return
	}

	// Keep downloading even if the browser (or a proxy in front of us) gives up waiting.
	ctx := context.WithoutCancel(r.Context())
	resp, finalURL, err := fetchRemote(ctx, target, "")
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "اتصال برای دانلود ناموفق بود: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("سرور مبدا کد %d داد.", resp.StatusCode),
		})
		return
	}

	originalName := "remote-video.mp4"
	if u, err := url.Parse(finalURL); err == nil {
		if base := path.Base(u.Path); base != "." && base != "/" && base != "" {
			originalName = base
		}
	}
	if !strings.Contains(originalName, ".") {
		originalName += ".mp4"
	}
	filename := fmt.Sprintf("remote-%d-%d%s", nowMs(), rand.IntN(1e6), safeExt(originalName))
	dest := filepath.Join(s.uploadDir, filename)

	f, err := os.Create(dest)
	if err != nil {
		logErr.Printf("[Remote-Fetch] Write error: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "ذخیره فایل روی سرور ناموفق بود."})
		return
	}
	n, copyErr := io.Copy(f, resp.Body)
	closeErr := f.Close()
	if copyErr != nil || closeErr != nil {
		os.Remove(dest)
		if copyErr != nil {
			logErr.Printf("[Remote-Fetch] Download interrupted: %v", copyErr)
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": "دانلود نیمه‌کاره قطع شد."})
		} else {
			logErr.Printf("[Remote-Fetch] Write error: %v", closeErr)
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "ذخیره فایل روی سرور ناموفق بود."})
		}
		return
	}

	title := titleFromFilename(originalName)
	if t, ok := body["title"].(string); ok && strings.TrimSpace(t) != "" {
		title = strings.TrimSpace(t)
	}
	mime := resp.Header.Get("Content-Type")
	if mime == "" {
		mime = "video/mp4"
	}
	film := &Film{
		ID: filename, Filename: filename, Title: title, Size: n, MimeType: mime,
		UploadedAt: float64(nowMs()), UploadedBy: s.displayNameOf(sessionOf(r)), URL: streamURL(filename),
	}
	s.mu.Lock()
	s.upsertFilm(film)
	s.saveFilms()
	s.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"success": true, "url": film.URL, "filename": filename, "title": title,
		"size": n, "formattedSize": formatBytes(n),
	})
}
