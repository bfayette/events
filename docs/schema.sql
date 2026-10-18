-- Database Schema for Headless Ticketing & Loyalty Platform
-- DB-First Model with Append-Only Audit Event Logging

-- Ticket status ENUM
CREATE TYPE ticket_status AS ENUM ('ISSUED', 'ACTIVE', 'CHECKED_IN', 'REDEEMED', 'REVOKED');

-- Event action ENUM
CREATE TYPE audit_action AS ENUM ('ISSUE', 'UPDATE', 'CHECKIN', 'CHECKIN_OFFLINE', 'CHECKIN_CONFLICT', 'REDEEM', 'REVOKE', 'ANCHOR');

-- Tickets Table
CREATE TABLE IF NOT EXISTS tickets (
    id VARCHAR(64) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL,
    owner_address VARCHAR(42),
    secret VARCHAR(128) NOT NULL, -- Base32 secret for TOTP
    seat VARCHAR(32),
    section VARCHAR(32),
    status ticket_status NOT NULL DEFAULT 'ISSUED',
    metadata JSONB DEFAULT '{}',
    checked_in_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tickets_event_id ON tickets(event_id);
CREATE INDEX idx_tickets_owner ON tickets(owner_address);
CREATE INDEX idx_tickets_status ON tickets(status);

-- Append-Only Event Log Table
CREATE TABLE IF NOT EXISTS events (
    id VARCHAR(64) PRIMARY KEY,
    ticket_id VARCHAR(64) REFERENCES tickets(id),
    action audit_action NOT NULL,
    actor VARCHAR(128) NOT NULL, -- user_id, operator_id, or verifier_terminal_id
    payload_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of action payload / receipt
    status_transition VARCHAR(64), -- e.g. "ISSUED -> CHECKED_IN"
    anchor_id VARCHAR(64), -- Foreign key / reference to Merkle anchor batch
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_events_ticket_id ON events(ticket_id);
CREATE INDEX idx_events_action ON events(action);
CREATE INDEX idx_events_anchor_id ON events(anchor_id) WHERE anchor_id IS NULL;

-- Merkle Anchors Table (Optional On-Chain Anchoring)
CREATE TABLE IF NOT EXISTS anchors (
    id VARCHAR(64) PRIMARY KEY,
    merkle_root VARCHAR(66) NOT NULL, -- 0x... 32-byte hex string
    batch_size INT NOT NULL,
    chain_id INT NOT NULL,
    tx_hash VARCHAR(66) NOT NULL, -- On-chain transaction hash
    block_number BIGINT,
    anchored_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
