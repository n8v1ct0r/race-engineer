"""Display formatter. Twin: lib/analysis/format.ts (docs/contracts.md section 5).

Every number that can reach the UI or a note is formatted here, once, from an integer.
Never use round(), f-string rounding or '%' rounding on a value that reaches the UI or a note.
"""

import math


def round_half_away(x):
    """Round to the nearest integer, halves away from zero. Never returns -0.

    Twin: format.ts roundHalfAway(). Python round(12.5) is 12 and JS Math.round(-2.5) is -2;
    this gives 13 and -3 in both languages.
    """
    r = int(math.floor(abs(x) + 0.5))
    return -r if (x < 0 and r != 0) else r


def _require_int(value, name):
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError(f"{name} must be an integer, got {value!r}")


def direction_word(ms):
    """Twin: format.ts directionWord(). A's view: > 0 gains, < 0 loses, 0 level."""
    _require_int(ms, "ms")
    if ms > 0:
        return "gains"
    if ms < 0:
        return "loses"
    return "level"


def format_seconds(ms):
    """Twin: format.ts formatSeconds(). Integer ms to an unsigned magnitude in seconds, 3 dp: 1250 -> '1.250'."""
    _require_int(ms, "ms")
    m = -ms if ms < 0 else ms
    frac = str(m % 1000)
    while len(frac) < 3:
        frac = "0" + frac
    return str(m // 1000) + "." + frac


def format_time(ms):
    """Twin: format.ts formatTime(). '0.103 s' (magnitude, no sign)."""
    return format_seconds(ms) + " s"


def format_time_delta(ms):
    """Twin: format.ts formatTimeDelta(). 'gains 0.103 s', 'loses 0.084 s' or 'level'."""
    word = direction_word(ms)
    if word == "level":
        return "level"
    return word + " " + format_time(ms)


def delta_display(ms):
    """Twin: format.ts deltaDisplay(). The three display strings of one time delta."""
    return {"direction": direction_word(ms), "time": format_time(ms), "delta": format_time_delta(ms)}


def format_lap_time(ms):
    """Twin: format.ts formatLapTime(). Integer ms to 'm:ss.sss': 85371 -> '1:25.371'."""
    _require_int(ms, "ms")
    if ms < 0:
        raise ValueError("lap time must not be negative")
    minutes = ms // 60000
    rest = ms % 60000
    secs = str(rest // 1000)
    if len(secs) < 2:
        secs = "0" + secs
    frac = str(rest % 1000)
    while len(frac) < 3:
        frac = "0" + frac
    return str(minutes) + ":" + secs + "." + frac


def format_speed(kph):
    """Twin: format.ts formatSpeed(). Integer km/h, unsigned: '234 km/h'."""
    _require_int(kph, "kph")
    return str(-kph if kph < 0 else kph) + " km/h"


def format_percent(pct):
    """Twin: format.ts formatPercent(). Integer percent, unsigned: '85%'."""
    _require_int(pct, "pct")
    return str(-pct if pct < 0 else pct) + "%"


def format_distance(m):
    """Twin: format.ts formatDistance(). Integer m, unsigned: '54 m'."""
    _require_int(m, "m")
    return str(-m if m < 0 else m) + " m"


def format_brake_point(before_m):
    """Twin: format.ts formatBrakePoint(). Integer m before the row's first marker: '54 m before' or '12 m after'."""
    _require_int(before_m, "before_m")
    if before_m < 0:
        return format_distance(before_m) + " after"
    return format_distance(before_m) + " before"


def later_earlier(diff_m):
    """Twin: format.ts laterEarlier(). A's braking point relative to B: > 0 later, < 0 earlier, 0 same."""
    _require_int(diff_m, "diff_m")
    if diff_m > 0:
        return "later"
    if diff_m < 0:
        return "earlier"
    return "same"


def higher_lower(diff):
    """Twin: format.ts higherLower(). A's speed relative to B: > 0 higher, < 0 lower, 0 same."""
    _require_int(diff, "diff")
    if diff > 0:
        return "higher"
    if diff < 0:
        return "lower"
    return "same"
