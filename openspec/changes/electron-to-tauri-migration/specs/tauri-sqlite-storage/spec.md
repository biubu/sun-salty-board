## ADDED Requirements

### Requirement: SQLite database with FTS5 full-text search
The system SHALL use SQLite with FTS5 extension for local clipboard history storage.

#### Scenario: Database initialization
- **WHEN** the application starts
- **THEN** the SQLite database SHALL be opened (or created) with all required tables

#### Scenario: Item storage
- **WHEN** a new clipboard item is captured
- **THEN** it SHALL be inserted into the items table with type, content, fingerprint, and timestamp

#### Scenario: Full-text search
- **WHEN** user types a search query
- **THEN** the system SHALL use FTS5 to return matching clipboard items ranked by relevance

#### Scenario: FTS5 with CJK support
- **WHEN** the search query contains CJK characters
- **THEN** FTS5 SHALL correctly tokenize and match CJK text

### Requirement: Write queue with batch flushing
The system SHALL use a write queue that batches inserts and flushes either when 50 items accumulate or after 2 seconds of idle time.

#### Scenario: Batch insert
- **WHEN** 50 clipboard items are queued
- **THEN** they SHALL be flushed to the database in a single transaction

#### Scenario: Idle flush
- **WHEN** 2 seconds have passed since the last item was queued
- **THEN** all queued items SHALL be flushed to the database

### Requirement: Periodic expiration sweep
The system SHALL periodically (every hour) delete clipboard items older than the configured retention period (default 365 days).

#### Scenario: Expired items deleted
- **WHEN** the hourly sweep runs
- **THEN** items older than the retention period SHALL be deleted

### Requirement: Categories and item-category associations
The system SHALL support categories and many-to-many item-category associations.

#### Scenario: Category CRUD
- **WHEN** user creates, renames, or deletes a category
- **THEN** the database SHALL be updated accordingly

#### Scenario: Assign category to item
- **WHEN** user assigns a category to a clipboard item
- **THEN** the association SHALL be stored in the item_categories table

### Requirement: Favorites toggle
The system SHALL support toggling favorites on clipboard items, and favorites SHALL be preserved during clear-history.

#### Scenario: Toggle favorite
- **WHEN** user toggles the favorite flag on an item
- **THEN** the database SHALL be updated

#### Scenario: Clear history preserves favorites
- **WHEN** user clears clipboard history
- **THEN** favorited items SHALL NOT be deleted

### Requirement: Settings persistence
The system SHALL persist all application settings in the settings table.

#### Scenario: Setting storage and retrieval
- **WHEN** a setting is updated
- **THEN** the new value SHALL be written to the settings table immediately
- **WHEN** the app starts
- **THEN** all settings SHALL be loaded from the settings table into the cache

### Requirement: FTS4-to-FTS5 migration
The system SHALL handle migration from FTS4 schema (if upgrading from a previous version) to FTS5.

#### Scenario: Automatic migration
- **WHEN** the database has an existing FTS4 virtual table
- **THEN** the system SHALL create a new FTS5 table, copy data, drop the FTS4 table, and recreate triggers

### Requirement: Undo delete manager
The system SHALL maintain an in-memory undo stack (max 8 entries, 5-second TTL per entry) for deleted items.

#### Scenario: Undo deletion
- **WHEN** user deletes an item
- **THEN** the deleted item data SHALL be stored in the undo stack for 5 seconds

#### Scenario: Undo restores item
- **WHEN** user triggers undo within 5 seconds of deletion
- **THEN** the item SHALL be re-inserted into the database
