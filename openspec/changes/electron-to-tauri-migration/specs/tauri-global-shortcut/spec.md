## ADDED Requirements

### Requirement: Global hotkey registration
The system SHALL register a global hotkey (default Alt+Shift+V) to toggle the main window visibility.

#### Scenario: Default hotkey toggles window
- **WHEN** user presses Alt+Shift+V
- **THEN** the main window SHALL show if hidden, or hide if visible

#### Scenario: Hotkey configurable in settings
- **WHEN** user changes the hotkey in Settings
- **THEN** the old hotkey SHALL be unregistered and the new hotkey SHALL be registered

#### Scenario: Hotkey conflict detection
- **WHEN** a hotkey conflicts with another application
- **THEN** the system SHALL log a warning and continue without registering

### Requirement: Hotkey unregistration on quit
The system SHALL unregister all hotkeys when the application quits.

#### Scenario: Cleanup on exit
- **WHEN** the application quits
- **THEN** all global shortcuts SHALL be unregistered
