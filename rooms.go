package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Participant struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Avatar     string `json:"avatar"`
	Color      string `json:"color"`
	Quality    string `json:"quality"`
	Role       string `json:"role,omitempty"`
	IsHost     bool   `json:"isHost"`
	Online     bool   `json:"online"`
	Ping       int    `json:"ping"`
	IsMicOn    bool   `json:"isMicOn"`
	IsSpeaking bool   `json:"isSpeaking"`
}

type ChatMessage struct {
	ID         string `json:"id"`
	SenderID   string `json:"senderId"`
	SenderName string `json:"senderName"`
	Avatar     string `json:"avatar"`
	Text       string `json:"text"`
	Timestamp  int64  `json:"timestamp"`
	IsSystem   bool   `json:"isSystem,omitempty"`
}

// Room is the authoritative playback state of one watch party.
// Movie is kept as a free-form object because clients merge arbitrary fields into it.
type Room struct {
	ID                    string         `json:"id"`
	Name                  string         `json:"name"`
	Movie                 map[string]any `json:"movie"`
	ScheduledTime         any            `json:"scheduledTime"`
	Status                string         `json:"status"` // scheduled | playing | paused | ended
	CurrentTime           float64        `json:"currentTime"`
	PlaybackRate          float64        `json:"playbackRate"`
	IsPlaying             bool           `json:"isPlaying"`
	LastUpdatedServerTime int64          `json:"lastUpdatedServerTime"`
	HostID                string         `json:"hostId"`
	Participants          []*Participant `json:"participants"`
	ChatMessages          []*ChatMessage `json:"chatMessages"`
	AllowEveryoneControl  bool           `json:"allowEveryoneControl"`
	SyncThresholdMs       int            `json:"syncThresholdMs"`
	CreatedAt             int64          `json:"createdAt"`
}

func newRoom(id, name, hostID string) *Room {
	now := nowMs()
	return &Room{
		ID: id, Name: name, Status: "playing", PlaybackRate: 1, LastUpdatedServerTime: now, HostID: hostID,
		Participants: []*Participant{}, ChatMessages: []*ChatMessage{}, AllowEveryoneControl: true,
		SyncThresholdMs: 250, CreatedAt: now,
	}
}

// putRoom stores a room, keeping the creation order for listing. Caller holds mu.
func (s *Server) putRoom(r *Room) {
	if _, exists := s.rooms[r.ID]; !exists {
		s.roomOrder = append(s.roomOrder, r.ID)
	}
	s.rooms[r.ID] = r
	s.roomsChanged()
}

func (r *Room) participant(id string) *Participant {
	for _, p := range r.Participants {
		if p.ID == id {
			return p
		}
	}
	return nil
}

// playbackPosition is the current time accounting for playback since the last update.
func (r *Room) playbackPosition(now int64) float64 {
	if !r.IsPlaying {
		return r.CurrentTime
	}
	return r.CurrentTime + float64(now-r.LastUpdatedServerTime)/1000*r.PlaybackRate
}

func defaultMovieBase() map[string]any {
	return map[string]any{
		"title":     "Custom Movie",
		"year":      strconv.Itoa(time.Now().Year()),
		"genre":     "Cinema",
		"tagline":   "",
		"posterUrl": "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=800&auto=format&fit=crop",
		"videoUrl":  "",
		"duration":  0.0,
	}
}

// ---------- rooms.json ----------

// storedRoom is what rooms.json keeps of a room: who is online is not persisted.
type storedRoom struct {
	ID            string         `json:"id"`
	Name          string         `json:"name"`
	Movie         map[string]any `json:"movie"`
	ScheduledTime any            `json:"scheduledTime"`
	Status        string         `json:"status"`
	CurrentTime   float64        `json:"currentTime"`
	PlaybackRate  float64        `json:"playbackRate"`
	HostID        string         `json:"hostId"`
	ChatMessages  []*ChatMessage `json:"chatMessages"`
	CreatedAt     int64          `json:"createdAt"`
}

func (s *Server) roomsPath() string { return filepath.Join(s.dataDir, "rooms.json") }

