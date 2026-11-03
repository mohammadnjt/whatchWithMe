// Subtitle support.
//
// Browsers only render subtitles handed to them as a WebVTT <track>; the text
// tracks muxed into a Matroska file are ignored by the media pipeline entirely,
// which is why a "SoftSub" .mkv plays with no subtitles however the player is
// configured. Everything here exists to turn whatever the user has into WebVTT
// served from this origin:
//
//   - a .srt / .ass / .ssa / .vtt file they upload, or a link to one
//   - a text track muxed into the video, pulled out with ffmpeg when available
//
// Persian subtitle files in the wild are frequently Windows-1256 rather than
// UTF-8, so decoding is sniffed rather than assumed.
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/text/encoding/charmap"
)

const (
	maxSubtitleBytes = 8 << 20 // a feature-length subtitle file is a few hundred KB
	// Pulling a muxed track means reading the whole video: its subtitle packets
	// are interleaved from start to finish. Over the network that is slow.
	extractTimeout = 45 * time.Minute
)

// SubtitleTrack is one WebVTT file belonging to one video.
type SubtitleTrack struct {
	ID        string  `json:"id"`
	VideoURL  string  `json:"videoUrl"`
	Filename  string  `json:"filename"` // stored under <data>/subtitles
	Label     string  `json:"label"`    // shown in the player menu
	Lang      string  `json:"lang"`     // BCP 47 tag for the <track> element
	Source    string  `json:"source"`   // upload | url | embedded
	Size      int64   `json:"size"`
	CreatedAt float64 `json:"createdAt"`
}

func subtitleURL(filename string) string { return "/api/subtitles/file/" + filename }

func (s *Server) subtitlesPath() string { return filepath.Join(s.dataDir, "subtitles.json") }

// extractJob tracks one ffmpeg run so the UI can poll it.
type extractJob struct {
	Status    string   `json:"status"` // running | done | error
	Message   string   `json:"message,omitempty"`
	Found     int      `json:"found"`
	Added     int      `json:"added"`
	Skipped   []string `json:"skipped,omitempty"`
	StartedAt float64  `json:"startedAt"`
}

func (s *Server) loadSubtitles() {
	path := s.subtitlesPath()
	b, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			logErr.Printf("[Subs] Cannot read %s: %v", path, err)
		}
		return
	}
	var tracks []*SubtitleTrack
	if err := json.Unmarshal(b, &tracks); err != nil {
		logErr.Printf("[Subs] %s is corrupt; starting with no subtitles: %v", path, err)
		backupCorrupt(path)
		return
	}
	// Drop entries whose file disappeared, so the player is never handed a 404 track.
	for _, t := range tracks {
		if t == nil || t.Filename == "" {
			continue
		}
		if _, err := os.Stat(filepath.Join(s.subtitleDir, t.Filename)); err != nil {
			continue
		}
		s.subtitles = append(s.subtitles, t)
	}
}

// saveSubtitles persists the index. Caller holds mu.
func (s *Server) saveSubtitles() {
	if err := writeJSONFile(s.subtitlesPath(), s.subtitles); err != nil {
		logErr.Printf("[Subs] Cannot save %s: %v", s.subtitlesPath(), err)
	}
}

