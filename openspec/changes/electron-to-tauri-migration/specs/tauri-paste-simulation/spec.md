## ADDED Requirements

### Requirement: Cross-platform paste simulation
The system SHALL simulate a paste operation to paste selected clipboard history items into the active application.

#### Scenario: Paste on macOS
- **WHEN** user selects a history item to paste on macOS
- **THEN** the system SHALL execute `osascript -e 'tell application "System Events" to keystroke "v" using command down'`

#### Scenario: Paste on Windows
- **WHEN** user selects a history item to paste on Windows
- **THEN** the system SHALL execute PowerShell's `[System.Windows.Forms.SendKeys]::SendWait("^v")`

#### Scenario: Paste on Linux (X11)
- **WHEN** user selects a history item to paste on Linux with X11
- **THEN** the system SHALL execute `xdotool key --clearmodifiers ctrl+v`

### Requirement: Content restoration after paste
The system SHALL restore the original clipboard content after paste simulation.

#### Scenario: Original content restored
- **WHEN** paste simulation completes
- **THEN** the clipboard SHALL be restored to the content that was present before the paste
