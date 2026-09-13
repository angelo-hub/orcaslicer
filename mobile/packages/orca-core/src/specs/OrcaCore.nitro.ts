import type { HybridObject } from 'react-native-nitro-modules'

// The slicing core, one-to-one with src/mobile/core/Session.hpp. Every type here is a
// plain struct or a string union so nitrogen generates matching C++; the native side
// converts to and from the façade's types.

export type PresetKind = 'printer' | 'filament' | 'process'

export interface PresetInfo {
  name: string
  /** Vendor id for system presets, empty otherwise. */
  vendor: string
  isSystem: boolean
  isUser: boolean
  /** Installed in the desktop sense; the app may ignore this. */
  isVisible: boolean
  /** Compatible with the selected printer. */
  isCompatible: boolean
  isSelected: boolean
}

export interface Vec2 {
  x: number
  y: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface ObjectInfo {
  /** Stable for the life of the session. */
  id: number
  name: string
  /** Instance offset, mm. */
  position: Vec3
  /** Euler angles, radians. */
  rotation: Vec3
  scale: Vec3
  /** World-space bounding box, mm. */
  size: Vec3
  triangles: number
}

export interface BedInfo {
  /** Printable area polygon, mm. */
  shape: Vec2[]
  /** Printable height, mm. */
  height: number
}

export interface Progress {
  percent: number
  message: string
}

export type SliceOutcome = 'finished' | 'cancelled' | 'failed'

export interface SliceWarning {
  text: string
  critical: boolean
}

export interface SliceResult {
  outcome: SliceOutcome
  /** Set when the outcome is 'failed'. */
  error: string
  warnings: SliceWarning[]
}

export interface SliceStatistics {
  /** Normal-mode estimate. */
  printTimeSeconds: number
  /** Total extruded volume. */
  filamentMm3: number
  /** By filament density where known. */
  filamentGrams: number
  filamentCost: number
  layerCount: number
}

/**
 * One project: presets, model and print. Calls that read or edit state are synchronous
 * and throw while a slice is running; the long operations return promises and run on
 * the session's own thread, one at a time.
 */
export interface OrcaSession extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  /** Identifies this session to native views such as OrcaViewport. */
  readonly id: number
  /** Loads vendor profiles from the resources directory and user presets from the data directory. Resolves to an error text, empty on success. */
  loadPresets(): Promise<string>
  /** Same as loadPresets, but first wipes the mirror at data/system so a same-version reinstall of a vendor really refreshes it (used after installing / removing a vendor). */
  reloadPresets(): Promise<string>
  presets(kind: PresetKind): PresetInfo[]
  selectedPreset(kind: PresetKind): string
  /** Select by name. For filaments this selects extruder 0. */
  selectPreset(kind: PresetKind, name: string): boolean
  selectFilament(extruder: number, name: string): boolean
  bed(): BedInfo

  /** Serialized option value as libslic3r writes it in config files ("0.2", "1,2,3", "nil"). */
  option(key: string): string
  setOption(key: string, value: string): boolean
  modifiedOptions(kind: PresetKind): string[]
  discardModifiedOptions(kind: PresetKind): void

  /** Reads STL, OBJ, 3MF, STEP, AMF or any format the core accepts and places the objects on the bed. Rejects on failure. */
  importModel(path: string): Promise<ObjectInfo[]>
  objects(): ObjectInfo[]
  removeObject(id: number): boolean
  setTransform(id: number, position: Vec3, rotation: Vec3, scale: Vec3): boolean
  clear(): void
  arrange(): Promise<void>

  /** Slices the current model with the selected presets. onProgress is called on the JS thread. */
  slice(onProgress: (progress: Progress) => void): Promise<SliceResult>
  /** Safe to call from any point while slice() is pending. */
  cancel(): void
  readonly isSliced: boolean
  readonly isBusy: boolean

  /** Writes the G-code of the sliced print. Resolves to the path written. */
  exportGCode(path: string): Promise<string>
  /** Valid after exportGCode(). */
  statistics(): SliceStatistics
}

export interface OrcaCore extends HybridObject<{ ios: 'c++'; android: 'c++' }> {
  /** Version of the slicing core compiled into the app. */
  readonly version: string
  /** Points the core at the app's writable directories. Call once, before creating a session. */
  initialize(resourcesDir: string, dataDir: string): void
  /** Every print, filament and printer option definition as a JSON array; see Session::option_definitions_json. */
  optionDefinitionsJson(): string
  createSession(): OrcaSession
}
