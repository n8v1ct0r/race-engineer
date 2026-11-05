"""Lap QA rules shared by the two lap producers: pipeline/export_sessions.py and pipeline/synthetic.py.

Stdlib only, so pnpm test:py runs it without the export venv. docs/contracts.md section 3 states
the rules.
"""

from pipeline.reference.format import round_half_away

# Channels whose null samples make a lap low confidence: the ones the charts and the readout show.
# rpm is neither shown nor analyzed, so a null rpm sample does not flag a lap.
UNKNOWN_CHANNELS = (("throttle_pct", "Throttle"), ("brake", "Brake"), ("gear", "Gear"))


def throttle_pct(raw):
    """Integer throttle position from a present raw value, or None when it is outside 0 to 100.

    FastF1 car data sometimes carries a sentinel above 100 (104). It is not a throttle position,
    so it becomes null and unknown_notes() flags the lap. It is never clamped to 100.
    """
    if raw < 0 or raw > 100:
        return None
    return round_half_away(raw)


def unknown_notes(samples):
    """One sentence-case QA note per shown channel with null samples: "Throttle unknown at 2 samples"."""
    notes = []
    for key, name in UNKNOWN_CHANNELS:
        n = sum(1 for v in samples[key] if v is None)
        if n > 0:
            notes.append(f"{name} unknown at {n} sample" + ("" if n == 1 else "s"))
    return notes