// tracksFor returns the subtitles of one video, newest last. Caller holds mu.
func (s *Server) tracksFor(videoURL string) []*SubtitleTrack {
	out := []*SubtitleTrack{}
	for _, t := range s.subtitles {
		if t.VideoURL == videoURL {
			out = append(out, t)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	return out
}

// addTrack stores a converted WebVTT body and indexes it. Caller must not hold mu.
func (s *Server) addTrack(videoURL, label, lang, source string, vtt []byte) (*SubtitleTrack, error) {
	filename := fmt.Sprintf("sub-%d-%d.vtt", nowMs(), rand.IntN(1e9))
	if err := os.WriteFile(filepath.Join(s.subtitleDir, filename), vtt, 0o644); err != nil {
		return nil, err
	}
	t := &SubtitleTrack{
		ID: filename, VideoURL: videoURL, Filename: filename,
		Label: label, Lang: lang, Source: source,
		Size: int64(len(vtt)), CreatedAt: float64(nowMs()),
	}
	s.mu.Lock()
	s.subtitles = append(s.subtitles, t)
	s.saveSubtitles()
	s.mu.Unlock()
	return t, nil
}

// ---------------------------------------------------------------------------
// Decoding and conversion
// ---------------------------------------------------------------------------

// decodeSubtitleText turns raw subtitle bytes into UTF-8.
//
// A file that is already valid UTF-8 is kept as-is. Anything else is treated as
// Windows-1256, the encoding Persian subtitle files are usually distributed in;
// guessing it is far better than rendering a screen of replacement characters.
func decodeSubtitleText(b []byte) string {
	b = bytes.TrimPrefix(b, []byte{0xEF, 0xBB, 0xBF}) // UTF-8 BOM

	// UTF-16, identified by its BOM, shows up occasionally.
	if len(b) >= 2 {
		if b[0] == 0xFF && b[1] == 0xFE {
			return decodeUTF16(b[2:], false)
		}
		if b[0] == 0xFE && b[1] == 0xFF {
			return decodeUTF16(b[2:], true)
		}
	}

	if utf8.Valid(b) {
		return string(b)
	}
	if decoded, err := charmap.Windows1256.NewDecoder().Bytes(b); err == nil {
		return string(decoded)
	}
	return string(b)
}

func decodeUTF16(b []byte, bigEndian bool) string {
	var sb strings.Builder
	for i := 0; i+1 < len(b); i += 2 {
		var u uint16
		if bigEndian {
			u = uint16(b[i])<<8 | uint16(b[i+1])
		} else {
			u = uint16(b[i+1])<<8 | uint16(b[i])
		}
		sb.WriteRune(rune(u))
	}
	return sb.String()
}

var (
	// SRT and VTT cue timings: "00:00:01,000 --> 00:00:04,000" with either
	// separator, optionally without the hour field.
	cueTimingRe = regexp.MustCompile(`^(\d{1,2}:)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d{1,2}:)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})(.*)$`)
	// ASS override blocks: {\pos(0,0)}, {\an8}, ...
	assOverrideRe = regexp.MustCompile(`\{[^}]*\}`)
)

// toWebVTT converts an uploaded or downloaded subtitle into WebVTT.
func toWebVTT(raw []byte, filename string) ([]byte, error) {
	text := decodeSubtitleText(raw)
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")

	ext := strings.ToLower(filepath.Ext(filename))
	switch {
	case ext == ".ass" || ext == ".ssa" || strings.Contains(text, "[Script Info]"):
		return assToWebVTT(text)
	case ext == ".vtt" || strings.HasPrefix(strings.TrimSpace(text), "WEBVTT"):
		return normalizeWebVTT(text)
	default:
		return srtToWebVTT(text)
	}
}

// normalizeWebVTT passes an existing WebVTT through, ensuring the signature is present.
func normalizeWebVTT(text string) ([]byte, error) {
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, "WEBVTT") {
		text = "WEBVTT\n\n" + text
	}
	if strings.TrimSpace(strings.TrimPrefix(text, "WEBVTT")) == "" {
		return nil, errors.New("فایل زیرنویس خالی است.")
	}
	return []byte(text + "\n"), nil
}

// srtToWebVTT rewrites SubRip cues as WebVTT. The two formats differ only in the
// header, the decimal separator of the timings and SRT's leading cue numbers.
func srtToWebVTT(text string) ([]byte, error) {
	var out bytes.Buffer
	out.WriteString("WEBVTT\n\n")

	cues := 0
	sc := bufio.NewScanner(strings.NewReader(text))
	sc.Buffer(make([]byte, 0, 64*1024), maxSubtitleBytes)

	pendingBlank := false
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), " \t")

		if m := cueTimingRe.FindStringSubmatch(line); m != nil {
			if cues > 0 {
				out.WriteString("\n")
			}
			out.WriteString(formatCueTiming(m))
			out.WriteString("\n")
			cues++
			pendingBlank = false
			continue
		}

		if strings.TrimSpace(line) == "" {
			pendingBlank = true
			continue
		}
		// A bare number directly before a timing line is an SRT cue index; WebVTT
		// does not need it and a stray number would be read as cue text.
		if cues >= 0 && isAllDigits(strings.TrimSpace(line)) && pendingBlank {
			continue
		}
		if cues == 0 {
			continue // preamble before the first cue
		}
		if pendingBlank {
			pendingBlank = false
		}
		out.WriteString(line)
		out.WriteString("\n")
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("خواندن فایل زیرنویس ناموفق بود: %w", err)
	}
	if cues == 0 {
		return nil, errors.New("در این فایل هیچ زیرنویسی پیدا نشد (فرمت ناشناخته است).")
	}
	return out.Bytes(), nil
}

