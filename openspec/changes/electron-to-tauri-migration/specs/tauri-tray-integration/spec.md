## ADDED Requirements

### Requirement: System tray with context menu
The application SHALL display a system tray icon with a context menu containing Open History, Settings, About, and Quit options.

#### Scenario: Tray icon visible on start
- **WHEN** the app starts
- **THEN** a tray icon SHALL appear in the system tray area

#### Scenario: Open History from tray
- **WHEN** user clicks "Open History" in tray menu
- **THEN** the main window SHALL show and focus

#### Scenario: Open Settings from tray
- **WHEN** user clicks "Settings" in tray menu
- **THEN** the settings panel SHALL open

#### Scenario: Show About dialog
- **WHEN** user clicks "About" in tray menu
- **THEN** an about dialog SHALL show the app name, version, and author

#### Scenario: Quit from tray
- **WHEN** user clicks "Quit" in tray menu
- **THEN** the application SHALL exit cleanly

### Requirement: Cross-platform tray icon
The tray icon SHALL display correctly on macOS, Windows, and Linux.

#### Scenario: Platform-specific icon format
- **WHEN** the app runs on macOS
- **THEN** the tray icon SHALL be a Template-compatible PNG for dark/light mode
- **WHEN** the app runs on Windows
- **THEN** the tray icon SHALL be a .ico file
- **WHEN** the app runs on Linux
- **THEN** the tray icon SHALL be a PNG file
