## ADDED Requirements

### Requirement: Auto-update via GitHub Releases
The application SHALL automatically check for updates from GitHub Releases on startup and periodically.

#### Scenario: Update check on startup
- **WHEN** the application starts
- **THEN** it SHALL check for new versions from GitHub Releases

#### Scenario: Update available notification
- **WHEN** a new version is available
- **THEN** the system SHALL notify the user and offer to download

### Requirement: Download progress reporting
The system SHALL emit download progress events to the frontend during update download.

#### Scenario: Progress events emitted
- **WHEN** an update is being downloaded
- **THEN** the system SHALL emit periodic `update-download-progress` events with bytes downloaded and total bytes

### Requirement: Install on quit
The system SHALL install the update automatically when the user quits the application.

#### Scenario: Auto-install on quit
- **WHEN** user quits the application and an update has been downloaded
- **THEN** the system SHALL install the update before closing

### Requirement: Update channel configuration
The system SHALL support configuring the update channel (stable/beta) in settings.

#### Scenario: Channel switch
- **WHEN** user changes the update channel in Settings
- **THEN** the system SHALL use the new channel for subsequent update checks
