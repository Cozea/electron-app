# Requirements Document: Dockview v6 Migration Complete

## Introduction

The Cozea workbench is built on Dockview and currently uses version 6.0.5. While the package is already on v6, the codebase implements many features using custom code that could leverage native Dockview v6 capabilities. This migration aims to fully adopt v6's native features, reduce custom implementation complexity, improve maintainability, and enhance the workbench user experience.

**Current State Analysis:**
- Package version: `dockview@^6.0.5` (already on v6)
- Already implemented: tab context menus, tab groups, floating groups, popout windows, watermark, custom tabs, theme configuration
- Custom implementations: lazy loading with Suspense, manual visibility tracking, custom split overlay UI, custom tile state management
- Tile types: assistantChat, browser, terminal, devServer, mobileSimulator, selection, changes

## Glossary

- **Workbench**: The main IDE-style panel layout system in Cozea
- **Dockview**: The library providing the workbench foundation (dockview-react)
- **Tile**: A workbench panel instance (browser, terminal, AI agent, etc.)
- **Panel_Component**: The React component rendered inside a Dockview panel
- **Renderer_Mode**: Dockview's strategy for rendering panel content (lazy, eager, onVisible)
- **Lifecycle_Hook**: Native Dockview callbacks for panel visibility and focus events
- **Edge_Group**: A collapsible sidebar-like panel group in Dockview
- **Split_Overlay**: The custom UI showing directional split options (Alt+Shift+Arrow)
- **Activity_Mode**: Custom visibility tracking system (visible/hidden/focused)
- **Layout_Serialization**: Persisting and restoring workbench panel arrangements
- **Tab_Group**: A visual grouping of related tabs with color coding
- **Floating_Group**: A panel detached from the main grid in a draggable window
- **Popout_Window**: A panel opened in a separate browser window

## Requirements

### Requirement 1: Explicit Renderer Mode Configuration

**User Story:** As a developer, I want explicit renderer mode configuration for each tile type, so that panel rendering behavior is predictable and optimized for each use case.

#### Acceptance Criteria

1. THE Workbench SHALL configure renderer mode explicitly for each panel component registration
2. WHEN a browser tile is created, THE Workbench SHALL use "eager" renderer mode
3. WHEN a terminal tile is created, THE Workbench SHALL use "eager" renderer mode
4. WHEN an assistantChat tile is created, THE Workbench SHALL use "onVisible" renderer mode
5. WHEN a devServer tile is created, THE Workbench SHALL use "onVisible" renderer mode
6. WHEN a mobileSimulator tile is created, THE Workbench SHALL use "onVisible" renderer mode
7. WHEN a selection tile is created, THE Workbench SHALL use "lazy" renderer mode
8. WHEN a changes tile is created, THE Workbench SHALL use "onVisible" renderer mode
9. THE Workbench SHALL remove implicit Suspense-only lazy loading approach
10. THE Workbench SHALL document the rationale for each tile type's renderer mode choice

### Requirement 2: Native Lifecycle Hook Integration

**User Story:** As a developer, I want to use native Dockview lifecycle hooks instead of manual visibility tracking, so that the codebase is simpler and more maintainable.

#### Acceptance Criteria

1. THE Workbench SHALL replace useWorkbenchPanelActivityMode with native onDidVisibilityChange hooks
2. WHEN a panel becomes visible, THE Panel_Component SHALL receive an onShow callback
3. WHEN a panel becomes hidden, THE Panel_Component SHALL receive an onHide callback
4. WHEN a panel gains focus, THE Panel_Component SHALL receive an onDidActiveChange event
5. THE Workbench SHALL remove the custom WorkbenchPanelActivityState type
6. THE Workbench SHALL remove the useWorkbenchPanelActivityMode.ts file
7. THE Workbench SHALL update all panel components to use native lifecycle hooks
8. THE Terminal_Panel SHALL pause rendering when hidden using native onHide
9. THE Browser_Panel SHALL optimize resource usage when hidden using native onHide
10. THE AssistantChat_Panel SHALL handle visibility changes using native hooks

### Requirement 3: Edge Groups for Sidebar Panels

