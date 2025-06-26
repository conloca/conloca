# PuckPortalShape Technical Overview

## Component Architecture

### Core Components

#### PuckPortalShapeUtil

Main shape utility class that integrates with tldraw. Extends `BaseBoxShapeUtil<PuckPortalShape>`.

**Key responsibilities:**

- Shape lifecycle management
- Resize behavior control
- Device preset management
- Editor integration

#### PuckContent

Memoized component that renders the Puck editor instance.

**Key features:**

- Iframe-based rendering for style isolation
- Pointer event bubbling for drag-and-drop
- Scroll event handling
- Auto-save integration

#### PuckPortalFloatingUI

Handles floating UI panels when editing.

**Key features:**

- Device selector (left side)
- Components panel (right side)
- Properties panel (bottom)
- Portal-based rendering outside shape bounds
- Event isolation from canvas

#### PuckSelectionHandler

Manages Puck's internal selection state.

**Purpose:**

- Clears Puck selection when shape is deselected
- Prevents selection state conflicts

## Event Handling

### Zoom Handler

- Injected script in iframe intercepts zoom events (Ctrl/Cmd + wheel)
- Forwards zoom events to tldraw canvas via postMessage
- Prevents browser zoom in iframe

### Scroll Event Handling

- Regular scroll: Stops propagation when editing
- Zoom (Ctrl/Cmd + wheel): Allows bubbling to tldraw
- Scroll container handles overflow when content exceeds shape height

### Hover State Management

- Attempts to clear stuck hover states when pointer leaves iframe
- Known issue: Grid component hover states can persist due to ZoneStore state

## State Management

### Shape Props

```typescript
interface PuckPortalShape {
  w: number; // Width
  h: number; // Height
  puckData: any; // Puck editor data
  portalName: string; // Display name
  devicePresetId?: string; // Selected device preset
  sizeLockMode: 'unlocked' | 'locked' | 'horizontal-locked';
  showDeviceChrome: boolean; // Show device frame
}
```

### Resize Behavior

- **Unlocked**: Free resize in both dimensions
- **Locked**: No resizing allowed
- **Horizontal-locked**: Only vertical resize allowed

## Iframe Height Management

The component dynamically adjusts iframe height to match content:

1. **Initial Setup**: Removes iframe borders, margins, padding
2. **Content Measurement**: Uses MutationObserver to track changes
3. **Height Calculation**: Measures all elements to find max bottom position
4. **Delayed Updates**: Waits 100ms after data changes for layout completion

## Performance Optimizations

1. **Memoization**: PuckContent uses React.memo with custom comparison
2. **Conditional Rendering**: Floating panels only mount when editing
3. **Event Cleanup**: All listeners properly removed on unmount
4. **Single Portal Container**: Reuses portal containers across all shapes
5. **Dimension Snapping**: Resize snaps to whole pixels

## Integration Points

### With tldraw

- Uses `BaseBoxShapeUtil` for shape behavior
- Integrates with editor selection state
- Handles resize through `onResize` callback
- Uses `HTMLContainer` for event isolation

### With Puck

- Renders full Puck instance per shape
- Uses iframe mode for style isolation
- Integrates with Puck's component system
- Handles data updates through `onChange`

### With @dnd-kit

- Puck handles all drag operations internally
- No custom pointer event bubbling needed
- GlobalPosition patch ensures correct iframe detection

## Future Improvements

1. **Collaboration**: Multi-user editing support
2. **Export**: Direct export to code functionality
