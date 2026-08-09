/**
 * The store schema contract: recognize an owned database, migrate it in
 * order, and reject shapes or versions this package cannot interpret.
 * Operational state transitions remain in store.ts.
 */

import type { DatabaseSync } from "node:sqlite";

/** The newest storage schema this package can safely read and write. */
export const CURRENT_STORAGE_SCHEMA_VERSION = 4;

/** A deliberate interruption point after one migration step. */
export type MigrationFaultPoint = "migration:1" | "migration:2" | "migration:3" | "migration:4";

type FaultInjector = (point: MigrationFaultPoint) => void;

const TABLES_BY_VERSION = {
    1: ["effect_claim", "effect_journal", "schedule", "seen_delivery"],
    2: ["effect_claim", "effect_journal", "schedule", "seen_delivery"],
    3: ["effect_claim", "effect_journal", "schedule", "seen_delivery"],
    4: ["delivery_report", "effect_claim", "effect_journal", "schedule", "seen_delivery"],
} as const;

const COLUMNS = {
    effectClaim: ["effect_id", "worker", "at"],
    effectJournalV1: ["effect_id", "call_seq", "intent", "status", "at"],
    effectJournalV2: ["effect_id", "call_seq", "intent", "status", "at", "attempt", "revision"],
    scheduleV1: ["schedule_id", "due_at", "effect", "status"],
    scheduleV2: ["schedule_id", "due_at", "effect", "status", "claimed_at", "claim_token"],
    seenDeliveryV1: ["delivery_id", "at"],
    seenDeliveryV3: [
        "delivery_id",
        "event_name",
        "payload",
        "payload_digest",
        "received_at",
        "state",
        "claim_worker",
        "claim_token",
        "claimed_at",
        "completed_at",
    ],
    deliveryReportV4: ["delivery_id", "claim_token", "report_json", "completed_at"],
} as const;

const MIGRATIONS: ReadonlyArray<{
    readonly version: 1 | 2 | 3 | 4;
    readonly apply: (db: DatabaseSync) => void;
}> = [
    { version: 1, apply: createOriginalOperationalSchema },
    { version: 2, apply: addRecoveryOwnershipState },
    { version: 3, apply: addDurableDeliveryWork },
    { version: 4, apply: addCanonicalDeliveryReports },
];

/** Read SQLite's native application schema version. */
export function readStorageSchemaVersion(db: DatabaseSync): number {
    const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
    if (row === undefined || !Number.isInteger(row.user_version)) {
        throw new Error("could not read the storage schema version");
    }
    return row.user_version;
}

/** Refuse a database whose declared format is newer than this package. */
export function assertSupportedStorageSchemaVersion(version: number): void {
    if (version > CURRENT_STORAGE_SCHEMA_VERSION) {
        throw new Error(
            `storage schema version ${String(version)} is newer than supported version ${String(CURRENT_STORAGE_SCHEMA_VERSION)}`,
        );
    }
}

/** Bring every recognized owned schema to the current version in one transaction. */
export function migrateStorageSchema(
    db: DatabaseSync,
    injectFault: FaultInjector = () => {},
): void {
    const declaredVersion = readStorageSchemaVersion(db);
    assertSupportedStorageSchemaVersion(declaredVersion);

    db.exec("BEGIN IMMEDIATE");
    try {
        let version = declaredVersion;
        if (version === 0) {
            version = detectUnversionedSchema(db);
            if (version > 0) setVersion(db, version);
        } else {
            assertSchemaMatchesVersion(db, version);
        }

        for (const migration of MIGRATIONS) {
            if (migration.version <= version) continue;
            migration.apply(db);
            setVersion(db, migration.version);
            injectFault(`migration:${String(migration.version)}` as MigrationFaultPoint);
            version = migration.version;
        }

        assertSchemaMatchesVersion(db, CURRENT_STORAGE_SCHEMA_VERSION);
        db.exec("COMMIT");
    } catch (error) {
        try {
            db.exec("ROLLBACK");
        } catch {
            // Preserve the migration failure.
        }
        throw error;
    }
}

function detectUnversionedSchema(db: DatabaseSync): number {
    const tables = tableNames(db);
    if (tables.length === 0) return 0;
    for (const version of [1, 2, 3] as const) {
        if (schemaMatchesVersion(db, version)) return version;
    }
    throw new Error("unrecognized unversioned storage schema");
}

function assertSchemaMatchesVersion(db: DatabaseSync, version: number): void {
    if (!schemaMatchesVersion(db, version)) {
        throw new Error(`storage schema does not match declared version ${String(version)}`);
    }
}

function schemaMatchesVersion(db: DatabaseSync, version: number): boolean {
    if (version < 1 || version > CURRENT_STORAGE_SCHEMA_VERSION) return false;
    const expectedTables = TABLES_BY_VERSION[version as keyof typeof TABLES_BY_VERSION];
    if (!sameValues(tableNames(db), expectedTables)) return false;

    const recoveryColumns = version === 1 ? COLUMNS.effectJournalV1 : COLUMNS.effectJournalV2;
    const scheduleColumns = version === 1 ? COLUMNS.scheduleV1 : COLUMNS.scheduleV2;
    const deliveryColumns = version < 3 ? COLUMNS.seenDeliveryV1 : COLUMNS.seenDeliveryV3;

    return (
        columnsMatch(db, "effect_claim", COLUMNS.effectClaim) &&
        columnsMatch(db, "effect_journal", recoveryColumns) &&
        columnsMatch(db, "schedule", scheduleColumns) &&
        columnsMatch(db, "seen_delivery", deliveryColumns) &&
        (version < 4 || columnsMatch(db, "delivery_report", COLUMNS.deliveryReportV4))
    );
}