// loadRooms restores rooms.json. Playback resumes paused at the saved position. Caller holds mu.
func (s *Server) loadRooms() {
	data, err := os.ReadFile(s.roomsPath())
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			logErr.Printf("[Rooms] Cannot read rooms.json: %v", err)
		}
		return
	}
	var list []storedRoom
	if err := json.Unmarshal(data, &list); err != nil {
		logErr.Printf("[Rooms] Cannot parse rooms.json: %v", err)
		backupCorrupt(s.roomsPath())
		return
	}
	for _, sr := range list {
		if sr.ID == "" {
			continue
		}
		r := newRoom(sr.ID, sr.Name, sr.HostID)
		r.Movie, r.ScheduledTime, r.CurrentTime = sr.Movie, sr.ScheduledTime, sr.CurrentTime
		if sr.Status != "" {
			r.Status = sr.Status
		}
		if sr.PlaybackRate > 0 {
			r.PlaybackRate = sr.PlaybackRate
		}
		if sr.ChatMessages != nil {
			r.ChatMessages = sr.ChatMessages
		}
		if sr.CreatedAt > 0 {
			r.CreatedAt = sr.CreatedAt
		}
		s.roomOrder = append(s.roomOrder, r.ID)
		s.rooms[r.ID] = r
	}
	logInfo.Printf("[Rooms] Loaded %d rooms from storage.", len(s.roomOrder))
}

// roomsSnapshot encodes the rooms worth keeping. Rooms that never got a movie or a message
// (e.g. opened by mistyping a room code) are dropped. Caller holds mu.
func (s *Server) roomsSnapshot() []byte {
	now := nowMs()
	list := []storedRoom{}
	for _, id := range s.roomOrder {
		r := s.rooms[id]
		if r.Movie == nil && len(r.ChatMessages) == 0 {
			continue
		}
		list = append(list, storedRoom{
			ID: r.ID, Name: r.Name, Movie: r.Movie, ScheduledTime: r.ScheduledTime, Status: r.Status,
			CurrentTime: r.playbackPosition(now), PlaybackRate: r.PlaybackRate, HostID: r.HostID,
			ChatMessages: r.ChatMessages, CreatedAt: r.CreatedAt,
		})
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		logErr.Printf("[Rooms] Cannot encode rooms: %v", err)
		return nil
	}
	return data
}

// roomSaver writes rooms.json at most once per second, outside the state lock.
type roomSaver struct {
	mu      sync.Mutex // guards pending
	pending bool
	writeMu sync.Mutex // one snapshot+write at a time, so an older snapshot never overwrites a newer one
}

// roomsChanged schedules a write of rooms.json. Caller holds mu.
func (s *Server) roomsChanged() {
	s.roomSave.mu.Lock()
	defer s.roomSave.mu.Unlock()
	if s.roomSave.pending {
		return
	}
	s.roomSave.pending = true
	time.AfterFunc(time.Second, s.saveRoomsNow)
}

// saveRoomsNow writes rooms.json immediately. Caller must not hold mu.
func (s *Server) saveRoomsNow() {
	s.roomSave.mu.Lock()
	s.roomSave.pending = false
	s.roomSave.mu.Unlock()

	s.roomSave.writeMu.Lock()
	defer s.roomSave.writeMu.Unlock()
	s.mu.Lock()
	data := s.roomsSnapshot()
	s.mu.Unlock()
	if data == nil {
		return
	}
	if err := writeFileAtomic(s.roomsPath(), data); err != nil {
		logErr.Printf("[Rooms] Cannot save rooms.json: %v", err)
	}
}

// ---------- REST ----------

// GET /api/rooms
func (s *Server) handleListRooms(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	list := make([]map[string]any, 0, len(s.roomOrder))
	for _, id := range s.roomOrder {
		room := s.rooms[id]
		online := 0
		for _, p := range room.Participants {
			if p.Online {
				online++
			}
		}
		list = append(list, map[string]any{
			"id": room.ID, "name": room.Name, "movie": room.Movie, "status": room.Status,
			"scheduledTime": room.ScheduledTime, "participantCount": online,
		})
	}
	// Encode while holding the lock: the movie maps are shared with the live rooms.
	payload := marshal(list)
	s.mu.Unlock()

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write(payload)
}

// POST /api/rooms: creates a room. An existing room with the same id is returned unchanged,
// so creating a room can never wipe another one's movie or chat.
func (s *Server) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	body := readJSON(r)
	id := jsString(body["id"])
	if !truthy(body["id"]) {
		id = "room-" + strconv.FormatInt(nowMs(), 36)
	}
	name := "New Watch Party"
	if truthy(body["name"]) {
		name = strings.TrimSpace(jsString(body["name"]))
	}
	hostID := ""
	if sess := sessionOf(r); sess != nil {
		hostID = sess.UserID
	}

	s.mu.Lock()
	room := s.rooms[id]
	if room == nil {
		room = newRoom(id, name, hostID)
		if movie, ok := body["movie"].(map[string]any); ok && truthy(movie["videoUrl"]) {
			room.Movie = movie
		}
		if truthy(body["scheduledTime"]) {
			room.ScheduledTime = body["scheduledTime"]
			room.Status = "scheduled"
		}
		s.putRoom(room)
	}
	payload := marshal(room)
	s.mu.Unlock()

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Write(payload)
}

func roomNameFromID(id string) string {
	return strings.ToUpper(strings.ReplaceAll(id, "-", " "))
}
