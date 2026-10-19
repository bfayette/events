-- Database Schema for Headless Ticketing & Loyalty Platform
-- DB-First Model with Append-Only Audit Event Logging

-- Ticket status ENUM
CREATE TYPE ticket_status AS ENUM ('ISSUED', 'ACTIVE', 'CHECKED_IN', 'REDEEMED', 'REVOKED');

-- Ticket code mode ENUM
CREATE TYPE code_mode_enum AS ENUM ('TOTP', 'STATIC');

-- Scan method ENUM
CREATE TYPE scan_method_enum AS ENUM ('TOTP', 'STATIC_QR', 'SHORT_CODE', 'LOOKUP');

-- Event action ENUM
CREATE TYPE audit_action AS ENUM (
    'ISSUE',
    'ISSUE_STATIC',
    'UPDATE',
    'CHECKIN',
    'CHECKIN_DENIED',
    'CHECKIN_OFFLINE',
    'CHECKIN_CONFLICT',
    'LOOKUP',
    'REISSUE',
    'REDEEM',
    'REVOKE'
);

-- Events Configuration Table
CREATE TABLE IF NOT EXISTS event_configurations (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    venue VARCHAR(255),
    event_date TIMESTAMP WITH TIME ZONE,
    capacity INT,
    allowed_code_modes TEXT[] DEFAULT ARRAY['TOTP'],
    retention_days INT DEFAULT 30,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tickets Table
CREATE TABLE IF NOT EXISTS tickets (
    id VARCHAR(64) PRIMARY KEY,
    event_id VARCHAR(64) NOT NULL,
    owner_email VARCHAR(255),
    secret VARCHAR(128), -- Nullable for static tickets
    seat VARCHAR(32),
    section VARCHAR(32),
    status ticket_status NOT NULL DEFAULT 'ISSUED',
    code_mode code_mode_enum NOT NULL DEFAULT 'TOTP',
    version INT NOT NULL DEFAULT 1,
    max_entries INT NOT NULL DEFAULT 1,
    entries_used INT NOT NULL DEFAULT 0,
    holder_name VARCHAR(128),
    holder_phone VARCHAR(20),
    holder_binding JSONB DEFAULT '{"type":"none"}',
    short_code_hash VARCHAR(64),
    reissue_count INT NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    checked_in_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tickets_event_id ON tickets(event_id);
CREATE INDEX idx_tickets_owner ON tickets(owner_email);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_holder_phone ON tickets(holder_phone);
CREATE INDEX idx_tickets_event_short_code ON tickets(event_id, short_code_hash);

-- Append-Only Event Audit Log Table
CREATE TABLE IF NOT EXISTS events (
    id VARCHAR(64) PRIMARY KEY,
    ticket_id VARCHAR(64) REFERENCES tickets(id),
    action audit_action NOT NULL,
    actor VARCHAR(128) NOT NULL, -- keyLabel, user_id, operator_id, or verifier_terminal_id
    payload_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of action payload / receipt
    status_transition VARCHAR(64), -- e.g. "ISSUED -> CHECKED_IN"
    method scan_method_enum,
    result VARCHAR(32),
    meta JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_events_ticket_id ON events(ticket_id);
CREATE INDEX idx_events_action ON events(action);

--------------------------------------------------------------------------------
-- Migration Section (Schema Update for Existing Deployments)
--------------------------------------------------------------------------------
-- ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'ISSUE_STATIC';
-- ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'CHECKIN_DENIED';
-- ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'LOOKUP';
-- ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'REISSUE';

-- ALTER TABLE tickets ALTER COLUMN secret DROP NOT NULL;
-- ALTER TABLE tickets ADD COLUMN IF NOT EXISTS code_mode code_mode_enum NOT NULL DEFAULT 'TOTP';
-- ALTER TABLE tickets ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
-- ALTER TABLE tickets ADD COLUMN IF NOT EXISTS max_entries INT NOT NULL DEFAULT 1;
-- ALTER TABLE tickets ADD COLUMN IF NOT EXISTS entries_used INT NOT NULL DEFAULT 0;
-- ALTER TABLE tickets ADD COLUMN IF NOT EXISTS holder_name VARCHAR(128);
-- ALTER TABLE tickets ADD COLUMN IF NOT EXISTS holder_phone VARCHAR(20);
-- ALTER TABLE tickets ADD COLUMN IF NOT EXISTS holder_binding JSONB DEFAULT '{"type":"none"}';
-- ALTER TABLE tickets ADD COLUMN IF NOT EXISTS short_code_hash VARCHAR(64);
-- ALTER TABLE tickets ADD COLUMN IF NOT EXISTS reissue_count INT NOT NULL DEFAULT 0;

-- CREATE INDEX IF NOT EXISTS idx_tickets_holder_phone ON tickets(holder_phone);
-- CREATE INDEX IF NOT EXISTS idx_tickets_event_short_code ON tickets(event_id, short_code_hash);

-- ALTER TABLE events ADD COLUMN IF NOT EXISTS method scan_method_enum;
-- ALTER TABLE events ADD COLUMN IF NOT EXISTS result VARCHAR(32);
-- ALTER TABLE events ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}';