function tableNames(db: DatabaseSync): string[] {
    return (
        db
            .prepare(
                `
        SELECT name FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `,
            )
            .all() as { name: string }[]
    ).map((row) => row.name);
}

function columnsMatch(db: DatabaseSync, table: string, expected: readonly string[]): boolean {
    const actual = (
        db.prepare(`PRAGMA table_info(${table})`).all() as {
            name: string;
        }[]
    ).map((column) => column.name);
    return sameValues(actual, expected);
}

function sameValues(actual: readonly string[], expected: readonly string[]): boolean {
    return (
        actual.length === expected.length &&
        actual.every((value, index) => value === expected[index])
    );
}

function setVersion(db: DatabaseSync, version: number): void {
    db.exec(`PRAGMA user_version = ${String(version)}`);
}

function createOriginalOperationalSchema(db: DatabaseSync): void {
    db.exec(`
        CREATE TABLE seen_delivery (
            delivery_id TEXT PRIMARY KEY,
            at          TEXT NOT NULL
        );
        CREATE TABLE effect_journal (
            effect_id TEXT NOT NULL,
            call_seq  INTEGER NOT NULL,
            intent    TEXT NOT NULL,
            status    TEXT NOT NULL CHECK (status IN ('sent', 'done')),
            at        TEXT NOT NULL,
            PRIMARY KEY (effect_id, call_seq)
        );
        CREATE TABLE effect_claim (
            effect_id TEXT PRIMARY KEY,
            worker    TEXT NOT NULL,
            at        TEXT NOT NULL
        );
        CREATE TABLE schedule (
            schedule_id TEXT PRIMARY KEY,
            due_at      TEXT NOT NULL,
            effect      TEXT NOT NULL,
            status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done'))
        );
    `);
}

function addRecoveryOwnershipState(db: DatabaseSync): void {
    db.exec(`
        ALTER TABLE effect_journal RENAME TO effect_journal_v1;
        CREATE TABLE effect_journal (
            effect_id TEXT NOT NULL,
            call_seq  INTEGER NOT NULL,
            intent    TEXT NOT NULL,
            status    TEXT NOT NULL CHECK (status IN ('sent', 'done')),
            at        TEXT NOT NULL,
            attempt   INTEGER NOT NULL,
            revision  TEXT NOT NULL,
            PRIMARY KEY (effect_id, call_seq)
        );
        INSERT INTO effect_journal
            SELECT effect_id, call_seq, intent, status, at, 1, 'legacy:unknown'
            FROM effect_journal_v1;
        DROP TABLE effect_journal_v1;

        ALTER TABLE schedule RENAME TO schedule_v1;
        CREATE TABLE schedule (
            schedule_id TEXT PRIMARY KEY,
            due_at      TEXT NOT NULL,
            effect      TEXT NOT NULL,
            status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done')),
            claimed_at  TEXT,
            claim_token TEXT
        );
        INSERT INTO schedule
            SELECT schedule_id, due_at, effect,
                   CASE status WHEN 'running' THEN 'pending' ELSE status END,
                   NULL, NULL
            FROM schedule_v1;
        DROP TABLE schedule_v1;

        CREATE INDEX open_intents
            ON effect_journal(at) WHERE status = 'sent';
    `);
}

function addDurableDeliveryWork(db: DatabaseSync): void {
    db.exec(`
        ALTER TABLE seen_delivery RENAME TO seen_delivery_v2;
        CREATE TABLE seen_delivery (
            delivery_id   TEXT PRIMARY KEY,
            event_name    TEXT NOT NULL,
            payload       BLOB,
            payload_digest TEXT NOT NULL,
            received_at   TEXT NOT NULL,
            state         TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'done')),
            claim_worker  TEXT,
            claim_token   TEXT,
            claimed_at    TEXT,
            completed_at  TEXT,
            CHECK (
                (state = 'pending' AND payload IS NOT NULL
                    AND claim_worker IS NULL AND claim_token IS NULL
                    AND claimed_at IS NULL AND completed_at IS NULL)
                OR
                (state = 'processing' AND payload IS NOT NULL
                    AND claim_worker IS NOT NULL AND claim_token IS NOT NULL
                    AND claimed_at IS NOT NULL AND completed_at IS NULL)
                OR
                (state = 'done' AND payload IS NULL
                    AND claim_worker IS NULL AND claim_token IS NULL
                    AND claimed_at IS NULL AND completed_at IS NOT NULL)
            )
        );
        INSERT INTO seen_delivery (
            delivery_id, event_name, payload, payload_digest, received_at,
            state, claim_worker, claim_token, claimed_at, completed_at
        )
        SELECT delivery_id, 'legacy.unknown', NULL,
               '0000000000000000000000000000000000000000000000000000000000000000',
               at, 'done', NULL, NULL, NULL, at
        FROM seen_delivery_v2;
        DROP TABLE seen_delivery_v2;

        CREATE INDEX delivery_work
            ON seen_delivery(state, received_at, delivery_id);
    `);
}

function addCanonicalDeliveryReports(db: DatabaseSync): void {
    db.exec(`
        CREATE TABLE delivery_report (
            delivery_id TEXT PRIMARY KEY,
            claim_token TEXT NOT NULL,
            report_json TEXT NOT NULL,
            completed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS open_intents
            ON effect_journal(at) WHERE status = 'sent';
        CREATE INDEX IF NOT EXISTS delivery_work
            ON seen_delivery(state, received_at, delivery_id);
    `);
}
