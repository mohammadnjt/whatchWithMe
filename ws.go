package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"runtime/debug"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	wsSendBuffer   = 512
	wsWriteTimeout = 15 * time.Second
	wsPingEvery    = 30 * time.Second
	wsReadTimeout  = 90 * time.Second // must exceed wsPingEvery; extended by every message and pong
	wsMaxMessage   = 16 << 20
	maxChatHistory = 200
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// Any origin, like the original ws server; reverse proxies often rewrite Host.
	CheckOrigin: func(*http.Request) bool { return true },
}

func isWebSocketUpgrade(r *http.Request) bool { return websocket.IsWebSocketUpgrade(r) }

// Client is one WebSocket connection. Identity comes from the session cookie (or Bearer
// header) of the handshake; a connection without one may only watch a pending account.
// Mutable fields are guarded by Server.mu.
type Client struct {
	conn      *websocket.Conn
	send      chan []byte
	done      chan struct{}
	closeOnce sync.Once

	authed bool
	userID string
	role   string

	watchUserID string // pending account whose approval this (logged-out) client waits for

	joined bool
	roomID string
}

func isAdminClient(c *Client) bool { return c.authed && c.role == "admin" }

func (c *Client) close() {
	c.closeOnce.Do(func() {
		close(c.done)
		c.conn.Close()
	})
}

// enqueue queues a message without blocking; a client that cannot keep up is
// disconnected (the frontend reconnects and gets a fresh room:init).
func (c *Client) enqueue(payload []byte) {
	if payload == nil {
		return
	}
	select {
	case <-c.done:
	case c.send <- payload:
	default:
		logErr.Printf("[WS] Dropping slow client (user %q)", c.userID)
		c.close()
	}
}

func (c *Client) writeLoop() {
	ticker := time.NewTicker(wsPingEvery)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case msg := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				c.close()
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				c.close()
				return
			}
		}
	}
}

func (s *Server) serveWS(w http.ResponseWriter, r *http.Request) {
	sess, _ := s.sessionFromRequest(r)
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade already replied with an error
	}
	c := &Client{conn: conn, send: make(chan []byte, wsSendBuffer), done: make(chan struct{})}
	if sess != nil {
		c.authed, c.userID, c.role = true, sess.UserID, sess.Role
	}

	s.mu.Lock()
	s.clients[c] = struct{}{}
	s.mu.Unlock()

	go c.writeLoop()
	defer s.disconnect(c)

	conn.SetReadLimit(wsMaxMessage)
	conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
	})
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		conn.SetReadDeadline(time.Now().Add(wsReadTimeout))
		s.handleWSMessage(c, data)
	}
}

func (s *Server) disconnect(c *Client) {
	s.mu.Lock()
	delete(s.clients, c)
	if c.joined {
		if room := s.rooms[c.roomID]; room != nil {
			if p := room.participant(c.userID); p != nil {
				p.Online = false
				s.broadcastRoom(c.roomID, map[string]any{"type": "room:participants_updated", "participants": room.Participants}, nil)
			}
		}
	}
	s.mu.Unlock()
	c.close()
}

func (s *Server) closeAllClients() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for c := range s.clients {
		c.conn.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseGoingAway, "server restarting"), time.Now().Add(time.Second))
		c.close()
	}
}

// broadcastRoom sends v to every client in roomID except exclude. Caller holds mu.
func (s *Server) broadcastRoom(roomID string, v any, exclude *Client) {
	payload := marshal(v)
	for c := range s.clients {
		if c.joined && c.roomID == roomID && c != exclude {
			c.enqueue(payload)
		}
	}
}

// sendToUserInRoom sends v to one participant of roomID, on every socket that
// user has open there. Caller holds mu.
func (s *Server) sendToUserInRoom(roomID, userID string, v any) {
	payload := marshal(v)
	for c := range s.clients {
		if c.joined && c.roomID == roomID && c.userID == userID {
			c.enqueue(payload)
		}
	}
}

// broadcastWhere sends v to every connected client matching pred. Caller must not hold mu.
func (s *Server) broadcastWhere(v any, pred func(*Client) bool) {
	payload := marshal(v)
	s.mu.Lock()
	defer s.mu.Unlock()
	for c := range s.clients {
		if pred(c) {
			c.enqueue(payload)
		}
	}
}

// disconnectUser closes the sockets of a user whose access was revoked. Caller must not hold mu.
func (s *Server) disconnectUser(userID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for c := range s.clients {
		if c.authed && c.userID == userID {
			c.close()
		}
	}
}

