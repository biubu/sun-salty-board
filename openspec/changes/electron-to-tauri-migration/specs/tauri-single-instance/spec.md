## ADDED Requirements

### Requirement: Single application instance
The system SHALL prevent multiple instances of the application from running simultaneously.

#### Scenario: Second instance redirects to first
- **WHEN** user launches a second instance
- **THEN** the second instance SHALL exit, and the first instance's window SHALL be shown and focused

#### Scenario: Single instance lock on startup
- **WHEN** the application starts
- **THEN** it SHALL attempt to acquire a single-instance lock; if another instance holds the lock, the new instance SHALL forward focus to the existing instance and exit