**User Story:** As a user, I want sidebar-like panels that can collapse and expand, so that I can maximize workspace for primary content while keeping utility panels accessible.

#### Acceptance Criteria

1. THE Workbench SHALL support edge group configuration for left, right, top, and bottom positions
2. WHEN a changes panel is created, THE Workbench SHALL place it in a left edge group by default
3. WHEN an edge group is collapsed, THE Workbench SHALL show a collapsed indicator with the group icon
4. WHEN a collapsed edge group is clicked, THE Workbench SHALL expand the edge group
5. THE Workbench SHALL persist edge group collapsed state in layout serialization
6. THE Workbench SHALL allow users to drag panels into and out of edge groups
7. THE Workbench SHALL configure edgeGroupCollapsedSize to match the app's design system
8. WHEN multiple panels exist in an edge group, THE Workbench SHALL show tabs for navigation
9. THE Workbench SHALL support keyboard shortcuts for toggling edge group visibility
10. THE Workbench SHALL maintain edge group state across workbench resets

### Requirement 4: Keyboard Navigation Shortcuts

**User Story:** As a power user, I want keyboard shortcuts for navigating between panels, so that I can work efficiently without using the mouse.

#### Acceptance Criteria

1. THE Workbench SHALL register keyboard shortcuts for panel navigation
2. WHEN Cmd+K then Cmd+Right is pressed, THE Workbench SHALL focus the next panel to the right
3. WHEN Cmd+K then Cmd+Left is pressed, THE Workbench SHALL focus the next panel to the left
4. WHEN Cmd+K then Cmd+Up is pressed, THE Workbench SHALL focus the next panel above
5. WHEN Cmd+K then Cmd+Down is pressed, THE Workbench SHALL focus the next panel below
6. WHEN Cmd+K then Cmd+W is pressed, THE Workbench SHALL close the active panel
7. WHEN Cmd+K then Cmd+M is pressed, THE Workbench SHALL toggle maximize for the active panel
8. WHEN Cmd+K then Cmd+F is pressed, THE Workbench SHALL float the active panel
9. THE Workbench SHALL display keyboard shortcuts in panel context menus
10. THE Workbench SHALL support customizable keyboard shortcut configuration

### Requirement 5: Panel Size Constraints

**User Story:** As a user, I want panels to respect minimum and maximum size constraints, so that the workbench layout remains usable and panels don't become too small or too large.

#### Acceptance Criteria

1. THE Workbench SHALL configure minimum width constraints for each tile type
2. THE Workbench SHALL configure minimum height constraints for each tile type
3. WHEN a browser tile is created, THE Workbench SHALL set minimum dimensions to 320x240 pixels
4. WHEN a terminal tile is created, THE Workbench SHALL set minimum dimensions to 400x200 pixels
5. WHEN an assistantChat tile is created, THE Workbench SHALL set minimum dimensions to 360x400 pixels
6. WHEN a devServer tile is created, THE Workbench SHALL set minimum dimensions to 320x240 pixels
7. WHEN a mobileSimulator tile is created, THE Workbench SHALL set minimum dimensions to 375x667 pixels
8. THE Workbench SHALL prevent panel resizing below configured minimum dimensions
9. THE Workbench SHALL configure maximum dimensions for floating panels
10. THE Workbench SHALL respect size constraints during layout deserialization

### Requirement 6: Layout Locking Capabilities

**User Story:** As a user, I want to lock the workbench layout to prevent accidental changes, so that I can maintain my preferred panel arrangement during focused work.

#### Acceptance Criteria

1. THE Workbench SHALL provide a layout lock toggle in the workbench header
2. WHEN layout lock is enabled, THE Workbench SHALL prevent panel dragging
3. WHEN layout lock is enabled, THE Workbench SHALL prevent panel resizing
4. WHEN layout lock is enabled, THE Workbench SHALL prevent panel closing via drag
5. WHEN layout lock is enabled, THE Workbench SHALL still allow panel closing via close button
6. WHEN layout lock is enabled, THE Workbench SHALL still allow panel focus changes
7. THE Workbench SHALL persist layout lock state per workspace
8. THE Workbench SHALL show a visual indicator when layout is locked
9. WHEN layout lock is toggled, THE Workbench SHALL show a toast notification
10. THE Workbench SHALL support keyboard shortcut for toggling layout lock

