// Package teranode defines the Teranode services a zHealth node depends on
// (spec 2.1, ADR 0001). Implementations are TODO; these interfaces keep the
// rest of the node testable with fakes.
//
// Reference: https://bsv-blockchain.github.io/teranode/topics/architecture/teranode-microservices-overview/
package teranode

import "context"

// Propagation submits raw (extended format) transactions to Teranode's
// Propagation Service over gRPC or HTTP.
type Propagation interface {
	SubmitTx(ctx context.Context, rawTx []byte) (txid string, err error)
}

// Asset reads chain data from Teranode's Asset Server (HTTP/WebSocket).
type Asset interface {
	GetTransaction(ctx context.Context, txid string) ([]byte, error)
	GetBestBlockHeader(ctx context.Context) (BlockHeader, error)
	GetBlockHeader(ctx context.Context, hash string) (BlockHeader, error)
	GetBlock(ctx context.Context, hash string) ([]byte, error)
	GetSubtree(ctx context.Context, hash string) ([]byte, error)
}

// BlockHeader is the subset of header data zHealth needs.
type BlockHeader struct {
	Hash       string
	PrevHash   string
	MerkleRoot string
	Height     uint32
}

// NotificationType mirrors Blockchain Service notification kinds zHealth uses.
type NotificationType int

const (
	BlockAdded NotificationType = iota
	BlockInvalidated
	Reorg
)

// Notification is a chain-state change from the Blockchain Service Subscribe stream.
type Notification struct {
	Type      NotificationType
	BlockHash string
}

// Blockchain subscribes to the Blockchain Service gRPC Subscribe stream.
// The Chain Watcher uses it to keep element counts and the pubkey index
// reorg-safe.
type Blockchain interface {
	Subscribe(ctx context.Context) (<-chan Notification, error)
}
