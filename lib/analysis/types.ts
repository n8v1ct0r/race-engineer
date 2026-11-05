// Types for the analysis module. The JSON shapes match pipeline/reference/analysis.py output
// field for field (snake_case), so a Comparison from either language compares directly.

export type Origin = "fastf1" | "synthetic" | "photoncar";

/** One lap, race-engineer.lap/v1 (lap-schema.json). Parallel arrays of equal length. */
export type LapSamples = {
  t_ms: number[];
  dist_m: number[];
  speed_kph: number[];
  throttle_pct: (number | null)[];
  brake: (boolean | null)[];
  gear: (number | null)[];
  rpm: (number | null)[];
  x: number[];
  y: number[];
};

export type Lap = {
  schema: "race-engineer.lap/v1";
  origin: Origin;
  track_id: string;
  session_id?: string;
  driver?: string;
  lap_no: number;
  duration_ms: number;
  /** Three official sector times in ms, or null (Photoncar and imports). */
  sector_ms?: number[] | null;
  valid: boolean;
  meta?: Record<string, unknown>;
  samples: LapSamples;
};

/** One official corner marker. label is the raw marker label ("6", "12A"); analysis adds the T. */
export type TrackCorner = { label: string; s_m: number };

/** Per-session track context, race-engineer.track/v1 (track-schema.json). */
export type Track = {
  schema: "race-engineer.track/v1";
  track_id: string;
  L_m: number;
  reference: { lap_id: string; driver?: string | null; lap_no?: number };
  path: { s_m: number[]; x: number[]; y: number[]; speed_kph: number[] };
  corners: TrackCorner[];
  /** Two sector line positions in m along the reference lap, or null. */
  sector_lines_m: number[] | null;
};

/** analysis-config.json. Every analysis constant lives there, never in code. */
export type AnalysisConfig = {
  schema?: string;
  grid_step_m: number;
  align: {
    knot_step_m: number;
    smooth_half_m: number;
    search_window_m: number;
    min_knot_gap_m: number;
  };
  corners: { group_m: number; exit_offset_m: number };
  detector: { smooth_window_m: number; prominence_kph: number; min_spacing_m: number };
  minisectors: { count: number; faint_below_ms: number };
  findings: { top_n: number; min_abs_ms: number; level_speed_kph: number };
  qa?: { distance_tolerance_pct: number; max_gap_ms: number; anchor_flag_ms: number };
  notes?: { max_chars: number };
};

/** Time direction from driver A's view. */
export type Direction = "gains" | "loses" | "level";

/** The three display strings of one time delta: "gains", "0.103 s", "gains 0.103 s". */
export type DeltaDisplay = { direction: Direction; time: string; delta: string };

export type LapMeta = {
  driver: string | null;
  lap_no: number;
  origin: Origin;
  duration_ms: number;
  sector_ms: number[] | null;
  /** Highest raw speed sample of the lap, rounded half away (not the 2 m grid maximum). */
  top_speed_kph: number;
  display: { lap_time: string; top_speed: string };
};

/** One driver's numbers for one corner row. Integers feed display strings; *_float keep raw values. */
export type DriverCorner = {
  min_speed_kph: number;
  min_speed_kph_float: number;
  min_speed_s_m: number;
  /** Lowest sample sits on a segment boundary (flat corner). Never quote it as a minimum. */
  min_edge: boolean;
  brake_s_m: number | null;
  /** Braking point in integer m before the row's first marker (negative means after it). */
  brake_before_m: number | null;
  /** Gap to the previous sample in integer m: the braking point's resolution. */
  brake_gap_m: number | null;
  brake_gap_m_float: number | null;
  brake_at_segment_start: boolean;
  exit_speed_kph: number;
  exit_speed_kph_float: number;
  display: {
    min_speed: string;
    exit_speed: string;
    brake: string | null;
    brake_gap: string | null;
  };
};

export type CornerSource = "official" | "detected";