### Requirement 7: Enhanced Drag and Drop Customization

**User Story:** As a user, I want clear visual feedback during drag and drop operations, so that I understand where panels will be placed before I release them.

#### Acceptance Criteria

1. THE Workbench SHALL use native Dockview drag overlay configuration
2. WHEN dragging a panel, THE Workbench SHALL show drop zone indicators
3. WHEN hovering over a valid drop zone, THE Workbench SHALL highlight the target area
4. THE Workbench SHALL configure dndOverlayBorder to match the app's design system
5. THE Workbench SHALL configure dndPanelOverlay to "group" mode
6. THE Workbench SHALL configure dndTabIndicator to "line" mode
7. WHEN dragging a tab, THE Workbench SHALL show a line indicator at the drop position
8. THE Workbench SHALL prevent dropping panels into incompatible groups
9. THE Workbench SHALL support drag and drop between floating groups and main grid
10. THE Workbench SHALL support drag and drop between popout windows and main grid

### Requirement 8: Replace Custom Split Overlay with Native Features

**User Story:** As a developer, I want to replace the custom split overlay UI with native Dockview features, so that the codebase is simpler and leverages library capabilities.

#### Acceptance Criteria

1. THE Workbench SHALL evaluate native Dockview split APIs as replacement for custom overlay
2. IF native split APIs provide equivalent functionality, THEN THE Workbench SHALL remove WorkbenchTileChrome split overlay code
3. IF native split APIs are insufficient, THEN THE Workbench SHALL document the gap and retain custom implementation
4. THE Workbench SHALL maintain Alt+Shift+Arrow keyboard shortcut for split operations
5. THE Workbench SHALL maintain split direction preview functionality
6. THE Workbench SHALL maintain split operations for top, bottom, left, and right directions
7. THE Workbench SHALL remove custom split state management if native APIs are adopted
8. THE Workbench SHALL remove custom split event listeners if native APIs are adopted
9. THE Workbench SHALL maintain split functionality for browser tiles with focus delegation
10. THE Workbench SHALL document the decision and implementation approach

### Requirement 9: Performance Optimization

**User Story:** As a user, I want the workbench to perform efficiently with many panels open, so that the application remains responsive during complex workflows.

#### Acceptance Criteria

1. THE Workbench SHALL use onVisible renderer mode for heavy panels to defer rendering
2. THE Workbench SHALL pause terminal rendering when panels are hidden
3. THE Workbench SHALL reduce browser panel resource usage when hidden
4. THE Workbench SHALL batch layout serialization updates with debouncing
5. THE Workbench SHALL avoid unnecessary panel re-renders during layout changes
6. THE Workbench SHALL use React.memo for panel components where appropriate
7. THE Workbench SHALL measure and log panel render times in development mode
8. THE Workbench SHALL implement virtualization for tab lists with many tabs
9. THE Workbench SHALL optimize Dockview theme object creation to avoid re-renders
10. THE Workbench SHALL profile workbench performance with 10+ panels open

### Requirement 10: State Migration Strategy

**User Story:** As a developer, I want a safe migration strategy for existing workbench state, so that users don't lose their panel arrangements when upgrading.

#### Acceptance Criteria

1. THE Workbench SHALL detect legacy workbench state format during hydration
2. WHEN legacy state is detected, THE Workbench SHALL migrate it to the new format
3. THE Workbench SHALL preserve tile metadata during migration
4. THE Workbench SHALL preserve active tile selection during migration
5. THE Workbench SHALL rebuild layout from tile order if serialized layout is incompatible
6. THE Workbench SHALL increment layoutResetKey when migration requires layout rebuild
7. THE Workbench SHALL log migration actions for debugging
8. THE Workbench SHALL handle missing or corrupted state gracefully
9. THE Workbench SHALL provide a manual reset option if migration fails
10. THE Workbench SHALL test migration with real user state samples

### Requirement 11: Testing Strategy

**User Story:** As a developer, I want comprehensive tests for Dockview v6 features, so that regressions are caught early and the workbench remains stable.

#### Acceptance Criteria

