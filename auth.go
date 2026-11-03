package main

import (
	"context"
	"crypto/hmac"
	crand "crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"
)

type UserRecord struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	DisplayName  string `json:"displayName"`
	PasswordHash string `json:"passwordHash"`
	Salt         string `json:"salt"`
	Role         string `json:"role"`   // admin | user
	Status       string `json:"status"` // pending | approved | rejected
	CreatedAt    int64  `json:"createdAt"`
	ApprovedAt   *int64 `json:"approvedAt,omitempty"`
	Avatar       string `json:"avatar"`
	Color        string `json:"color"`
}

// PublicUser is a user without password data, as sent to clients.
type PublicUser struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	Status      string `json:"status"`
	Avatar      string `json:"avatar"`
	Color       string `json:"color"`
	CreatedAt   int64  `json:"createdAt"`
	ApprovedAt  *int64 `json:"approvedAt,omitempty"`
}

func (u *UserRecord) public() PublicUser {
	return PublicUser{
		ID: u.ID, Username: u.Username, DisplayName: u.DisplayName, Role: u.Role, Status: u.Status,
		Avatar: u.Avatar, Color: u.Color, CreatedAt: u.CreatedAt, ApprovedAt: u.ApprovedAt,
	}
}

type Session struct {
	Token     string
	UserID    string
	Username  string
	Role      string
	ExpiresAt int64
}

const (
	sessionTTL    = 30 * 24 * time.Hour
	sessionCookie = "wt_session"
	// Header with which a user waiting for approval proves the pending account is theirs.
	statusTokenHeader = "X-Status-Token"
)

var userColors = []string{"#8b5cf6", "#3b82f6", "#ec4899", "#10b981", "#f59e0b", "#06b6d4", "#6366f1"}

func (s *Server) usersFile() string { return filepath.Join(s.dataDir, "users.json") }

func (s *Server) adminUser() PublicUser {
	return PublicUser{
		ID: "admin", Username: s.adminUsername, DisplayName: "مدیر سامانه (Admin)", Role: "admin",
		Status: "approved", Avatar: "AD", Color: "#ec4899", CreatedAt: 0,
	}
}

func (s *Server) loadUsers() {
	data, err := os.ReadFile(s.usersFile())
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			logErr.Printf("[Auth] Failed to load users: %v", err)
		}
		return
	}
	var list []*UserRecord
	if err := json.Unmarshal(data, &list); err != nil {
		logErr.Printf("[Auth] Failed to parse users.json: %v", err)
		backupCorrupt(s.usersFile())
		return
	}
	s.users = list
	logInfo.Printf("[Auth] Loaded %d users from storage.", len(list))
}

// loadSecret reads (or creates) the key that signs status tokens, so they survive restarts.
func (s *Server) loadSecret() error {
	path := filepath.Join(s.dataDir, "secret.key")
	if data, err := os.ReadFile(path); err == nil {
		if key, err := hex.DecodeString(strings.TrimSpace(string(data))); err == nil && len(key) >= 32 {
			s.secret = key
			return nil
		}
	}
	key := make([]byte, 32)
	if _, err := crand.Read(key); err != nil {
		return err
	}
	if err := os.WriteFile(path, []byte(hex.EncodeToString(key)+"\n"), 0o600); err != nil {
		return err
	}
	s.secret = key
	return nil
}

// statusToken is handed to a pending user at registration. Only its holder can poll the
// account's approval status (and receive the session once approved).
func (s *Server) statusToken(userID string) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte("status:" + userID))
	return hex.EncodeToString(m.Sum(nil))
}

func (s *Server) validStatusToken(userID, token string) bool {
	if userID == "" || token == "" {
		return false
	}
	return hmac.Equal([]byte(s.statusToken(userID)), []byte(token))
}

// saveUsers persists users. Caller holds authMu.
func (s *Server) saveUsers() {
	list := s.users
	if list == nil {
		list = []*UserRecord{}
	}
	if err := writeJSONFile(s.usersFile(), list); err != nil {
		logErr.Printf("[Auth] Failed to save users: %v", err)
	}
}