// formatCueTiming renders a cueTimingRe match as a WebVTT timing line.
func formatCueTiming(m []string) string {
	pad := func(hour, min, sec, milli string) string {
		h := strings.TrimSuffix(hour, ":")
		if h == "" {
			h = "0"
		}
		hi, _ := strconv.Atoi(h)
		mi, _ := strconv.Atoi(min)
		si, _ := strconv.Atoi(sec)
		// WebVTT wants exactly three fractional digits; SRT sometimes has fewer.
		for len(milli) < 3 {
			milli += "0"
		}
		return fmt.Sprintf("%02d:%02d:%02d.%s", hi, mi, si, milli[:3])
	}
	line := pad(m[1], m[2], m[3], m[4]) + " --> " + pad(m[5], m[6], m[7], m[8])
	// Keep cue settings (position/alignment) when the source carried them.
	if settings := strings.TrimSpace(m[9]); settings != "" {
		line += " " + settings
	}
	return line
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// assToWebVTT extracts the dialogue of an Advanced SubStation file. Styling,
// positioning and karaoke effects are dropped: only the spoken text survives.
func assToWebVTT(text string) ([]byte, error) {
	var out bytes.Buffer
	out.WriteString("WEBVTT\n\n")

	startIdx, endIdx, textIdx, fields := 1, 2, 9, 10
	cues := 0

	for _, line := range strings.Split(text, "\n") {
		trimmed := strings.TrimSpace(line)

		if strings.HasPrefix(trimmed, "Format:") && textIdx == 9 {
			// The Events section declares its own column order.
			cols := strings.Split(strings.TrimPrefix(trimmed, "Format:"), ",")
			for i, c := range cols {
				switch strings.ToLower(strings.TrimSpace(c)) {
				case "start":
					startIdx = i
				case "end":
					endIdx = i
				case "text":
					textIdx = i
				}
			}
			fields = len(cols)
			continue
		}

		if !strings.HasPrefix(trimmed, "Dialogue:") {
			continue
		}
		// Text is the last column and may itself contain commas, so split only
		// as many times as there are columns.
		parts := strings.SplitN(strings.TrimPrefix(trimmed, "Dialogue:"), ",", fields)
		if len(parts) <= textIdx || len(parts) <= endIdx {
			continue
		}

		start, ok1 := assTime(parts[startIdx])
		end, ok2 := assTime(parts[endIdx])
		if !ok1 || !ok2 {
			continue
		}

		body := assOverrideRe.ReplaceAllString(parts[textIdx], "")
		body = strings.ReplaceAll(body, `\N`, "\n")
		body = strings.ReplaceAll(body, `\n`, "\n")
		body = strings.ReplaceAll(body, `\h`, " ")
		body = strings.TrimSpace(body)
		if body == "" {
			continue
		}

		if cues > 0 {
			out.WriteString("\n")
		}
		fmt.Fprintf(&out, "%s --> %s\n%s\n", start, end, body)
		cues++
	}

	if cues == 0 {
		return nil, errors.New("در این فایل هیچ دیالوگی پیدا نشد.")
	}
	return out.Bytes(), nil
}

// assTime converts "H:MM:SS.cc" (centiseconds) to "HH:MM:SS.mmm".
func assTime(v string) (string, bool) {
	parts := strings.Split(strings.TrimSpace(v), ":")
	if len(parts) != 3 {
		return "", false
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	secParts := strings.SplitN(parts[2], ".", 2)
	sec, err3 := strconv.Atoi(secParts[0])
	if err1 != nil || err2 != nil || err3 != nil {
		return "", false
	}
	milli := 0
	if len(secParts) == 2 {
		frac := secParts[1]
		for len(frac) < 3 {
			frac += "0"
		}
		milli, _ = strconv.Atoi(frac[:3])
	}
	return fmt.Sprintf("%02d:%02d:%02d.%03d", h, m, sec, milli), true
}

// ---------------------------------------------------------------------------
// Language naming
// ---------------------------------------------------------------------------

// iso639 maps the three-letter codes ffprobe reports onto the two-letter tags
// the <track> element expects.
var iso639 = map[string]string{
	"per": "fa", "fas": "fa", "fa": "fa",
	"eng": "en", "en": "en",
	"ara": "ar", "ar": "ar",
	"tur": "tr", "tr": "tr",
	"fre": "fr", "fra": "fr", "fr": "fr",
	"ger": "de", "deu": "de", "de": "de",
	"spa": "es", "es": "es",
	"kur": "ku", "ku": "ku",
	"aze": "az", "az": "az",
}

var langNames = map[string]string{
	"fa": "فارسی", "en": "English", "ar": "العربية", "tr": "Türkçe",
	"fr": "Français", "de": "Deutsch", "es": "Español", "ku": "کوردی", "az": "Azərbaycan",
}

// normalizeLang maps a subtitle language code to a BCP 47 tag, "" when unknown.
func normalizeLang(code string) string {
	code = strings.ToLower(strings.TrimSpace(code))
	if code == "" || code == "und" {
		return ""
	}
	if tag, ok := iso639[code]; ok {
		return tag
	}
	if len(code) >= 2 {
		return code[:2]
	}
	return ""
}

func langLabel(lang string) string {
	if name, ok := langNames[lang]; ok {
		return name
	}
	if lang != "" {
		return strings.ToUpper(lang)
	}
	return "زیرنویس"
}

// looksPersian reports whether cue text is mostly Perso-Arabic script. It names a
// track whose language tag is missing, which is common in scene releases.
func looksPersian(vtt []byte) bool {
	persian, latin := 0, 0
	for _, r := range string(vtt) {
		switch {
		case r >= 0x0600 && r <= 0x06FF, r == 0x200C, r >= 0xFB50 && r <= 0xFEFF:
			persian++
		case (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'):
			latin++
		}
	}
	return persian > 40 && persian > latin
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

// ffmpegAvailable reports whether muxed tracks can be extracted at all.
func ffmpegAvailable() bool {
	_, errF := exec.LookPath("ffmpeg")
	_, errP := exec.LookPath("ffprobe")
	return errF == nil && errP == nil
}

type subtitleItem struct {
	ID       string  `json:"id"`
	Label    string  `json:"label"`
	Lang     string  `json:"lang"`
	Source   string  `json:"source"`
	URL      string  `json:"url"`
	Size     int64   `json:"size"`
	Uploaded float64 `json:"uploadedAt"`
}

// GET /api/subtitles?videoUrl=...
func (s *Server) handleListSubtitles(w http.ResponseWriter, r *http.Request) {
	videoURL := r.URL.Query().Get("videoUrl")
	if videoURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "آدرس ویدیو مشخص نشده است."})
		return
	}

	s.mu.Lock()
	tracks := s.tracksFor(videoURL)
	job := s.extractJobs[videoURL]
	s.mu.Unlock()

	items := make([]subtitleItem, 0, len(tracks))
	for _, t := range tracks {
		items = append(items, subtitleItem{
			ID: t.ID, Label: t.Label, Lang: t.Lang, Source: t.Source,
			URL: subtitleURL(t.Filename), Size: t.Size, Uploaded: t.CreatedAt,
		})
	}

	out := map[string]any{"tracks": items, "canExtract": ffmpegAvailable()}
	if job != nil {
		out["extraction"] = job
	}
	writeJSON(w, http.StatusOK, out)
}

// GET /api/subtitles/file/{filename}
func (s *Server) handleSubtitleFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("filename")
	if !validFileName(name) || !strings.HasSuffix(name, ".vtt") {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	f, err := os.Open(filepath.Join(s.subtitleDir, name))
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
	// The player may load a track while the video streams from another origin.
	w.Header().Set("Access-Control-Allow-Origin", "*")
	http.ServeContent(w, r, name, info.ModTime(), f)
}

// POST /api/subtitles/upload (multipart: file, videoUrl, label, lang)
func (s *Server) handleUploadSubtitle(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxSubtitleBytes+(1<<20))
	if err := r.ParseMultipartForm(maxSubtitleBytes); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "فایل زیرنویس ارسال نشد یا حجمش زیاد است."})
		return
	}
	videoURL := strings.TrimSpace(r.FormValue("videoUrl"))
	if videoURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "آدرس ویدیو مشخص نشده است."})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "فایل زیرنویس ارسال نشد."})
		return
	}
	defer file.Close()

	raw, err := io.ReadAll(io.LimitReader(file, maxSubtitleBytes+1))
	if err != nil || len(raw) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "خواندن فایل زیرنویس ناموفق بود."})
		return
	}
	if len(raw) > maxSubtitleBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "حجم فایل زیرنویس بیش از ۸ مگابایت است."})
		return
	}

	vtt, err := toWebVTT(raw, header.Filename)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}

	lang := normalizeLang(r.FormValue("lang"))
	if lang == "" {
		if looksPersian(vtt) {
			lang = "fa"
		} else {
			lang = "en"
		}
	}
	label := strings.TrimSpace(r.FormValue("label"))
	if label == "" {
		label = langLabel(lang)
	}

	t, err := s.addTrack(videoURL, label, lang, "upload", vtt)
	if err != nil {
		logErr.Printf("[Subs] Cannot store an uploaded subtitle: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "ذخیره زیرنویس روی سرور ناموفق بود."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"track": subtitleItem{ID: t.ID, Label: t.Label, Lang: t.Lang, Source: t.Source,
			URL: subtitleURL(t.Filename), Size: t.Size, Uploaded: t.CreatedAt},
	})
}

