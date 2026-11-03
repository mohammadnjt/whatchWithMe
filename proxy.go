package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var errPrivateAddress = errors.New("دسترسی به آدرس‌های داخلی سرور یا شبکه محلی مجاز نیست.")

// allowPrivateUpstream (PROXY_ALLOW_PRIVATE=true) lets the link tools reach LAN/loopback hosts,
// e.g. a NAS on the local network. Off by default so users cannot probe the server's network
// (the BAS panel, other apps, cloud metadata endpoints).
var allowPrivateUpstream = strings.EqualFold(strings.TrimSpace(os.Getenv("PROXY_ALLOW_PRIVATE")), "true")

var blockedNets = func() []*net.IPNet {
	var nets []*net.IPNet
	for _, cidr := range []string{
		"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15",
		"198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "64:ff9b::/96", "2001:db8::/32",
	} {
		_, n, _ := net.ParseCIDR(cidr)
		nets = append(nets, n)
	}
	return nets
}()

func isPublicIP(ip net.IP) bool {
	if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() || ip.IsMulticast() {
		return false
	}
	for _, n := range blockedNets {
		if n.Contains(ip) {
			return false
		}
	}
	return true
}

// guardDial runs after DNS resolution for every connection (including each redirect hop),
// so neither hostnames pointing inward nor DNS rebinding can reach internal addresses.
func guardDial(network, address string, _ syscall.RawConn) error {
	if allowPrivateUpstream {
		return nil
	}
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return errPrivateAddress
	}
	if !isPublicIP(net.ParseIP(host)) {
		return errPrivateAddress
	}
	return nil
}

// upstreamClient fetches remote videos. Redirects are followed by fetchRemote itself,
// compression is off so Range and Content-Length pass through untouched, and
// certificate errors are ignored like in the original server (many video hosts have broken TLS).
// Proxy environment variables are ignored, as in the original server: a proxy would bypass guardDial.
var upstreamClient = &http.Client{
	Transport: &http.Transport{
		DialContext: (&net.Dialer{
			Timeout: 15 * time.Second, KeepAlive: 30 * time.Second, Control: guardDial,
		}).DialContext,
		TLSClientConfig:       &tls.Config{InsecureSkipVerify: true},
		TLSHandshakeTimeout:   15 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		DisableCompression:    true,
		MaxIdleConnsPerHost:   4,
		IdleConnTimeout:       90 * time.Second,
	},
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

var (
	errTooManyRedirects = errors.New("تعداد تغییر مسیرها بیش از حد مجاز (Too many redirects) است.")
	errInvalidURL       = errors.New("آدرس URL معتبر نمی‌باشد.")
	errUpstreamTimeout  = errors.New("مهلت زمانی اتصال به سرور مبدا به پایان رسید (Connection Timeout).")
)

// fetchRemote GETs target with browser-like headers, following up to 5 redirects.
// It returns the response and the final URL. The caller closes the body.
func fetchRemote(ctx context.Context, target, rangeHeader string) (*http.Response, string, error) {
	current := target
	for redirects := 0; ; redirects++ {
		if redirects > 5 {
			return nil, "", errTooManyRedirects
		}
		u, err := url.Parse(current)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return nil, "", errInvalidURL
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return nil, "", errInvalidURL
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
		req.Header.Set("Accept", "*/*")
		req.Header.Set("Accept-Language", "en-US,en;q=0.9,fa;q=0.8")
		req.Header.Set("Referer", u.Scheme+"://"+u.Host+"/")
		if rangeHeader != "" {
			req.Header.Set("Range", rangeHeader)
		}

		resp, err := upstreamClient.Do(req)
		if err != nil {
			if errors.Is(err, errPrivateAddress) {
				return nil, "", errPrivateAddress
			}
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				return nil, "", errUpstreamTimeout
			}
			var ue *url.Error
			if errors.As(err, &ue) {
				return nil, "", ue.Err
			}
			return nil, "", err
		}

		switch resp.StatusCode {
		case 301, 302, 303, 307, 308:
			if loc := resp.Header.Get("Location"); loc != "" {
				resp.Body.Close()
				next, err := u.Parse(loc)
				if err != nil {
					return nil, "", errInvalidURL
				}
				current = next.String()
				continue
			}
		}
		return resp, current, nil
	}
}

func statusText(resp *http.Response) string {
	return strings.TrimPrefix(resp.Status, strconv.Itoa(resp.StatusCode)+" ")
}