func (s *Server) findUser(id string) *UserRecord {
	for _, u := range s.users {
		if u.ID == id {
			return u
		}
	}
	return nil
}

func hashPassword(password, salt string) string {
	// Same parameters as Node's crypto.scryptSync(password, salt, 32), so existing users.json files keep working.
	key, err := scrypt.Key([]byte(password), []byte(salt), 16384, 8, 1, 32)
	if err != nil {
		panic(err) // only possible with invalid parameters
	}
	return hex.EncodeToString(key)
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := crand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// createSession issues a session token. Caller holds authMu.
func (s *Server) createSession(userID, username, role string) string {
	token := randomHex(32)
	s.sessions[token] = &Session{
		Token: token, UserID: userID, Username: username, Role: role,
		ExpiresAt: time.Now().Add(sessionTTL).UnixMilli(),
	}
	return token
}

// revokeSessions ends every session of a user. Caller holds authMu.
func (s *Server) revokeSessions(userID string) {
	for token, sess := range s.sessions {
		if sess.UserID == userID {
			delete(s.sessions, token)
		}
	}
}

func (s *Server) pruneSessions() {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	now := nowMs()
	for token, sess := range s.sessions {
		if sess.ExpiresAt < now {
			delete(s.sessions, token)
		}
	}
}

func bearerToken(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return "", false
	}
	return h[len("Bearer "):], true
}

// validSession returns the live session for token; a user's session ends once the
// account is deleted or no longer approved. Caller holds authMu.
func (s *Server) validSession(token string) *Session {
	sess := s.sessions[token]
	if sess == nil || sess.ExpiresAt < nowMs() {
		return nil
	}
	if sess.Role != "admin" {
		if u := s.findUser(sess.UserID); u == nil || u.Status != "approved" {
			return nil
		}
	}
	return sess
}

// sessionFromRequest authenticates with the Bearer header or the session cookie.
// The second result reports whether any credential was sent at all.
func (s *Server) sessionFromRequest(r *http.Request) (*Session, bool) {
	var tokens []string
	if t, ok := bearerToken(r); ok && t != "" {
		tokens = append(tokens, t)
	}
	if c, err := r.Cookie(sessionCookie); err == nil && c.Value != "" {
		tokens = append(tokens, c.Value)
	}
	s.authMu.Lock()
	defer s.authMu.Unlock()
	for _, t := range tokens {
		if sess := s.validSession(t); sess != nil {
			cp := *sess
			return &cp, true
		}
	}
	return nil, len(tokens) > 0
}

func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// setSessionCookie lets the browser authenticate requests it cannot add headers to
// (video elements, WebSocket handshakes, uploads).
func setSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", MaxAge: int(sessionTTL.Seconds()),
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isHTTPS(r),
	})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: isHTTPS(r),
	})
}

type sessionCtxKey struct{}

// sessionOf returns the session that requireUser/requireAdmin attached to the request.
func sessionOf(r *http.Request) *Session {
	sess, _ := r.Context().Value(sessionCtxKey{}).(*Session)
	return sess
}

func withSession(r *http.Request, sess *Session) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), sessionCtxKey{}, sess))
}

// displayNameOf is the name shown for the session's user (e.g. as a film's uploader).
func (s *Server) displayNameOf(sess *Session) string {
	if sess == nil {
		return ""
	}
	if sess.Role == "admin" {
		return "مدیر"
	}
	s.authMu.Lock()
	defer s.authMu.Unlock()
	if u := s.findUser(sess.UserID); u != nil && u.DisplayName != "" {
		return u.DisplayName
	}
	return sess.Username
}

// requireUser lets through any approved user or the admin.
func (s *Server) requireUser(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, _ := s.sessionFromRequest(r)
		if sess == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "برای این کار باید وارد حساب کاربری شوید."})
			return
		}
		next(w, withSession(r, sess))
	}
}

