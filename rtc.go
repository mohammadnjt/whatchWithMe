// WebRTC voice support: the ICE configuration handed to browsers and the
// built-in TURN relay they fall back to.
//
// Voice used to be MediaRecorder chunks pushed over the WebSocket, which could
// never play back: only the first chunk of a MediaRecorder stream carries the
// container header, so every later chunk was an undecodable fragment. Audio now
// travels peer-to-peer over WebRTC and the WebSocket only carries signalling.
//
// Direct peer-to-peer fails behind symmetric NAT and carrier-grade NAT, which is
// the common case on mobile data, so this file also runs a TURN relay. Browsers
// authenticate to it with short-lived credentials (the "TURN REST API" scheme):
// the username is "<expiry>:<userId>" and the password is an HMAC of that
// username under a server-side secret, so nothing long-lived ships to a client
// and a credential stops working on its own.
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/pion/logging"
	"github.com/pion/turn/v4"
)

// How long a TURN credential issued to a browser stays valid.
const turnCredTTL = 12 * time.Hour

// turnConfig is resolved once at startup from the environment.
type turnConfig struct {
	enabled   bool
	publicIP  net.IP
	port      int
	secret    string
	relayMin int
	relayMax int
	stunURLs []string
	extraICE []map[string]any // additional ICE servers, appended to the list verbatim
}

// loadTURNConfig reads the voice settings from the environment, filling in
// defaults that work on this server without any configuration.
//
// The relay port range deliberately avoids 49160-49400: a sibling app on the
// same host already relays there.
func (s *Server) loadTURNConfig() turnConfig {
	c := turnConfig{
		enabled:  !strings.EqualFold(strings.TrimSpace(os.Getenv("TURN_ENABLED")), "false"),
		port:     envInt("TURN_PORT", 3479),
		relayMin: envInt("TURN_RELAY_MIN", 49500),
		relayMax: envInt("TURN_RELAY_MAX", 49700),
	}

	// EXTRA_ICE_SERVERS lets an operator point at an external TURN service
	// without a rebuild; it is a JSON array in RTCIceServer shape.
	if raw := strings.TrimSpace(os.Getenv("EXTRA_ICE_SERVERS")); raw != "" {
		if err := json.Unmarshal([]byte(raw), &c.extraICE); err != nil {
			logErr.Printf("[RTC] Ignoring EXTRA_ICE_SERVERS: %v", err)
			c.extraICE = nil
		}
	}

	stun := strings.TrimSpace(os.Getenv("STUN_SERVERS"))
	if stun == "" {
		// Cloudflare first: Google's STUN is unreachable from some networks.
		stun = "stun:stun.cloudflare.com:3478,stun:stun.l.google.com:19302"
	}
	for _, u := range strings.Split(stun, ",") {
		if u = strings.TrimSpace(u); u != "" {
			c.stunURLs = append(c.stunURLs, u)
		}
	}

	if ipStr := strings.TrimSpace(os.Getenv("TURN_PUBLIC_IP")); ipStr != "" {
		c.publicIP = net.ParseIP(ipStr)
		if c.publicIP == nil {
			logErr.Printf("[RTC] TURN_PUBLIC_IP %q is not an IP address; detecting instead.", ipStr)
		}
	}
	if c.publicIP == nil {
		c.publicIP = detectPublicIP()
	}

	c.secret = strings.TrimSpace(os.Getenv("TURN_SECRET"))
	if c.secret == "" {
		c.secret = s.turnSecretFromDisk()
	}

	if c.publicIP == nil || c.secret == "" {
		if c.enabled {
			logErr.Printf("[RTC] TURN relay off: no public IP detected or no secret available. " +
				"Voice will rely on STUN only and may fail behind symmetric NAT.")
		}
		c.enabled = false
	}
	return c
}

func envInt(key string, def int) int {
	if v, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key))); err == nil && v > 0 {
		return v
	}
	return def
}

// detectPublicIP returns the address this host uses to reach the internet.
// Dialling a UDP address sends nothing; it only resolves the egress interface.
func detectPublicIP() net.IP {
	conn, err := net.Dial("udp4", "1.1.1.1:53")
	if err != nil {
		return nil
	}
	defer conn.Close()
	addr, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok || !isPublicIP(addr.IP) {
		return nil
	}
	return addr.IP
}

// turnSecretFromDisk returns the persisted TURN secret, creating one on first
// run. It has to survive restarts: a new secret would invalidate the
// credentials of everyone currently connected.
func (s *Server) turnSecretFromDisk() string {
	path := filepath.Join(s.dataDir, "turn.secret")
	if b, err := os.ReadFile(path); err == nil {
		if secret := strings.TrimSpace(string(b)); secret != "" {
			return secret
		}
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		logErr.Printf("[RTC] Cannot generate a TURN secret: %v", err)
		return ""
	}
	secret := hex.EncodeToString(buf)
	if err := os.WriteFile(path, []byte(secret+"\n"), 0o600); err != nil {
		logErr.Printf("[RTC] Cannot save %s: %v", path, err)
		return ""
	}
	return secret
}

