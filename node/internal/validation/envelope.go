package validation

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"
)

// MaxEventBytes is the serialized event size limit (spec 5.1).
const MaxEventBytes = 4096

// fhirRule says whether an event type requires, forbids, or allows `fhir`.
type fhirRule int

const (
	fhirForbidden fhirRule = iota
	fhirRequired
	fhirOptional
)

// Types is the event type registry (spec 5.2).
var Types = map[string]fhirRule{
	"session.start":         fhirForbidden,
	"session.end":           fhirForbidden,
	"appointment.schedule":  fhirRequired,
	"appointment.update":    fhirRequired,
	"demographics.update":   fhirRequired,
	"clinical.observation":  fhirRequired,
	"clinical.allergy":      fhirRequired,
	"clinical.immunization": fhirRequired,
	"clinical.medication":   fhirRequired,
	"clinical.diagnosis":    fhirRequired,
	"clinical.imaging":      fhirRequired,
	"clinical.careplan":     fhirRequired,
	"record.view":           fhirOptional,
	"fhir.element":          fhirRequired,
	"service.dispatch":      fhirRequired,
}

var required = []string{"zh", "type", "ts", "seq", "pubkey", "desc", "consent", "fee", "nonce", "sig"}

var allowed = map[string]bool{
	"zh": true, "type": true, "element": true, "ts": true, "seq": true, "pubkey": true,
	"desc": true, "fhir": true, "consent": true, "fee": true, "nonce": true, "sig": true,
}

// Envelope runs spec 8.1 (size) and 8.2 (envelope) checks on raw event JSON.
// now is the node's current time, used for the V-ENV-03 window.
func Envelope(raw []byte, now time.Time) *Error {
	if len(raw) > MaxEventBytes {
		return fail(EncTooLarge, "event exceeds 4096 bytes")
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return fail(EnvMissingField, "not a JSON object: "+err.Error())
	}
	for _, k := range required {
		if _, ok := m[k]; !ok {
			return fail(EnvMissingField, "missing field "+k)
		}
	}
	for k := range m {
		if !allowed[k] {
			return fail(EnvMissingField, "unknown field "+k)
		}
	}
	var zh, typ, ts, desc, nonce string
	for k, dst := range map[string]*string{"zh": &zh, "type": &typ, "ts": &ts, "desc": &desc, "nonce": &nonce} {
		if err := json.Unmarshal(m[k], dst); err != nil {
			return fail(EnvMissingField, k+" must be a string")
		}
	}
	if zh != "1" {
		return fail(EnvMissingField, "unsupported zh version")
	}
	rule, ok := Types[typ]
	if !ok {
		return fail(EnvUnknownType, "unknown type "+typ)
	}
	t, err := time.Parse(time.RFC3339, ts)
	if err != nil || !strings.HasSuffix(ts, "Z") {
		return fail(EnvBadTimestamp, "ts must be RFC 3339 UTC")
	}
	if t.After(now.Add(2*time.Hour)) || t.Before(now.Add(-30*24*time.Hour)) {
		return fail(EnvBadTimestamp, "ts outside accepted window")
	}
	if n := utf8.RuneCountInString(desc); n < 1 || n > 140 {
		return fail(EnvBadDesc, "desc must be 1-140 characters")
	}
	b, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(nonce, "b64:"))
	if !strings.HasPrefix(nonce, "b64:") || err != nil || len(b) != 16 {
		return fail(EnvBadNonce, "nonce must be b64: + 16 bytes")
	}
	_, hasFHIR := m["fhir"]
	switch {
	case rule == fhirForbidden && hasFHIR:
		return fail(EnvFHIRPresence, "fhir not allowed for "+typ)
	case rule == fhirRequired && !hasFHIR:
		return fail(EnvFHIRPresence, "fhir required for "+typ)
	}
	return nil
}