func (s *Server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, sent := s.sessionFromRequest(r)
		if !sent {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "Unauthorized: missing token"})
			return
		}
		if sess == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "Unauthorized: session expired or invalid"})
			return
		}
		if sess.Role != "admin" {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "Forbidden: admin access required"})
			return
		}
		next(w, withSession(r, sess))
	}
}

func equalStrings(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// POST /api/auth/login-or-register and /api/auth/login
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	body := readJSON(r)
	if !truthy(body["username"]) || !truthy(body["password"]) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "نام کاربری و رمز عبور الزامی است."})
		return
	}
	username := strings.ToLower(strings.TrimSpace(jsString(body["username"])))
	password := strings.TrimSpace(jsString(body["password"]))
	displayName := username
	if truthy(body["displayName"]) {
		displayName = strings.TrimSpace(jsString(body["displayName"]))
	}

	// 1. Admin, with the credentials from .env
	if username == strings.ToLower(s.adminUsername) {
		ap := s.adminPassword
		if equalStrings(password, ap) || (ap == "admin" && password == "admin123") || (ap == "admin123" && password == "admin") {
			s.authMu.Lock()
			token := s.createSession("admin", s.adminUsername, "admin")
			s.authMu.Unlock()
			setSessionCookie(w, r, token)
			writeJSON(w, http.StatusOK, map[string]any{"success": true, "token": token, "user": s.adminUser()})
		} else {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"success": false, "error": "رمز عبور مدیر سیستم نادرست است."})
		}
		return
	}

	s.authMu.Lock()
	defer s.authMu.Unlock()

	// 2. Existing user
	var existing *UserRecord
	for _, u := range s.users {
		if strings.ToLower(u.Username) == username {
			existing = u
			break
		}
	}
	if existing != nil {
		if !equalStrings(hashPassword(password, existing.Salt), existing.PasswordHash) {
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"success": false,
				"error":   "نام کاربری قبلاً ثبت شده و رمز عبور وارد شده نادرست است.",
			})
			return
		}
		switch existing.Status {
		case "pending":
			writeJSON(w, http.StatusOK, map[string]any{
				"success": false, "status": "pending", "userId": existing.ID, "username": existing.Username,
				"displayName": existing.DisplayName, "statusToken": s.statusToken(existing.ID),
				"message": "درخواست ورود شما در انتظار تأیید مدیر سیستم است.",
			})
			return
		case "rejected":
			writeJSON(w, http.StatusOK, map[string]any{
				"success": false, "status": "rejected", "userId": existing.ID, "username": existing.Username,
				"displayName": existing.DisplayName, "message": "درخواست ورود شما توسط مدیر سیستم رد شده است.",
			})
			return
		}
		token := s.createSession(existing.ID, existing.Username, existing.Role)
		setSessionCookie(w, r, token)
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "token": token, "user": existing.public()})
		return
	}

	// 3. New user: registered as pending until an admin approves
	salt := randomHex(16)
	now := nowMs()
	user := &UserRecord{
		ID:           "user-" + strconv.FormatInt(now, 36) + "-" + randBase36(4),
		Username:     username,
		DisplayName:  displayName,
		PasswordHash: hashPassword(password, salt),
		Salt:         salt,
		Role:         "user",
		Status:       "pending",
		CreatedAt:    now,
		Avatar:       initials(displayName),
		Color:        userColors[rand.IntN(len(userColors))],
	}
	s.users = append(s.users, user)
	s.saveUsers()

	s.broadcastWhere(map[string]any{"type": "admin:new_pending_user", "user": user.public()}, isAdminClient)

	writeJSON(w, http.StatusOK, map[string]any{
		"success": false, "status": "pending", "userId": user.ID, "username": user.Username,
		"displayName": user.DisplayName, "statusToken": s.statusToken(user.ID),
		"message": "حساب کاربری جدید ایجاد شد و برای ورود به تأیید مدیر سیستم ارسال گردید.",
	})
}