// POST /api/subtitles/from-url {url, videoUrl, label, lang}
func (s *Server) handleSubtitleFromURL(w http.ResponseWriter, r *http.Request) {
	body := readJSON(r)
	target := strings.TrimSpace(jsString(body["url"]))
	videoURL := strings.TrimSpace(jsString(body["videoUrl"]))
	if target == "" || videoURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "آدرس زیرنویس و آدرس ویدیو هر دو الزامی هستند."})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	resp, finalURL, err := fetchRemote(ctx, target, "")
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "دریافت فایل زیرنویس ناموفق بود: " + err.Error()})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		writeJSON(w, resp.StatusCode, map[string]any{
			"error": fmt.Sprintf("سرور زیرنویس خطای %d داد (%s).", resp.StatusCode, statusText(resp)),
		})
		return
	}

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxSubtitleBytes+1))
	if err != nil || len(raw) == 0 {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "خواندن فایل زیرنویس از سرور مبدا ناموفق بود."})
		return
	}
	if len(raw) > maxSubtitleBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "حجم فایل زیرنویس بیش از ۸ مگابایت است."})
		return
	}

	vtt, err := toWebVTT(raw, finalURL)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}

	lang := normalizeLang(jsString(body["lang"]))
	if lang == "" {
		if looksPersian(vtt) {
			lang = "fa"
		} else {
			lang = "en"
		}
	}
	label := strings.TrimSpace(jsString(body["label"]))
	if label == "" {
		label = langLabel(lang)
	}

	t, err := s.addTrack(videoURL, label, lang, "url", vtt)
	if err != nil {
		logErr.Printf("[Subs] Cannot store a downloaded subtitle: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "ذخیره زیرنویس روی سرور ناموفق بود."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"track": subtitleItem{ID: t.ID, Label: t.Label, Lang: t.Lang, Source: t.Source,
			URL: subtitleURL(t.Filename), Size: t.Size, Uploaded: t.CreatedAt},
	})
}