type videoSyncMsg struct {
	Type                  string  `json:"type"`
	CurrentTime           float64 `json:"currentTime"`
	IsPlaying             bool    `json:"isPlaying"`
	PlaybackRate          float64 `json:"playbackRate"`
	LastUpdatedServerTime int64   `json:"lastUpdatedServerTime"`
	ActionBy              any     `json:"actionBy,omitempty"`
	ActionType            any     `json:"actionType,omitempty"`
}

// rtcSignalMsg carries one WebRTC handshake message between two participants.
// The payload (an SDP offer/answer or an ICE candidate) is opaque to the server:
// it only routes it to the addressed peer in the same room.
type rtcSignalMsg struct {
	Type     string `json:"type"`
	Kind     string `json:"kind"` // offer | answer | candidate
	SenderID string `json:"senderId"`
	Payload  any    `json:"payload"`
}

type movieUpdatedMsg struct {
	Type          string         `json:"type"`
	Movie         map[string]any `json:"movie"`
	ScheduledTime any            `json:"scheduledTime"`
	Status        string         `json:"status"`
}

func notification(text string) map[string]any {
	return map[string]any{"type": "room:notification", "text": text, "variant": "info"}
}

func (s *Server) handleWSMessage(c *Client, data []byte) {
	defer func() {
		if rec := recover(); rec != nil {
			logErr.Printf("Error processing WS message: %v\n%s", rec, debug.Stack())
		}
	}()

	var msg map[string]any
	if err := json.Unmarshal(data, &msg); err != nil {
		logErr.Printf("Error processing WS message: %v", err)
		return
	}
	typ, _ := msg["type"].(string)

	// Clock sync (NTP-style) needs no room and no lock.
	if typ == "ping" {
		pong := map[string]any{"type": "pong", "serverTimestamp": nowMs()}
		if ts, ok := msg["clientTimestamp"]; ok {
			pong["clientTimestamp"] = ts
		}
		c.enqueue(marshal(pong))
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// The waiting screen of a pending user subscribes to its own approval events.
	if typ == "auth:watch" {
		userID, _ := msg["userId"].(string)
		token, _ := msg["statusToken"].(string)
		if s.validStatusToken(userID, token) {
			c.watchUserID = userID
		}
		return
	}

	// Everything below needs a logged-in user.
	if !c.authed {
		return
	}

	if typ == "join" {
		s.handleJoin(c, msg)
		return
	}

	if !c.joined {
		return
	}
	roomID := c.roomID
	room := s.rooms[roomID]
	if room == nil {
		return
	}

	switch typ {
	case "video:action":
		if ct, ok := msg["currentTime"].(float64); ok {
			room.CurrentTime = ct
		}
		if pr, ok := msg["playbackRate"].(float64); ok {
			room.PlaybackRate = pr
		}
		switch msg["action"] {
		case "play":
			room.IsPlaying = true
			room.Status = "playing"
		case "pause":
			room.IsPlaying = false
			room.Status = "paused"
		}
		room.LastUpdatedServerTime = nowMs()
		if msg["action"] == "play" {
			if v, _ := room.Movie["videoUrl"].(string); v != "" {
				s.touchFilm(v)
			}
		}
		s.roomsChanged()
		// Everyone, including the sender (as confirmation), gets the authoritative state.
		s.broadcastRoom(roomID, videoSyncMsg{
			Type: "video:sync", CurrentTime: room.CurrentTime, IsPlaying: room.IsPlaying,
			PlaybackRate: room.PlaybackRate, LastUpdatedServerTime: room.LastUpdatedServerTime,
			ActionBy: msg["actionBy"], ActionType: msg["action"],
		}, nil)

	case "user:quality":
		if p := room.participant(c.userID); p != nil {
			p.Quality = jsString(msg["quality"])
			s.broadcastRoom(roomID, map[string]any{"type": "room:participants_updated", "participants": room.Participants}, nil)
		}

	case "chat:message":
		sender, ok := msg["sender"].(map[string]any)
		if !ok {
			return
		}
		name := jsString(sender["name"])
		avatar := jsString(sender["avatar"])
		if !truthy(sender["avatar"]) {
			avatar = initials(name)
		}
		now := nowMs()
		chat := &ChatMessage{
			ID: fmt.Sprintf("msg-%d-%s", now, randBase36(4)), SenderID: c.userID,
			SenderName: name, Avatar: avatar, Text: jsString(msg["text"]), Timestamp: now,
		}
		room.ChatMessages = append(room.ChatMessages, chat)
		if len(room.ChatMessages) > maxChatHistory {
			room.ChatMessages = room.ChatMessages[len(room.ChatMessages)-maxChatHistory:]
		}
		s.roomsChanged()
		s.broadcastRoom(roomID, map[string]any{"type": "chat:new_message", "message": chat}, nil)

	case "room:update_movie":
		base := room.Movie
		if base == nil {
			base = defaultMovieBase()
		}
		merged := make(map[string]any, len(base))
		for k, v := range base {
			merged[k] = v
		}
		if m, ok := msg["movie"].(map[string]any); ok {
			for k, v := range m {
				merged[k] = v
			}
		}
		room.Movie = merged
		room.CurrentTime = 0
		room.IsPlaying = false
		room.LastUpdatedServerTime = nowMs()
		s.roomsChanged()

		s.broadcastRoom(roomID, movieUpdatedMsg{"room:movie_updated", room.Movie, room.ScheduledTime, room.Status}, nil)
		title := "Selected Video"
		if truthy(room.Movie["title"]) {
			title = jsString(room.Movie["title"])
		}
		s.broadcastRoom(roomID, notification(fmt.Sprintf("Movie changed to %q", title)), nil)

	case "room:update_schedule":
		room.ScheduledTime = msg["scheduledTime"]
		if truthy(msg["status"]) {
			room.Status = jsString(msg["status"])
			if room.Status == "playing" {
				room.IsPlaying = true
				room.LastUpdatedServerTime = nowMs()
				if v, _ := room.Movie["videoUrl"].(string); v != "" {
					s.touchFilm(v)
				}
			}
		}
		s.roomsChanged()
		s.broadcastRoom(roomID, movieUpdatedMsg{"room:movie_updated", room.Movie, room.ScheduledTime, room.Status}, nil)

	// WebRTC handshake between two participants. Audio itself never passes
	// through here: it goes peer-to-peer, or over the TURN relay.
	case "rtc:signal":
		target, _ := msg["target"].(string)
		kind, _ := msg["kind"].(string)
		if target == "" || target == c.userID {
			return
		}
		switch kind {
		case "offer", "answer", "candidate":
		default:
			return // unknown handshake step
		}
		s.sendToUserInRoom(roomID, target, rtcSignalMsg{
			Type: "rtc:signal", Kind: kind, SenderID: c.userID, Payload: msg["payload"],
		})

	case "voice:mic_state":
		if p := room.participant(c.userID); p != nil {
			p.IsMicOn = truthy(msg["isMicOn"])
			s.broadcastRoom(roomID, map[string]any{"type": "room:participants_updated", "participants": room.Participants}, nil)
		}

	case "voice:speaking":
		if p := room.participant(c.userID); p != nil {
			p.IsSpeaking = truthy(msg["isSpeaking"])
			s.broadcastRoom(roomID, map[string]any{"type": "voice:user_speaking", "userId": c.userID, "isSpeaking": p.IsSpeaking}, nil)
		}
	}
}

// handleJoin registers the client in a room (created on demand) and sends it the room state.
// The participant's id and role come from the session; name, avatar, color and quality are
// the user's own display preferences. Caller holds mu.
func (s *Server) handleJoin(c *Client, msg map[string]any) {
	roomID, ok := msg["roomId"].(string)
	if !ok {
		return
	}
	user, ok := msg["user"].(map[string]any)
	if !ok {
		user = map[string]any{}
	}
	userID := c.userID
	name := jsString(user["name"])
	if name == "" {
		name = userID
	}

	room := s.rooms[roomID]
	if room == nil {
		room = newRoom(roomID, roomNameFromID(roomID), userID)
		s.putRoom(room)
	}

	c.joined, c.roomID = true, roomID

	pick := func(key, def string) string {
		if truthy(user[key]) {
			return jsString(user[key])
		}
		return def
	}
	wasEmpty := len(room.Participants) == 0
	p := room.participant(userID)
	if p == nil {
		p = &Participant{ID: userID}
		room.Participants = append(room.Participants, p)
	}
	// Mic/speaking state of a returning participant is kept.
	p.Name = name
	p.Avatar = pick("avatar", initials(name))
	p.Color = pick("color", "#8b5cf6")
	p.Quality = pick("quality", "720p")
	p.Role = c.role
	p.IsHost = room.HostID == userID || wasEmpty
	p.Online = true
	p.Ping = 12

	now := nowMs()
	snapshot := *room
	snapshot.CurrentTime = room.playbackPosition(now)
	c.enqueue(marshal(map[string]any{"type": "room:init", "room": snapshot, "serverTime": now, "yourId": userID}))

	s.broadcastRoom(roomID, map[string]any{"type": "room:participants_updated", "participants": room.Participants}, nil)
	s.broadcastRoom(roomID, map[string]any{"type": "room:notification", "text": name + " joined the room", "variant": "info"}, c)
}