// GET /api/auth/me (also refreshes the session cookie for sessions created before it existed)
func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	sess, sent := s.sessionFromRequest(r)
	if !sent {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "Missing session token"})
		return
	}
	if sess == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "Session expired"})
		return
	}
	setSessionCookie(w, r, sess.Token)
	if sess.Role == "admin" {
		writeJSON(w, http.StatusOK, map[string]any{"user": s.adminUser()})
		return
	}
	s.authMu.Lock()
	defer s.authMu.Unlock()
	user := s.findUser(sess.UserID)
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "User not approved or revoked"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user.public()})
}

// GET /api/auth/status?userId=... with the X-Status-Token header (polled by the waiting screen)
func (s *Server) handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("userId")
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "userId is required"})
		return
	}
	if !s.validStatusToken(userID, r.Header.Get(statusTokenHeader)) {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "توکن وضعیت نامعتبر است؛ دوباره وارد شوید."})
		return
	}
	s.authMu.Lock()
	defer s.authMu.Unlock()
	user := s.findUser(userID)
	if user == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "User not found"})
		return
	}
	resp := map[string]any{"status": user.Status}
	if user.Status == "approved" {
		token := s.createSession(user.ID, user.Username, user.Role)
		setSessionCookie(w, r, token)
		resp["token"] = token
		resp["user"] = user.public()
	}
	writeJSON(w, http.StatusOK, resp)
}

// POST /api/auth/logout
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.authMu.Lock()
	if token, ok := bearerToken(r); ok {
		delete(s.sessions, token)
	}
	if c, err := r.Cookie(sessionCookie); err == nil {
		delete(s.sessions, c.Value)
	}
	s.authMu.Unlock()
	clearSessionCookie(w, r)
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// GET /api/admin/users
func (s *Server) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	s.authMu.Lock()
	list := make([]PublicUser, 0, len(s.users))
	for _, u := range s.users {
		list = append(list, u.public())
	}
	s.authMu.Unlock()

	sort.SliceStable(list, func(i, j int) bool {
		a, b := list[i], list[j]
		if (a.Status == "pending") != (b.Status == "pending") {
			return a.Status == "pending"
		}
		return a.CreatedAt > b.CreatedAt
	})
	pending := 0
	for _, u := range list {
		if u.Status == "pending" {
			pending++
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": list, "pendingCount": pending})
}

// notifyAccountChange tells admins and the user's own waiting screen that an account changed.
// No session token is broadcast: the waiting screen fetches it with its status token.
func (s *Server) notifyAccountChange(eventType, userID string) {
	s.broadcastWhere(map[string]any{"type": eventType, "userId": userID}, func(c *Client) bool {
		return isAdminClient(c) || c.watchUserID == userID
	})
}

// POST /api/admin/users/{id}/approve
func (s *Server) handleAdminApprove(w http.ResponseWriter, r *http.Request) {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	user := s.findUser(r.PathValue("id"))
	if user == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "User not found"})
		return
	}
	now := nowMs()
	user.Status = "approved"
	user.ApprovedAt = &now
	s.saveUsers()
	s.notifyAccountChange("auth:approved", user.ID)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "user": user.public()})
}

// POST /api/admin/users/{id}/reject
func (s *Server) handleAdminReject(w http.ResponseWriter, r *http.Request) {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	user := s.findUser(r.PathValue("id"))
	if user == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "User not found"})
		return
	}
	user.Status = "rejected"
	s.saveUsers()
	s.revokeSessions(user.ID)
	s.disconnectUser(user.ID)
	s.notifyAccountChange("auth:rejected", user.ID)
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "user": user.public()})
}

// DELETE /api/admin/users/{id}
func (s *Server) handleAdminDeleteUser(w http.ResponseWriter, r *http.Request) {
	s.authMu.Lock()
	defer s.authMu.Unlock()
	id := r.PathValue("id")
	for i, u := range s.users {
		if u.ID == id {
			s.users = append(s.users[:i], s.users[i+1:]...)
			s.saveUsers()
			s.revokeSessions(id)
			s.disconnectUser(id)
			writeJSON(w, http.StatusOK, map[string]any{"success": true})
			return
		}
	}
	writeJSON(w, http.StatusNotFound, map[string]any{"error": "User not found"})
}