1. THE Workbench SHALL include unit tests for renderer mode configuration
2. THE Workbench SHALL include unit tests for lifecycle hook integration
3. THE Workbench SHALL include unit tests for edge group behavior
4. THE Workbench SHALL include unit tests for keyboard navigation shortcuts
5. THE Workbench SHALL include unit tests for size constraint enforcement
6. THE Workbench SHALL include unit tests for layout locking
7. THE Workbench SHALL include integration tests for drag and drop operations
8. THE Workbench SHALL include integration tests for layout serialization and deserialization
9. THE Workbench SHALL include integration tests for state migration
10. THE Workbench SHALL include visual regression tests for workbench layouts

### Requirement 12: Rollout and Feature Flags

**User Story:** As a developer, I want to roll out Dockview v6 features incrementally with feature flags, so that issues can be detected and rolled back without affecting all users.

#### Acceptance Criteria

1. THE Workbench SHALL implement feature flags for each major v6 feature
2. THE Workbench SHALL provide a feature flag for native lifecycle hooks
3. THE Workbench SHALL provide a feature flag for edge groups
4. THE Workbench SHALL provide a feature flag for keyboard navigation shortcuts
5. THE Workbench SHALL provide a feature flag for layout locking
6. THE Workbench SHALL provide a feature flag for enhanced drag and drop
7. THE Workbench SHALL default new features to disabled in production initially
8. THE Workbench SHALL enable features progressively based on testing results
9. THE Workbench SHALL log feature flag state at workbench initialization
10. THE Workbench SHALL support per-user feature flag overrides for testing

### Requirement 13: Documentation Updates

**User Story:** As a developer, I want comprehensive documentation for Dockview v6 features, so that the team can maintain and extend the workbench effectively.

#### Acceptance Criteria

1. THE Workbench SHALL document renderer mode choices for each tile type
2. THE Workbench SHALL document lifecycle hook usage patterns
3. THE Workbench SHALL document edge group configuration
4. THE Workbench SHALL document keyboard navigation shortcuts
5. THE Workbench SHALL document size constraint configuration
6. THE Workbench SHALL document layout locking behavior
7. THE Workbench SHALL document drag and drop customization
8. THE Workbench SHALL document performance optimization techniques
9. THE Workbench SHALL document state migration strategy
10. THE Workbench SHALL update AGENTS.md with workbench architecture changes

### Requirement 14: Floating Group Enhancements

**User Story:** As a user, I want enhanced floating group behavior, so that detached panels are easier to manage and position.

#### Acceptance Criteria

1. THE Workbench SHALL configure floatingGroupBounds to "boundedWithinViewport"
2. WHEN a panel is floated, THE Workbench SHALL position it using component-specific dimensions
3. WHEN a floating group is moved outside viewport, THE Workbench SHALL constrain it to visible area
4. THE Workbench SHALL persist floating group positions in layout serialization
5. THE Workbench SHALL restore floating group positions during layout deserialization
6. THE Workbench SHALL support snapping floating groups to viewport edges
7. THE Workbench SHALL show floating group indicators in the workbench overview
8. WHEN a floating group is closed, THE Workbench SHALL return panels to main grid
9. THE Workbench SHALL support keyboard shortcuts for managing floating groups
10. THE Workbench SHALL limit maximum number of floating groups to prevent clutter

### Requirement 15: Popout Window Enhancements

**User Story:** As a user, I want enhanced popout window behavior, so that panels in separate windows integrate seamlessly with the main workbench.

#### Acceptance Criteria

1. THE Workbench SHALL configure popout window titles based on panel content
2. WHEN a panel is popped out, THE Workbench SHALL position it using component-specific dimensions
3. WHEN a popout window is closed, THE Workbench SHALL return the panel to main grid
4. THE Workbench SHALL handle popout window close events gracefully
5. THE Workbench SHALL focus main window when popout window closes
6. THE Workbench SHALL persist popout window state in layout serialization
7. THE Workbench SHALL restore popout windows during layout deserialization
8. THE Workbench SHALL apply consistent theme to popout windows
9. THE Workbench SHALL support drag and drop between popout windows
10. THE Workbench SHALL limit maximum number of popout windows to prevent resource exhaustion

