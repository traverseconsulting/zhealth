package fee

import "testing"

func TestSatSchedule(t *testing.T) {
	cases := []struct{ n, want uint64 }{
		{0, 50}, {209_999, 50}, {210_000, 25}, {419_999, 25}, {420_000, 12},
		{630_000, 6}, {840_000, 3}, {1_050_000, 1}, {1_259_999, 1}, {1_260_000, 0},
		{^uint64(0), 0},
	}
	for _, c := range cases {
		if got := Sat(c.n); got != c.want {
			t.Errorf("Sat(%d) = %d, want %d", c.n, got, c.want)
		}
	}
}

func TestAcceptableTolerance(t *testing.T) {
	// Quoted at 50 before the halving, confirmed after: 50 still fine.
	if !Acceptable(50, 209_999, 210_000) {
		t.Fatal("expected acceptable")
	}
	// Quoted after halving (25), confirmed in same epoch: 25 fine.
	if !Acceptable(25, 210_001, 210_005) {
		t.Fatal("expected acceptable")
	}
	// Underpayment.
	if Acceptable(24, 210_001, 210_005) {
		t.Fatal("expected rejection")
	}
}
