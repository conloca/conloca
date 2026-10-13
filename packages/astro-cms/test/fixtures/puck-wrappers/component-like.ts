/**
 * The shape the wrapper fixtures beside this file pass around.
 *
 * They are real modules, not source strings, because the suite that reads them
 * also RUNS them: the whole point is to compare what the reader says a wrapper
 * builds against what the wrapper actually builds. A string could only ever be
 * compared against another reading of itself.
 */
export interface ComponentLike {
  label?: string;
  fields: Record<string, { type: string; [key: string]: unknown }>;
  defaultProps?: Record<string, unknown>;
  ai?: unknown;
  /** Behaviour Puck runs at render. The reader can only mark that each one is there. */
  resolveFields?: unknown;
  resolveData?: unknown;
  resolvePermissions?: unknown;
}

/** The shape a fixture's default-exported Puck config takes once the module has run. */
export interface ConfigLike {
  components: Record<string, ComponentLike>;
  root?: { fields: ComponentLike['fields'] };
  categories?: Record<string, { title?: string; components?: string[] }>;
}
