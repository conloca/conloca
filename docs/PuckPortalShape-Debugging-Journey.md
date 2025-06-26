# PuckPortalShape Debugging Journey

## Overview

This document details the debugging process for fixing a drag-and-drop issue in the PuckPortalShapeUtil component, where
only one specific Portal shape worked with drag-and-drop immediately while others required workarounds.

## The Problem

- **Symptom**: Only shape `shape:0a5J0l6fKyV8igB_SX5a3` worked with drag-and-drop immediately
- **Other shapes**: Required double-clicking to edit + adding a component before drag-and-drop would work
- **Constraint**: Iframes were required for style isolation (disabling iframes made everything work)

## The Journey

### 1. Initial Hypothesis: Event Bubbling (Incorrect)

**Theory**: Events weren't bubbling properly from iframe to parent

**Actions Taken**:

- Added extensive pointer event bubbling system
- Implemented comprehensive event forwarding from iframe content to parent
- Added ~300 lines of drag event handling code

**Result**: Events were bubbling correctly, but drag-and-drop still didn't work

**Key Learning**: Just because events bubble doesn't mean they're being processed correctly

### 2. Second Hypothesis: @dnd-kit Initialization (Incorrect)

**Theory**: @dnd-kit wasn't properly initialized for new shapes

**Actions Taken**:

- Discovered @dnd-kit uses pointer events, not HTML5 drag events
- Added DropZoneMeasurementFixer component to force drop zone measurements
- Investigated ResizeObserver callback timing issues

**Result**: Drop zones were being measured, but drag still didn't work

**Key Learning**: @dnd-kit doesn't use native drag events - listening for `dragstart`/`dragend` captures nothing

### 3. The Breakthrough: Console Error

**Discovery**: "Failed to execute 'elementsFromPoint' on 'Document': The provided double value is non-finite"

**What this meant**:

- NaN or Infinity coordinates were being passed to DOM APIs
- This indicated a coordinate calculation error
- Led to investigating Puck's coordinate transformation code

### 4. Root Cause: GlobalPosition Class

**The Problem**:

```javascript
// In @measured/puck's GlobalPosition class
this.frameEl = document.querySelector('iframe#preview-frame');
```

**Why it broke**:

1. With multiple Portal shapes, each has its own Puck instance with its own iframe
2. `document.querySelector` always returns the FIRST matching element
3. GlobalPosition always found the iframe from the first (working) shape
4. When dragging over other shapes, it used the wrong iframe's rect for calculations
5. Wrong rect + correct mouse position = NaN coordinates

**Why one shape always worked**:

- It was the first Portal shape in the DOM
- Its iframe was always found by the querySelector
- Coordinates were calculated correctly for this shape only

## The Solution

### Patching @measured/puck

Created a context-aware iframe lookup:

```javascript
// Find the correct iframe based on the event target's document
if (target.ownerDocument !== document) {
  // Target is inside an iframe
  const iframes = Array.from(document.querySelectorAll('iframe'));
  this.frameEl = iframes.find((iframe) => iframe.contentDocument === target.ownerDocument) || null;
} else {
  // Target is in main document
  this.frameEl = document.querySelector('iframe#preview-frame');
}
```

### Applying the Patch

Used `bun patch` to modify the distributed files:

- `node_modules/@measured/puck/dist/index.js`
- `node_modules/@measured/puck/dist/index.mjs`

## Code Cleanup

### What Was Removed

1. **Drag Event Handling** (~300 lines)
   - All `dragstart`, `dragend`, `dragover` event listeners
   - Drag event coordinate translation
   - Not needed since @dnd-kit uses pointer events

2. **DropZoneMeasurementFixer Component**
   - Was a workaround attempt
   - Not needed after fixing GlobalPosition

3. **Excessive Debug Logging**
   - Hundreds of console.log statements
   - Event tracking logs
   - Performance timing logs

4. **Document-level Event Listeners**
   - Global pointer event capturing
   - Not needed with proper iframe handling

### What Was Kept

1. **Pointer Event Bubbling** (minimal)
   - Only for @dnd-kit compatibility
   - Bubbles pointer events from iframe to parent
   - Required for drag detection across iframe boundary

2. **Scroll Event Handling**
   - Prevents scroll hijacking when over Portal
   - Forwards zoom events to tldraw canvas

3. **Portal UI Components**
   - Floating panels for components and fields
   - Event isolation for UI panels

## Key Insights

1. **Global Selectors Are Dangerous**: In multi-instance scenarios, never assume there's only one element
2. **Coordinate Errors = Reference Frame Issues**: NaN in coordinate math usually means wrong element references
3. **Read The Source**: Understanding library internals is crucial for complex debugging
4. **Event Systems Are Complex**: Modern libraries often implement their own event systems on top of DOM events
5. **Test With Multiple Instances**: Single-instance testing can hide multi-instance bugs

## Final File Sizes

- **Original** (with debug code): ~1700 lines
- **Cleaned**: ~790 lines
- **Reduction**: ~53% smaller

## Debugging Techniques That Helped

1. **Error Message Analysis**: The NaN error was the key breakthrough
2. **Source Code Exploration**: Reading Puck and @dnd-kit source revealed the architecture
3. **Isolation Testing**: Disabling iframes confirmed it wasn't a general @dnd-kit issue
4. **Instance Comparison**: Comparing working vs non-working shapes revealed the pattern

## What Didn't Help

1. **Event Bubbling Fixes**: Spent too much time on this red herring
2. **Generic Debugging**: Adding logs everywhere without a hypothesis
3. **Timing Workarounds**: Delays and retries didn't address the root cause

## Lessons for Future Debugging

1. **Start with error messages**: They often point directly to the problem
2. **Question hardcoded assumptions**: Look for global selectors and singletons
3. **Understand the architecture**: Know what event system is actually being used
4. **Test multi-instance early**: Don't assume single-instance behavior scales
5. **Keep changes minimal**: The final fix was just a few lines