// GET /api/proxy-stream?url=...: streams a remote video through this server with CORS and Range support.
func (s *Server) handleProxyStream(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("url")
	if target == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "آدرس URL ویدیو مشخص نشده است."})
		return
	}

	resp, _, err := fetchRemote(r.Context(), target, r.Header.Get("Range"))
	if err != nil {
		if r.Context().Err() == nil {
			logErr.Printf("[Proxy-Stream] Error: %v", err)
		}
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"error": "اتصال به سرور ویدیو ناموفق بود: " + err.Error(), "details": err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	h := w.Header()
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	h.Set("Access-Control-Allow-Headers", "Range, Accept, Origin, Content-Type")
	h.Set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges")
	h.Set("Accept-Ranges", "bytes")

	if resp.StatusCode >= 400 {
		desc := fmt.Sprintf("خطای %d", resp.StatusCode)
		switch resp.StatusCode {
		case 403:
			desc = "دسترسی غیرمجاز (403 Forbidden / مسدود توسط سرور مبدا)"
		case 404:
			desc = "فایل در سرور مبدا یافت نشد (404 Not Found)"
		case 503:
			desc = "سرور مبدا موقتا در دسترس نیست (503 Service Unavailable)"
		}
		writeJSON(w, resp.StatusCode, map[string]any{
			"error":      "خطا در دریافت ویدیو از سرور میزبان: " + desc,
			"statusCode": resp.StatusCode,
			"statusText": statusText(resp),
		})
		return
	}

	if v := resp.Header.Get("Content-Range"); v != "" {
		h.Set("Content-Range", v)
	}
	if v := resp.Header.Get("Content-Length"); v != "" {
		h.Set("Content-Length", v)
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "video/mp4"
	}
	if strings.HasSuffix(target, ".mkv") || strings.Contains(target, ".mkv?") {
		contentType = "video/x-matroska"
	} else if strings.HasSuffix(target, ".webm") {
		contentType = "video/webm"
	}
	h.Set("Content-Type", contentType)
	w.WriteHeader(resp.StatusCode)

	// Ends when either side closes; r.Context() cancels the upstream request on client disconnect.
	io.Copy(w, resp.Body)
}

var videoExtRe = regexp.MustCompile(`(?i)\.(mp4|mkv|webm|avi|mov)(\?|$)`)

// POST /api/check-url: probes a remote link and reports status, type and size.
func (s *Server) handleCheckURL(w http.ResponseWriter, r *http.Request) {
	target, ok := readJSON(r)["url"].(string)
	if !ok || target == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "آدرس URL الزامی است."})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	resp, finalURL, err := fetchRemote(ctx, target, "bytes=0-1024")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"success": false, "statusCode": 0, "statusMessage": "Connection Failed", "contentType": "none",
			"contentLength": 0, "formattedSize": "0 B", "finalUrl": target, "isVideo": false,
			"message": "امکان اتصال به سرور وجود ندارد: " + err.Error(),
		})
		return
	}
	resp.Body.Close()

	status := resp.StatusCode
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "نامشخص"
	}
	contentLength, _ := strconv.ParseInt(resp.Header.Get("Content-Length"), 10, 64)
	if contentLength < 0 {
		contentLength = 0
	}
	isVideo := strings.Contains(contentType, "video") || strings.Contains(contentType, "octet-stream") ||
		videoExtRe.MatchString(finalURL)

	message := "سرور مقصد فعال و پاسخگو است."
	reachable := true
	switch {
	case status == 503:
		message = "سرور مبدا خطای ۵۰۳ (Service Unavailable) بازگرداند. این سرور دانلود موقتا از دسترس خارج است یا ترافیک مستقیم را مسدود کرده است."
		reachable = false
	case status == 403:
		message = "سرور مبدا خطای ۴۰۳ (Forbidden) داد. دسترسی مستقیم یا خارج از دامنه مسدود است (Hotlink Protection)."
		reachable = false
	case status == 404:
		message = "فایل در سرور مبدا یافت نشد (خطای ۴۰۴). لینک احتمالا منقضی شده یا اشتباه است."
		reachable = false
	case status >= 400:
		message = fmt.Sprintf("سرور مبدا کد خطای %d بازگرداند.", status)
		reachable = false
	case !isVideo && !strings.Contains(contentType, "application/"):
		message = fmt.Sprintf("سرور مبدا به جای ویدیو، فایل متنی/وب با فرمت %s بازگرداند (احتمالاً صفحه لاگین یا کپچا).", contentType)
		reachable = false
	}

	formatted := "نامشخص"
	if contentLength > 0 {
		formatted = formatBytes(contentLength)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": reachable, "statusCode": status, "statusMessage": statusText(resp), "contentType": contentType,
		"contentLength": contentLength, "formattedSize": formatted, "finalUrl": finalURL, "isVideo": isVideo,
		"message": message,
	})
}