// DELETE /api/subtitles/{id}
func (s *Server) handleDeleteSubtitle(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validFileName(id) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "شناسه زیرنویس معتبر نیست."})
		return
	}

	s.mu.Lock()
	var removed *SubtitleTrack
	kept := s.subtitles[:0]
	for _, t := range s.subtitles {
		if t.ID == id {
			removed = t
			continue
		}
		kept = append(kept, t)
	}
	if removed != nil {
		s.subtitles = kept
		s.saveSubtitles()
	}
	s.mu.Unlock()

	if removed == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "این زیرنویس پیدا نشد."})
		return
	}
	if err := os.Remove(filepath.Join(s.subtitleDir, removed.Filename)); err != nil && !errors.Is(err, os.ErrNotExist) {
		logErr.Printf("[Subs] Cannot delete %s: %v", removed.Filename, err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// ---------------------------------------------------------------------------
// Pulling muxed tracks out with ffmpeg
// ---------------------------------------------------------------------------

// ffprobeStream is the part of ffprobe's JSON we care about.
type ffprobeStream struct {
	Index     int    `json:"index"`
	CodecName string `json:"codec_name"`
	CodecType string `json:"codec_type"`
	Tags      struct {
		Language string `json:"language"`
		Title    string `json:"title"`
	} `json:"tags"`
	Disposition struct {
		Forced int `json:"forced"`
	} `json:"disposition"`
}

// imageSubtitleCodecs are bitmap formats. WebVTT is text, so converting them
// would need OCR; they are reported as skipped instead.
var imageSubtitleCodecs = map[string]bool{
	"hdmv_pgs_subtitle": true,
	"dvd_subtitle":      true,
	"dvb_subtitle":      true,
	"xsub":              true,
}

// resolveMediaInput turns a video URL from a room into something ffmpeg can open:
// a local path for an uploaded film, the URL itself for a remote link.
func (s *Server) resolveMediaInput(videoURL string) (string, error) {
	switch {
	case strings.HasPrefix(videoURL, "/api/video-stream/"):
		name := strings.TrimPrefix(videoURL, "/api/video-stream/")
		if !validFileName(name) {
			return "", errors.New("آدرس ویدیو معتبر نیست.")
		}
		path := filepath.Join(s.uploadDir, name)
		if _, err := os.Stat(path); err != nil {
			return "", errors.New("فایل ویدیو روی سرور پیدا نشد.")
		}
		return path, nil

	case strings.HasPrefix(videoURL, "/api/proxy-stream"):
		// A proxy link wraps the real address in its url query parameter; ffmpeg
		// should fetch that directly rather than loop back through this server.
		parsed, err := url.Parse(videoURL)
		if err != nil {
			return "", errors.New("آدرس ویدیو معتبر نیست.")
		}
		target := parsed.Query().Get("url")
		if target == "" {
			return "", errors.New("آدرس ویدیو معتبر نیست.")
		}
		return target, nil

	case strings.HasPrefix(videoURL, "http://"), strings.HasPrefix(videoURL, "https://"):
		return videoURL, nil
	}
	return "", errors.New("برای این ویدیو امکان استخراج زیرنویس وجود ندارد.")
}

// probeMediaReachable checks that the server itself can read a remote video
// before ffmpeg is launched at it.
//
// This matters because extraction runs here, not in the viewer's browser, and
// the two do not necessarily have the same access. Download hosts routinely
// serve media only to addresses from their own country or ISP and answer
// everyone else with 403 or 503 — including a server that the viewer's own
// browser can stream the same file from perfectly well. Probing first turns a
// late and cryptic ffmpeg error into an immediate explanation.
func probeMediaReachable(ctx context.Context, input string) error {
	if !strings.HasPrefix(input, "http://") && !strings.HasPrefix(input, "https://") {
		return nil // a local file; ffmpeg will report any problem itself
	}

	resp, _, err := fetchRemote(ctx, input, "bytes=0-1023")
	if err != nil {
		return fmt.Errorf("سرور نمی‌تواند به این ویدیو وصل شود: %w", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))

	switch {
	case resp.StatusCode == http.StatusForbidden, resp.StatusCode == http.StatusServiceUnavailable:
		return errors.New("سرور میزبانِ این ویدیو به سرور ما اجازه دانلود نمی‌دهد " +
			"(خطای " + strconv.Itoa(resp.StatusCode) + " — معمولاً محدودیت کشور یا IP). " +
			"مرورگر شما فایل را پخش می‌کند، ولی استخراج زیرنویس روی سرور انجام می‌شود و از اینجا دسترسی نیست. " +
			"فایل زیرنویس را دستی اضافه کنید.")
	case resp.StatusCode >= 400:
		return fmt.Errorf("سرور میزبان خطای %d داد (%s)", resp.StatusCode, statusText(resp))
	}

	// Some hosts answer a blocked request with 200 and an HTML notice.
	if ct := resp.Header.Get("Content-Type"); strings.HasPrefix(ct, "text/html") {
		return errors.New("سرور میزبان به جای ویدیو یک صفحه HTML برگرداند " +
			"(معمولاً صفحه محدودیت دسترسی). فایل زیرنویس را دستی اضافه کنید.")
	}
	return nil
}

// POST /api/subtitles/extract {videoUrl}
func (s *Server) handleExtractSubtitles(w http.ResponseWriter, r *http.Request) {
	videoURL := strings.TrimSpace(jsString(readJSON(r)["videoUrl"]))
	if videoURL == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "آدرس ویدیو مشخص نشده است."})
		return
	}
	if !ffmpegAvailable() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "ffmpeg روی سرور نصب نیست؛ استخراج زیرنویس از ویدیو ممکن نیست.",
		})
		return
	}
	input, err := s.resolveMediaInput(videoURL)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}

	// Fail fast and with a reason the user can act on, rather than starting a
	// long ffmpeg run that will die on an error page.
	probeCtx, cancelProbe := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancelProbe()
	if err := probeMediaReachable(probeCtx, input); err != nil {
		// Record it as the job outcome too, so the reason stays visible in the
		// subtitle menu and not only in the toast that triggered it.
		s.mu.Lock()
		s.extractJobs[videoURL] = &extractJob{
			Status: "error", Message: err.Error(), StartedAt: float64(nowMs()),
		}
		s.mu.Unlock()
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	s.mu.Lock()
	if job := s.extractJobs[videoURL]; job != nil && job.Status == "running" {
		s.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"extraction": job, "alreadyRunning": true})
		return
	}
	job := &extractJob{Status: "running", StartedAt: float64(nowMs())}
	s.extractJobs[videoURL] = job
	s.mu.Unlock()

	// Reading a whole remote video takes minutes, so the request returns at once
	// and the UI polls GET /api/subtitles for progress.
	go s.runExtraction(videoURL, input)

	writeJSON(w, http.StatusAccepted, map[string]any{"extraction": job})
}

