package main

import (
	"strings"
	"testing"

	"golang.org/x/text/encoding/charmap"
)

func TestSRTToWebVTT(t *testing.T) {
	srt := "1\n" +
		"00:00:01,000 --> 00:00:04,500\n" +
		"سلام دنیا\n" +
		"خط دوم\n" +
		"\n" +
		"2\n" +
		"00:01:02,250 --> 00:01:05,000\n" +
		"<i>متن کج</i>\n"

	got, err := toWebVTT([]byte(srt), "fa.srt")
	if err != nil {
		t.Fatalf("toWebVTT: %v", err)
	}
	out := string(got)

	if !strings.HasPrefix(out, "WEBVTT\n") {
		t.Errorf("missing WEBVTT signature:\n%s", out)
	}
	// Commas must become periods or browsers reject the cue.
	if strings.Contains(out, ",") {
		t.Errorf("comma left in timings:\n%s", out)
	}
	for _, want := range []string{
		"00:00:01.000 --> 00:00:04.500",
		"00:01:02.250 --> 00:01:05.000",
		"سلام دنیا\nخط دوم",
		"<i>متن کج</i>",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	// The SRT cue numbers must not survive as cue text.
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == "1" || strings.TrimSpace(line) == "2" {
			t.Errorf("SRT index leaked into cue text:\n%s", out)
		}
	}
}

func TestSRTShortTimestampsAndNoHour(t *testing.T) {
	// Some files omit the hour field and use fewer than three decimals.
	srt := "1\n01:02,5 --> 01:04,75\nمتن\n"
	got, err := toWebVTT([]byte(srt), "x.srt")
	if err != nil {
		t.Fatalf("toWebVTT: %v", err)
	}
	if !strings.Contains(string(got), "00:01:02.500 --> 00:01:04.750") {
		t.Errorf("short timestamps not normalised:\n%s", got)
	}
}

func TestWindows1256IsDecoded(t *testing.T) {
	// Persian subtitles are commonly distributed in Windows-1256, not UTF-8.
	persian := "سلام"
	encoded, err := charmap.Windows1256.NewEncoder().Bytes([]byte(persian))
	if err != nil {
		t.Skipf("cannot encode sample: %v", err)
	}
	srt := append([]byte("1\n00:00:01,000 --> 00:00:02,000\n"), encoded...)

	got, err := toWebVTT(append(srt, '\n'), "fa.srt")
	if err != nil {
		t.Fatalf("toWebVTT: %v", err)
	}
	if !strings.Contains(string(got), persian) {
		t.Errorf("Windows-1256 text not decoded, got:\n%s", got)
	}
}

func TestUTF8BOMStripped(t *testing.T) {
	srt := "\xef\xbb\xbf1\n00:00:01,000 --> 00:00:02,000\nhello\n"
	got, err := toWebVTT([]byte(srt), "x.srt")
	if err != nil {
		t.Fatalf("toWebVTT: %v", err)
	}
	if !strings.HasPrefix(string(got), "WEBVTT") {
		t.Errorf("BOM not stripped before the signature: %q", string(got[:16]))
	}
}

func TestASSToWebVTT(t *testing.T) {
	ass := "[Script Info]\nTitle: x\n\n[Events]\n" +
		"Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" +
		`Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\pos(190,230)}خط اول\Nخط دوم` + "\n" +
		`Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,متن، با ویرگول` + "\n"

	got, err := toWebVTT([]byte(ass), "fa.ass")
	if err != nil {
		t.Fatalf("toWebVTT: %v", err)
	}
	out := string(got)

	for _, want := range []string{
		"00:00:01.000 --> 00:00:03.500",
		"00:00:04.000 --> 00:00:05.000",
		"خط اول\nخط دوم",
		// Text is the last column, so commas inside it must be preserved.
		"متن، با ویرگول",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	// Override blocks are styling directives, not dialogue.
	if strings.Contains(out, `\pos`) || strings.Contains(out, "{") {
		t.Errorf("ASS override block leaked into cue text:\n%s", out)
	}
}

func TestExistingVTTPassesThrough(t *testing.T) {
	vtt := "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n"
	got, err := toWebVTT([]byte(vtt), "x.vtt")
	if err != nil {
		t.Fatalf("toWebVTT: %v", err)
	}
	if !strings.Contains(string(got), "00:00:01.000 --> 00:00:02.000") {
		t.Errorf("cue lost on pass-through:\n%s", got)
	}
}

func TestGarbageIsRejected(t *testing.T) {
	if _, err := toWebVTT([]byte("this is not a subtitle file"), "x.srt"); err == nil {
		t.Error("expected an error for a file with no cues")
	}
}

func TestLooksPersian(t *testing.T) {
	fa := []byte(strings.Repeat("سلام دنیا این یک متن فارسی است ", 5))
	if !looksPersian(fa) {
		t.Error("Persian text not detected")
	}
	en := []byte(strings.Repeat("the quick brown fox jumps over it ", 5))
	if looksPersian(en) {
		t.Error("English text misdetected as Persian")
	}
	// A subtitle with only a cue or two is still unambiguous, and the Latin
	// letters of the WEBVTT header must not tip the balance.
	short := []byte("WEBVTT\n\n00:00:05.000 --> 00:00:08.000\nمتن آزمایشی\n")
	if !looksPersian(short) {
		t.Error("short Persian subtitle not detected")
	}
	// Nothing to judge: neither script present.
	if looksPersian([]byte("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n...\n")) {
		t.Error("text with no Persian detected as Persian")
	}
}

func TestNormalizeLang(t *testing.T) {
	for in, want := range map[string]string{
		"per": "fa", "fas": "fa", "fa": "fa",
		"eng": "en", "en": "en",
		"und": "", "": "",
	} {
		if got := normalizeLang(in); got != want {
			t.Errorf("normalizeLang(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestTURNCredentialsRoundTrip(t *testing.T) {
	const secret = "test-secret"
	user, pass := turnCredentials(secret, "user-42")

	if !validTURNUsername(user) {
		t.Errorf("freshly minted username %q rejected", user)
	}
	if pass != turnPassword(secret, user) {
		t.Error("password does not match an HMAC of its own username")
	}
	if !strings.HasSuffix(user, ":user-42") {
		t.Errorf("username %q does not carry the user id", user)
	}
	// An expiry in the past must not be accepted.
	if validTURNUsername("1000000000:user-42") {
		t.Error("expired username accepted")
	}
	if validTURNUsername("not-a-timestamp:user") {
		t.Error("malformed username accepted")
	}
}
