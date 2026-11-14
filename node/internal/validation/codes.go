// Package validation implements zHealth node validation rules (spec Section 8).
// Only envelope-level checks are implemented so far; signature, payment, FHIR,
// privacy and consent checks are TODO.
package validation

// Code is a spec Section 8 rejection code.
type Code string

const (
	EncTooLarge     Code = "V-ENC-03"
	EnvMissingField Code = "V-ENV-01"
	EnvUnknownType  Code = "V-ENV-02"
	EnvBadTimestamp Code = "V-ENV-03"
	EnvBadDesc      Code = "V-ENV-04"
	EnvBadNonce     Code = "V-ENV-05"
	EnvFHIRPresence Code = "V-ENV-06"
)

// Error is a validation failure carrying its spec code.
type Error struct {
	Code   Code   `json:"code"`
	Detail string `json:"detail"`
}

func (e *Error) Error() string { return string(e.Code) + ": " + e.Detail }

func fail(c Code, d string) *Error { return &Error{Code: c, Detail: d} }
