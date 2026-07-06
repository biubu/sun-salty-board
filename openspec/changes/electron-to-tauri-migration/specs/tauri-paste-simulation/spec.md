## ADDED Requirements

### Requirement: Cross-platform paste simulation
The system SHALL simulate a paste operation to paste selected clipboard history items into the active application.

#### Scenario: Paste on macOS
- **WHEN** user selects a history item to paste on macOS
- **THEN** the system SHALL restore focus to the previously-frontmost application (captured via `NSWorkspace.frontmostApplication` before our window is shown), deactivate our app, activate the previously-frontmost app via `NSRunningApplication.activateWithOptions(NSApplicationActivateIgnoringOtherApps)`, and post a Cmd+V keystroke via `CGEventPost` (key code 9, `CGEventFlagCommand`)
- **AND** the system SHALL check `AXIsProcessTrustedWithOptions` and warn if Accessibility permission is not granted

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