// turnCredentials mints a short-lived login for one user.
func turnCredentials(secret, userID string) (username, password string) {
	username = fmt.Sprintf("%d:%s", time.Now().Add(turnCredTTL).Unix(), userID)
	return username, turnPassword(secret, username)
}

func turnPassword(secret, username string) string {
	mac := hmac.New(sha1.New, []byte(secret))
	mac.Write([]byte(username))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// validTURNUsername reports whether a username was issued by us and has not expired.
func validTURNUsername(username string) bool {
	exp, _, ok := strings.Cut(username, ":")
	if !ok {
		return false
	}
	expiry, err := strconv.ParseInt(exp, 10, 64)
	return err == nil && time.Now().Unix() <= expiry
}

// startTURN brings up the relay on udp+tcp. It returns nil when TURN is off or
// cannot start: voice still works over STUN, so a relay failure must not stop
// the server from booting.
func (s *Server) startTURN(c turnConfig) *turn.Server {
	if !c.enabled {
		return nil
	}

	addr := ":" + strconv.Itoa(c.port)
	udp, err := net.ListenPacket("udp4", addr)
	if err != nil {
		logErr.Printf("[RTC] Cannot listen on udp%s: %v (voice falls back to STUN only)", addr, err)
		return nil
	}
	tcp, err := net.Listen("tcp4", addr)
	if err != nil {
		udp.Close()
		logErr.Printf("[RTC] Cannot listen on tcp%s: %v (voice falls back to STUN only)", addr, err)
		return nil
	}

	relay := func() turn.RelayAddressGenerator {
		return &turn.RelayAddressGeneratorPortRange{
			RelayAddress: c.publicIP,
			Address:      "0.0.0.0",
			MinPort:      uint16(c.relayMin),
			MaxPort:      uint16(c.relayMax),
		}
	}

	// Only ever relay to public addresses, so the relay cannot be used to reach
	// this server's own services or anything else on its private network. Our own
	// public IP stays permitted: that is where the other participant's relay lives.
	permit := func(_ net.Addr, peer net.IP) bool {
		return peer.Equal(c.publicIP) || isPublicIP(peer)
	}

	srv, err := turn.NewServer(turn.ServerConfig{
		Realm:         turnRealm,
		LoggerFactory: logging.NewDefaultLoggerFactory(),
		AuthHandler: func(username, realm string, _ net.Addr) ([]byte, bool) {
			if !validTURNUsername(username) {
				return nil, false
			}
			return turn.GenerateAuthKey(username, realm, turnPassword(c.secret, username)), true
		},
		PacketConnConfigs: []turn.PacketConnConfig{{
			PacketConn:            udp,
			RelayAddressGenerator: relay(),
			PermissionHandler:     permit,
		}},
		ListenerConfigs: []turn.ListenerConfig{{
			Listener:              tcp,
			RelayAddressGenerator: relay(),
			PermissionHandler:     permit,
		}},
	})
	if err != nil {
		udp.Close()
		tcp.Close()
		logErr.Printf("[RTC] Cannot start the TURN relay: %v (voice falls back to STUN only)", err)
		return nil
	}

	logInfo.Printf("[RTC] TURN relay on udp+tcp/%d (public ip %s, relay ports %d-%d)",
		c.port, c.publicIP, c.relayMin, c.relayMax)
	return srv
}

const turnRealm = "watchtogether"

// GET /api/rtc/ice: the ICE servers this user's browser should use. Credentials
// are per-user and short-lived, so this must not be cached.
func (s *Server) handleICEConfig(w http.ResponseWriter, r *http.Request) {
	sess := sessionOf(r)
	if sess == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "برای این کار باید وارد حساب کاربری شوید."})
		return
	}

	servers := make([]map[string]any, 0, 3)
	if s.turn.enabled {
		addr := net.JoinHostPort(s.turn.publicIP.String(), strconv.Itoa(s.turn.port))
		user, pass := turnCredentials(s.turn.secret, sess.UserID)
		servers = append(servers,
			map[string]any{"urls": []string{"stun:" + addr}},
			map[string]any{
				"urls": []string{
					"turn:" + addr + "?transport=udp",
					"turn:" + addr + "?transport=tcp",
				},
				"username":   user,
				"credential": pass,
			},
		)
	}
	if len(s.turn.stunURLs) > 0 {
		servers = append(servers, map[string]any{"urls": s.turn.stunURLs})
	}

	servers = append(servers, s.turn.extraICE...)

	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"iceServers": servers})
}
