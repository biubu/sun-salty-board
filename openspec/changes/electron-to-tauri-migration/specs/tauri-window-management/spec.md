## ADDED Requirements

### Requirement: Frameless overlay window
The application SHALL use a frameless, always-on-top window for the clipboard overlay.

#### Scenario: Window creation
- **WHEN** the app starts
- **THEN** the window SHALL be frameless, always-on-top, and skip the taskbar

#### Scenario: Window at cursor position
- **WHEN** the window shows
- **THEN** it SHALL position itself at the current cursor location (centered above/below)

### Requirement: Hide on blur
The window SHALL automatically hide when it loses focus.

#### Scenario: Focus loss hides window
- **WHEN** the window loses focus (user clicks elsewhere)
- **THEN** the window SHALL hide

### Requirement: Window toggle via command
The system SHALL expose commands to show and hide the window, toggle its visibility, and check current visibility state.

#### Scenario: Show command
- **WHEN** invoke('show_window') is called
- **THEN** the window SHALL be displayed at cursor position

#### Scenario: Hide command
- **WHEN** invoke('hide_window') is called
- **THEN** the window SHALL be hidden

#### Scenario: Toggle command
- **WHEN** invoke('toggle_window') is called
- **THEN** the window SHALL show if hidden, or hide if visible

### Requirement: Single window instance
The application SHALL only create one overlay window.

#### Scenario: No duplicate windows
- **WHEN** show_window is called while window already visible
- **THEN** the existing window SHALL be focused, not duplicated
