## ADDED Requirements

### Requirement: Clipboard polling
The system SHALL poll the OS clipboard at a configurable interval (default 500ms) for new content.

#### Scenario: Polling detects new text
- **WHEN** the clipboard contains new text content
- **THEN** the system SHALL capture the text and store it

#### Scenario: Polling detects new image
- **WHEN** the clipboard contains a new image (PNG/JPEG/BMP/GIF/WebP)
- **THEN** the system SHALL capture the image and store it as PNG bytes

#### Scenario: Polling detects rich text
- **WHEN** the clipboard contains HTML content
- **THEN** the system SHALL capture both plain text and HTML

#### Scenario: Polling detects file references
- **WHEN** the clipboard contains file URLs
- **THEN** the system SHALL extract file paths and store them

#### Scenario: Configurable poll interval
- **WHEN** the user changes the poll interval in Settings
- **THEN** the polling timer SHALL adjust to the new interval

### Requirement: Deduplication
The system SHALL skip duplicate clipboard content within a 100ms dedup window.

#### Scenario: Same content ignored
- **WHEN** the clipboard content matches the last captured content
- **THEN** the system SHALL NOT create a new entry

### Requirement: Exclusion rules
The system SHALL filter clipboard captures based on source app name and content regex patterns.

#### Scenario: App exclusion
- **WHEN** the active app matches an exclusion rule's app name pattern
- **THEN** the clipboard content SHALL NOT be captured

#### Scenario: Content regex exclusion
- **WHEN** the clipboard content matches an exclusion rule's regex pattern
- **THEN** the clipboard content SHALL NOT be captured

### Requirement: Sensitive item detection
The system SHALL mark items as sensitive when Ctrl key is held during copy, with auto-expiry after 5 minutes.

#### Scenario: Ctrl+copy marks sensitive
- **WHEN** user copies while holding Ctrl
- **THEN** the captured item SHALL be marked as sensitive

#### Scenario: Sensitive item auto-expiry
- **WHEN** a sensitive item has been stored for 5 minutes
- **THEN** it SHALL be automatically deleted

### Requirement: Content fingerprinting
The system SHALL generate a SHA-256 content fingerprint for each captured item to enable deduplication.

#### Scenario: Text fingerprint
- **WHEN** text content is captured
- **THEN** a SHA-256 hash of the text SHALL be computed and stored
