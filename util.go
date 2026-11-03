package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/rand/v2"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func nowMs() int64 { return time.Now().UnixMilli() }

// writeJSON writes v as JSON with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		logErr.Printf("[HTTP] Failed to encode response: %v", err)
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	w.Write(buf.Bytes())
}

// readJSON decodes a JSON object body. An invalid or missing body yields an empty object,
// so handlers answer with their own validation errors.
func readJSON(r *http.Request) map[string]any {
	var m map[string]any
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&m); err != nil || m == nil {
		return map[string]any{}
	}
	return m
}

func marshal(v any) []byte {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		logErr.Printf("[JSON] Encode failed: %v", err)
		return nil
	}
	return bytes.TrimRight(buf.Bytes(), "\n")
}

// truthy mirrors JavaScript truthiness for decoded JSON values.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0 && !math.IsNaN(x)
	default:
		return true
	}
}

// jsString mirrors JavaScript String(v) for decoded JSON scalars.
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case bool:
		return strconv.FormatBool(x)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	default:
		return string(marshal(x))
	}
}

// initials returns the first two characters of name, upper-cased.
func initials(name string) string {
	r := []rune(name)
	if len(r) > 2 {
		r = r[:2]
	}
	return strings.ToUpper(string(r))
}

const base36 = "0123456789abcdefghijklmnopqrstuvwxyz"

func randBase36(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = base36[rand.IntN(len(base36))]
	}
	return string(b)
}

func formatBytes(bytes int64) string {
	if bytes <= 0 {
		return "0 B"
	}
	sizes := []string{"B", "KB", "MB", "GB", "TB"}
	i := int(math.Floor(math.Log(float64(bytes)) / math.Log(1024)))
	if i >= len(sizes) {
		i = len(sizes) - 1
	}
	v := math.Round(float64(bytes)/math.Pow(1024, float64(i))*100) / 100
	return strconv.FormatFloat(v, 'f', -1, 64) + " " + sizes[i]
}

var safeExtRe = regexp.MustCompile(`^\.[A-Za-z0-9]{1,10}$`)

// safeExt returns the file extension of name if it is plain alphanumeric, else ".mp4".
func safeExt(name string) string {
	ext := filepath.Ext(name)
	if !safeExtRe.MatchString(ext) {
		return ".mp4"
	}
	return ext
}

// validFileName rejects anything that could escape the uploads directory.
func validFileName(name string) bool {
	return name != "" && name != "." && name != ".." &&
		!strings.ContainsAny(name, "/\\\x00") && filepath.Base(name) == name
}

// writeFileAtomic writes data to a temp file and renames it over path,
// so a crash never leaves a half-written JSON file behind.
func writeFileAtomic(path string, data []byte) error {
	tmp := fmt.Sprintf("%s.tmp-%d", path, os.Getpid())
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func writeJSONFile(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(path, data)
}

// backupCorrupt moves an unreadable data file aside instead of letting the next save overwrite it.
func backupCorrupt(path string) {
	backup := fmt.Sprintf("%s.corrupt-%d", path, time.Now().Unix())
	if err := os.Rename(path, backup); err == nil {
		logErr.Printf("[Storage] Unreadable %s was moved to %s", filepath.Base(path), backup)
	}
}

// loadDotEnv reads KEY=VALUE lines from path into the environment. Variables that are
// already set win, so the PORT that BAS passes in is never overridden by .env.
func loadDotEnv(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		if len(val) >= 2 && (val[0] == '"' && val[len(val)-1] == '"' || val[0] == '\'' && val[len(val)-1] == '\'') {
			val = val[1 : len(val)-1]
		} else if i := strings.Index(val, " #"); i >= 0 {
			val = strings.TrimSpace(val[:i])
		}
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); !exists {
			os.Setenv(key, val)
		}
	}
}
