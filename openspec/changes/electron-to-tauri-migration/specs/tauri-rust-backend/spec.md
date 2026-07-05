## ADDED Requirements

### Requirement: All Tauri commands registered and invocable
The system SHALL expose all backend operations as Tauri commands, invocable from the frontend via `invoke('command_name', args)`.

#### Scenario: Command registration
- **WHEN** the Tauri app starts
- **THEN** all command handlers SHALL be registered with `#[tauri::command]` and accessible via `invoke`

#### Scenario: Command returns error
- **WHEN** a command encounters an error
- **THEN** it SHALL return a descriptive `Result<_, String>` error to the frontend

### Requirement: Backend state managed via tauri::State
The system SHALL use `tauri::State` with `Mutex`/`RwLock` to manage shared state (database, undo stack, sensitive items, settings cache, exclusion rules).

#### Scenario: State initialization
- **WHEN** the app starts
- **THEN** all state SHALL be initialized in the `setup` hook and registered via `app.manage()`

#### Scenario: Thread-safe state access
- **WHEN** multiple commands access shared state concurrently
- **THEN** Rust sync primitives SHALL prevent data races

### Requirement: Event system for renderer communication
The system SHALL emit Tauri events to the frontend for push-based updates (clipboard changed, update progress, settings changed).

#### Scenario: Event emission
- **WHEN** backend detects a clipboard change
- **THEN** it SHALL emit a `clipboard-changed` event with the new item data
