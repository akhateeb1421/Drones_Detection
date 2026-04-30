"""Predicted-path helper used by the live map."""

from app.services.geo import project_path


def predicted_line(
    lat: float, lon: float, speed_mps: float, angle_deg: float, seconds_ahead: float = 60.0
) -> list[list[float]]:
    """Return [[lat,lon], [lat',lon']] for the React polyline."""
    end_lat, end_lon = project_path(lat, lon, speed_mps, angle_deg, seconds_ahead)
    return [[lat, lon], [end_lat, end_lon]]