// runExtraction probes the video and converts each text track it finds.
func (s *Server) runExtraction(videoURL, input string) {
	defer func() {
		if rec := recover(); rec != nil {
			s.finishExtraction(videoURL, func(j *extractJob) {
				j.Status, j.Message = "error", "خطای غیرمنتظره در استخراج زیرنویس."
			})
			logErr.Printf("[Subs] Extraction panic for %s: %v", videoURL, rec)
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), extractTimeout)
	defer cancel()

	streams, err := probeSubtitleStreams(ctx, input)
	if err != nil {
		s.finishExtraction(videoURL, func(j *extractJob) {
			j.Status, j.Message = "error", "بررسی ویدیو ناموفق بود: "+err.Error()
		})
		return
	}
	if len(streams) == 0 {
		s.finishExtraction(videoURL, func(j *extractJob) {
			j.Status = "done"
			j.Message = "این ویدیو هیچ زیرنویس تویی ندارد. می‌توانید فایل زیرنویس را دستی اضافه کنید."
		})
		return
	}

	s.mu.Lock()
	if j := s.extractJobs[videoURL]; j != nil {
		j.Found = len(streams)
	}
	s.mu.Unlock()

	added := 0
	var skipped []string
	// -map 0:s:N counts subtitle streams, not absolute stream indices.
	for n, st := range streams {
		if imageSubtitleCodecs[st.CodecName] {
			skipped = append(skipped, fmt.Sprintf("%s (تصویری، قابل تبدیل نیست)", subtitleStreamName(st, n)))
			continue
		}
		vtt, err := extractSubtitleStream(ctx, input, n)
		if err != nil {
			logErr.Printf("[Subs] Cannot extract stream s:%d of %s: %v", n, videoURL, err)
			skipped = append(skipped, subtitleStreamName(st, n))
			continue
		}
		if len(bytes.TrimSpace(bytes.TrimPrefix(vtt, []byte("WEBVTT")))) == 0 {
			skipped = append(skipped, fmt.Sprintf("%s (خالی)", subtitleStreamName(st, n)))
			continue
		}

		lang := normalizeLang(st.Tags.Language)
		if lang == "" && looksPersian(vtt) {
			lang = "fa"
		}
		label := strings.TrimSpace(st.Tags.Title)
		if label == "" {
			label = langLabel(lang)
		}
		if st.Disposition.Forced == 1 {
			label += " (Forced)"
		}

		if _, err := s.addTrack(videoURL, label, lang, "embedded", vtt); err != nil {
			logErr.Printf("[Subs] Cannot store extracted subtitle: %v", err)
			skipped = append(skipped, subtitleStreamName(st, n))
			continue
		}
		added++
	}

	s.finishExtraction(videoURL, func(j *extractJob) {
		j.Status, j.Added, j.Skipped = "done", added, skipped
		switch {
		case added > 0:
			j.Message = fmt.Sprintf("%d زیرنویس از ویدیو استخراج شد.", added)
		case len(skipped) > 0:
			j.Message = "زیرنویس‌های این ویدیو قابل تبدیل نبودند."
		default:
			j.Message = "زیرنویسی استخراج نشد."
		}
	})
}

