"""Saudi place lookup for splitting combined attack locations."""

from __future__ import annotations

import re

# (lat, lon) for known places. All lookups are case-insensitive on a
# normalized form (lowercased, punctuation stripped). Add more here as the
# dataset grows. Coordinates are approximate centers.
PLACE_COORDS: dict[str, tuple[float, float]] = {
    # major cities
    "riyadh": (24.7136, 46.6753),
    "jeddah": (21.4858, 39.1925),
    "mecca": (21.4225, 39.8262),
    "makkah": (21.4225, 39.8262),
    "medina": (24.5247, 39.5692),
    "madinah": (24.5247, 39.5692),
    "dammam": (26.4207, 50.1063),
    "khobar": (26.2172, 50.1971),
    "tabuk": (28.3998, 36.5700),
    "abha": (18.2164, 42.5053),
    "buraidah": (26.3260, 43.9750),
    "khamis mushait": (18.3000, 42.7333),
    "hofuf": (25.3833, 49.5833),
    "hail": (27.5114, 41.7208),
    "najran": (17.5656, 44.2289),
    "yanbu": (24.0883, 38.0617),
    "yanbu port": (24.0900, 38.0500),
    "yanbu industrial city": (24.0167, 38.1833),
    "yanbu refinery": (24.0900, 38.0700),
    "yanbu petroleum facility": (24.0900, 38.0700),
    "area-a": (24.7136, 46.6753),
    "area-b": (24.6877, 46.7219),
    "area-c": (24.7441, 46.6180),
    "area-d": (24.6600, 46.7100),
    "area-e": (24.7900, 46.6400),
    "jubail": (27.0046, 49.6582),
    "qatif": (26.5167, 50.0167),
    # regions / governorates
    "eastern region": (26.4207, 50.0888),
    "al-kharj": (24.1503, 47.3346),
    "al kharj": (24.1503, 47.3346),
    "kharj": (24.1503, 47.3346),
    "al-jouf": (29.9697, 40.2064),
    "al jouf": (29.9697, 40.2064),
    "jouf": (29.9697, 40.2064),
    "hafr al-batin": (28.4328, 45.9708),
    "hafr al batin": (28.4328, 45.9708),
    "asir": (18.2164, 42.5053),
    "qassim": (26.3260, 43.9750),
    # specific facilities
    "prince sultan air base": (24.0617, 47.5805),
    "riyadh airport": (24.9576, 46.6989),
    "king khalid international airport": (24.9576, 46.6989),
    "ras tanura oil refinery": (26.6388, 50.1583),
    "ras tanura": (26.6388, 50.1583),
    "abqaiq": (25.9357, 49.6708),
    "shaybah field": (22.5333, 53.9667),
    "shaybah": (22.5333, 53.9667),
    "empty quarter": (22.5333, 54.0000),
    "embassy district": (24.6877, 46.7219),
    "embassy district – riyadh": (24.6877, 46.7219),
    "embassy district - riyadh": (24.6877, 46.7219),
    # qualifiers seen in data
    "east of kharj city": (24.1503, 47.3346),
    "east of kharj governorate": (24.1503, 47.3346),
    "east of al-jouf region": (29.9697, 40.2064),
    "riyadh region": (24.7136, 46.6753),
}


def _normalize(name: str) -> str:
    s = (name or "").strip().lower()
    s = re.sub(r"[\u2010-\u2015\-]+", "-", s)         # unify dashes
    s = re.sub(r"\s+", " ", s)
    s = s.strip()
    return s


def lookup(name: str) -> tuple[float, float] | None:
    """Return (lat, lon) for a known place name, or None if not in the dictionary."""
    if not name:
        return None
    n = _normalize(name)
    if n in PLACE_COORDS:
        return PLACE_COORDS[n]
    # Try also without leading "east of", "north of", etc.
    for prefix in ("east of ", "west of ", "north of ", "south of "):
        if n.startswith(prefix):
            stripped = n[len(prefix) :].strip()
            if stripped in PLACE_COORDS:
                return PLACE_COORDS[stripped]
    return None


def split_locations(target_location: str | None) -> list[str]:
    """Split a target_location string on '+' and return cleaned parts."""
    if not target_location:
        return []
    parts = [p.strip() for p in str(target_location).split("+")]
    return [p for p in parts if p]
