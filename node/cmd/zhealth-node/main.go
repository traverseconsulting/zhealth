// Command zhealth-node runs a zHealth overlay node (scaffold).
package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/traverseconsulting/zhealth/node/internal/fee"
	"github.com/traverseconsulting/zhealth/node/internal/validation"
)

const version = "0.0.1"

func main() {
	addr := os.Getenv("ZHEALTH_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /v1/info", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"version":   version,
			"protocol":  "1",
			"validator": os.Getenv("ZHEALTH_VALIDATOR_ADDRESS"),
			"platform":  "teranode",
		})
	})

	// GET /v1/elements/{element}?n=<count> — fee for a given confirmed count.
	// TODO: read n from the element index instead of the query string.
	mux.HandleFunc("GET /v1/elements/{element}", func(w http.ResponseWriter, r *http.Request) {
		n, _ := strconv.ParseUint(r.URL.Query().Get("n"), 10, 64)
		writeJSON(w, http.StatusOK, map[string]any{
			"element":        r.PathValue("element"),
			"n":              n,
			"epoch":          fee.Epoch(n),
			"validation_sat": fee.Sat(n),
		})
	})

	// POST /v1/validate — dry-run validation (envelope rules only so far).
	mux.HandleFunc("POST /v1/validate", func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(io.LimitReader(r.Body, validation.MaxEventBytes+1))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if verr := validation.Envelope(raw, time.Now().UTC()); verr != nil {
			writeJSON(w, http.StatusUnprocessableEntity, verr)
			return
		}
		writeJSON(w, http.StatusOK, map[string]bool{"valid": true})
	})

	log.Printf("zhealth-node %s listening on %s", version, addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