### Requirement 16: Tab Group Enhancements

**User Story:** As a user, I want enhanced tab group features, so that I can organize related panels more effectively.

#### Acceptance Criteria

1. THE Workbench SHALL support tab group color customization via palette
2. THE Workbench SHALL support tab group renaming via context menu
3. THE Workbench SHALL persist tab group metadata in layout serialization
4. THE Workbench SHALL restore tab group metadata during layout deserialization
5. WHEN a panel is added to a tab group, THE Workbench SHALL apply group color indicator
6. WHEN a tab group is empty, THE Workbench SHALL remove the tab group
7. THE Workbench SHALL support creating tab groups from multiple selected panels
8. THE Workbench SHALL support removing panels from tab groups via context menu
9. THE Workbench SHALL show tab group chip with color and label
10. THE Workbench SHALL support keyboard shortcuts for tab group operations

### Requirement 17: Watermark Component Enhancements

**User Story:** As a user, I want an enhanced empty state watermark, so that I understand available actions when no panels are open.

#### Acceptance Criteria

1. THE Workbench SHALL show watermark component when no panels are open
2. THE Watermark SHALL display project name if available
3. THE Watermark SHALL show launcher app grid with icons and labels
4. THE Watermark SHALL support clicking launcher apps to create panels
5. THE Watermark SHALL show keyboard shortcut hints for common actions
6. THE Watermark SHALL match the app's design system and theme
7. THE Watermark SHALL support search/filter for launcher apps
8. THE Watermark SHALL show recently used panel types
9. THE Watermark SHALL support drag and drop from watermark to create panels
10. THE Watermark SHALL animate smoothly when appearing and disappearing

### Requirement 18: Theme Configuration Enhancements

**User Story:** As a developer, I want enhanced theme configuration, so that the workbench visual appearance is consistent with the app's design system.

#### Acceptance Criteria

1. THE Workbench SHALL configure Dockview theme using CSS variables
2. THE Workbench SHALL support light and dark theme variants
3. THE Workbench SHALL configure gap, tabAnimation, and indicator styles
4. THE Workbench SHALL configure drag and drop overlay styles
5. THE Workbench SHALL configure edge group collapsed size
6. THE Workbench SHALL avoid recreating theme object on every render
7. THE Workbench SHALL use useMemo for theme object creation
8. THE Workbench SHALL support theme customization per workspace
9. THE Workbench SHALL persist theme preferences in user settings
10. THE Workbench SHALL apply theme changes without requiring workbench reload

### Requirement 19: Layout Serialization Enhancements

**User Story:** As a developer, I want robust layout serialization, so that workbench state is reliably persisted and restored.

#### Acceptance Criteria

1. THE Workbench SHALL serialize complete Dockview layout including panels, groups, and positions
2. THE Workbench SHALL serialize floating group positions and dimensions
3. THE Workbench SHALL serialize popout window state
4. THE Workbench SHALL serialize edge group collapsed state
5. THE Workbench SHALL serialize tab group metadata
6. THE Workbench SHALL serialize active panel selection
7. THE Workbench SHALL debounce layout serialization to avoid excessive writes
8. THE Workbench SHALL validate serialized layout before deserialization
9. THE Workbench SHALL handle deserialization errors gracefully with fallback
10. THE Workbench SHALL version serialized layout format for future migrations

### Requirement 20: Accessibility Compliance

**User Story:** As a user with accessibility needs, I want the workbench to be fully accessible, so that I can use all features with assistive technologies.

#### Acceptance Criteria

1. THE Workbench SHALL provide ARIA labels for all interactive elements
2. THE Workbench SHALL support keyboard navigation for all panel operations
3. THE Workbench SHALL announce panel focus changes to screen readers
4. THE Workbench SHALL provide visible focus indicators for keyboard navigation
5. THE Workbench SHALL support high contrast mode
6. THE Workbench SHALL provide text alternatives for icon-only buttons
7. THE Workbench SHALL maintain logical tab order for keyboard navigation
8. THE Workbench SHALL support screen reader announcements for layout changes
9. THE Workbench SHALL meet WCAG 2.1 Level AA standards
10. THE Workbench SHALL document accessibility features and keyboard shortcuts