func subtitleStreamName(st ffprobeStream, n int) string {
	if t := strings.TrimSpace(st.Tags.Title); t != "" {
		return t
	}
	if lang := normalizeLang(st.Tags.Language); lang != "" {
		return langLabel(lang)
	}
	return fmt.Sprintf("ترک %d", n+1)
}

// finishExtraction mutates the job record under the lock.
func (s *Server) finishExtraction(videoURL string, apply func(*extractJob)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if j := s.extractJobs[videoURL]; j != nil {
		apply(j)
	}
}

// probeSubtitleStreams lists the text tracks of a video, in subtitle-stream order.
func probeSubtitleStreams(ctx context.Context, input string) ([]ffprobeStream, error) {
	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "error",
		"-select_streams", "s",
		"-show_entries", "stream=index,codec_name,codec_type:stream_tags=language,title:stream_disposition=forced",
		"-print_format", "json",
		input,
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, errors.New(firstLine(msg))
	}

	var out struct {
		Streams []ffprobeStream `json:"streams"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		return nil, fmt.Errorf("پاسخ ffprobe قابل خواندن نبود: %w", err)
	}
	return out.Streams, nil
}

// extractSubtitleStream converts the n-th subtitle stream to WebVTT on stdout.
func extractSubtitleStream(ctx context.Context, input string, n int) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "ffmpeg",
		"-nostdin",
		"-v", "error",
		"-i", input,
		"-map", fmt.Sprintf("0:s:%d", n),
		"-c:s", "webvtt",
		"-f", "webvtt",
		"pipe:1",
	)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return nil, errors.New(firstLine(msg))
	}
	return stdout.Bytes(), nil
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}
