"""Unit tests for the pure parts of cross-camera linking."""

from app.services.cross_camera import classes_compatible


def test_hostile_spellings_are_mutually_compatible():
    assert classes_compatible("dji", "shahed_136") is True
    assert classes_compatible("drone", "orlan") is True
    assert classes_compatible("Shahed", "DJI") is True


def test_bird_never_links_to_drone():
    assert classes_compatible("bird", "shahed_136") is False
    assert classes_compatible("dji", "bird") is False


def test_non_hostile_requires_exact_match():
    assert classes_compatible("bird", "bird") is True
    assert classes_compatible("bird", "airplane") is False


def test_unknown_class_never_links():
    assert classes_compatible(None, "dji") is False
    assert classes_compatible("dji", "") is False
