// Package fee implements the zHealth validation fee and per-element halving
// schedule (spec Section 6, whitepaper Section 6).
package fee

// InitialSat is the starting validation fee per event, in satoshis.
const InitialSat = 50

// HalvingInterval is the number of confirmed events for one element type
// after which that element's fee halves.
const HalvingInterval = 210_000

// Epoch returns the halving epoch for an element whose confirmed count is n.
func Epoch(n uint64) uint64 { return n / HalvingInterval }

// Sat returns the validation fee in satoshis for the next event of an element
// whose confirmed count is n: floor(50 / 2^floor(n/210000)).
func Sat(n uint64) uint64 {
	e := Epoch(n)
	if e >= 64 {
		return 0
	}
	return InitialSat >> e
}

// Acceptable reports whether a committed fee is acceptable given the fee at the
// quote reference height and at the confirmation height (spec 6.4 tolerance).
func Acceptable(paid, nAtQuote, nAtConfirm uint64) bool {
	return paid >= Sat(nAtQuote) || paid >= Sat(nAtConfirm)
}