export type CornerRow = {
  index: number;
  /** Matches ^[TC]\d{1,2}[A-Z]?(-\d{1,2}[A-Z]?)?$ : T4, T12A, T6-7, C3. */
  label: string;
  /** First marker of the row, m along the reference lap. */
  s_m: number;
  s_last_m: number;
  seg_start_m: number;
  seg_end_m: number;
  exit_s_m: number;
  /** Exit point hit the segment end. Never quote a clamped exit speed. */
  exit_clamped: boolean;
  /** Integer ms, A's view: above 0 means A gained. Rows sum exactly to lap_gap_ms. */
  delta_ms: number;
  delta_ms_float: number;
  a: DriverCorner | null;
  b: DriverCorner | null;
  display: DeltaDisplay;
};

export type Faster = "A" | "B" | "tie";

export type MiniSector = {
  index: number;
  s_start_m: number;
  s_end_m: number;
  delta_ms: number;
  delta_ms_float: number;
  faster: Faster;
  /** |delta_ms| below minisectors.faint_below_ms: draw with a lighter tint. */
  faint: boolean;
  display: DeltaDisplay;
};

export type Cause = "braking" | "min_speed" | "exit_speed" | "time_only";

/**
 * Display strings for one finding. Only fields whose check passed are present, so a note built
 * from this object can only quote numbers that passed their checks.
 */
export type DisplayStrings = {
  label: string;
  direction: "gains" | "loses";
  time: string;
  delta: string;
  brake_a?: string;
  brake_b?: string;
  brake_gap_a?: string;
  brake_gap_b?: string;
  brake_diff?: string;
  brake_word?: "later" | "earlier";
  min_speed_a?: string;
  min_speed_b?: string;
  min_speed_diff?: string;
  min_speed_word?: "higher" | "lower";
  exit_speed_a?: string;
  exit_speed_b?: string;
  exit_speed_diff?: string;
  exit_speed_word?: "higher" | "lower";
};

export type Finding = {
  /** "gain-1".."gain-3", "loss-1".."loss-3". */
  id: string;
  kind: "gain" | "loss";
  rank: number;
  corner_index: number;
  label: string;
  delta_ms: number;
  cause: Cause;
  checks: { braking: boolean; min_speed: boolean; exit_speed: boolean };
  /** A's view: above 0 means A brakes later. Null when either braking point is missing. */
  brake_diff_m: number | null;
  /** A minus B, integer km/h. Null when a driver has no samples in the segment. */
  min_speed_diff_kph: number | null;
  exit_speed_diff_kph: number | null;
  display: DisplayStrings;
};

/** One driver's channels on the shared 2 m grid. */
export type GridTrace = {
  t_ms: number[];
  speed_kph: number[];
  throttle_pct: (number | null)[];
  brake: (boolean | null)[];
  gear: (number | null)[];
  x: number[];
  y: number[];
};

export type ComparisonGrid = {
  s_m: number[];
  /** delta(s) = tB(s) - tA(s) in ms; above 0 means A is ahead at s. */
  delta_ms: number[];
  a: GridTrace;
  b: GridTrace;
};

export type Comparison = {
  schema: "race-engineer.comparison/v1";
  /** Length of the common axis in m (the reference lap's integrated distance). */
  L_m: number;
  corner_source: CornerSource;
  /** Delta anchored to official sector splits (both laps have sector_ms and the track has lines). */
  anchored: boolean;
  anchor_ms: { a: number[] | null; b: number[] | null };
  lap_a: LapMeta;
  lap_b: LapMeta;
  /** Integer ms, A's view. Equals the sum of corner rows and the sum of mini-sectors. */
  lap_gap_ms: number;
  lap_gap_ms_float: number;
  display: {
    lap_time_a: string;
    lap_time_b: string;
    gap_direction: Direction;
    gap_time: string;
    gap: string;
  };
  corners: CornerRow[];
  mini_sectors: MiniSector[];
  /** Up to top_n gains (ranked) then up to top_n losses (ranked). Never padded. */
  findings: Finding[];
  grid: ComparisonGrid;
};
