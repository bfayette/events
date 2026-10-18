-- Database Schema for Headless Ticketing & Loyalty Platform
-- DB-First Model with Append-Only Audit Event Logging

-- Ticket status ENUM
CREATE TYPE ticket_status AS ENUM ('ISSUED', 'ACTIVE', 'CHECKED_IN', 'REDEEMED', 'REVOKED');

-- Event action ENUM
CREATE TYPE audit_action AS ENUM ('ISSUE', 'UPDATE', 'CHECKIN', 'CHECKIN_OFFLINE', 'CHECKIN_CONFLICT', 'REDEEM', 'REVOKE');

-- Tickets Table
CREATE TABLE IF NOT EXISTS tickets (
    id VARCHAR(64) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL,
    owner_email VARCHAR(255),
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
CREATE INDEX idx_tickets_owner ON tickets(owner_email);
CREATE INDEX idx_tickets_status ON tickets(status);

-- Append-Only Event Log Table
CREATE TABLE IF NOT EXISTS events (
    id VARCHAR(64) PRIMARY KEY,
    ticket_id VARCHAR(64) REFERENCES tickets(id),
    action audit_action NOT NULL,
    actor VARCHAR(128) NOT NULL, -- user_id, operator_id, or verifier_terminal_id
    payload_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of action payload / receipt
    status_transition VARCHAR(64), -- e.g. "ISSUED -> CHECKED_IN"
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_events_ticket_id ON events(ticket_id);
CREATE INDEX idx_events_action ON events(action);
