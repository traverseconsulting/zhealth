package validation

import (
	"strings"
	"testing"
	"time"
)

var now = time.Date(2026, 11, 14, 16, 0, 0, 0, time.UTC)

const base = `{"zh":"1","type":"clinical.observation","element":"Observation:LOINC:882-1",
"ts":"2026-11-14T15:32:10Z","seq":3,"pubkey":"02aa","desc":"Blood type recorded",
"fhir":{"resourceType":"Observation"},"consent":{},"fee":{},
"nonce":"b64:AAAAAAAAAAAAAAAAAAAAAA==","sig":"3045"}`

func TestEnvelopeValid(t *testing.T) {
	if err := Envelope([]byte(base), now); err != nil {
		t.Fatalf("unexpected: %v", err)
	}
}

func TestEnvelopeRejections(t *testing.T) {
	cases := map[Code]string{
		EnvUnknownType:  strings.Replace(base, "clinical.observation", "clinical.bogus", 1),
		EnvBadTimestamp: strings.Replace(base, "2026-11-14T15:32:10Z", "2027-01-01T00:00:00Z", 1),
		EnvBadDesc:      strings.Replace(base, "Blood type recorded", "", 1),
		EnvBadNonce:     strings.Replace(base, "b64:AAAAAAAAAAAAAAAAAAAAAA==", "b64:AA==", 1),
		EnvFHIRPresence: strings.Replace(base, "clinical.observation", "session.start", 1),
		EnvMissingField: strings.Replace(base, `"sig":"3045"`, `"extra":1`, 1),
		EncTooLarge:     strings.Replace(base, "Blood type recorded", strings.Repeat("x", 5000), 1),
	}
	for want, raw := range cases {
		err := Envelope([]byte(raw), now)
		if err == nil || err.Code != want {
			t.Errorf("want %s, got %v", want, err)
		}
	}
}
