"""Unit tests for the threat-evaluation gate."""

from app.services.alarms import evaluate


def test_non_hostile_never_alarms_even_when_fast_close_confident():
    for cls in ["bird", "airplane", "helicopter", "Bird", " AIRPLANE "]:
        result = evaluate(cls, confidence=0.99, eta_s=1.0, nearest_area="Riyadh", speed_mps=200.0)
        assert result.is_threat is False
        assert result.score == 0
        assert "non_hostile_class" in result.reasons


def test_none_and_unknown_class_are_safe():
    assert evaluate(None, 0.99, 1.0, "Riyadh", 100.0).is_threat is False
    assert evaluate("cls_42", 0.99, 1.0, "Riyadh", 100.0).is_threat is False


def test_hostile_classes_alarm():
    for cls in ["dji", "shahed_136", "orlan", "drone", "SHAHED"]:
        result = evaluate(cls, confidence=0.6, eta_s=20.0, nearest_area="Riyadh", speed_mps=30.0)
        assert result.is_threat is True
        assert result.score >= 60


def test_score_capped_at_100():
    result = evaluate("shahed_136", confidence=0.99, eta_s=5.0, nearest_area="Riyadh", speed_mps=100.0)
    assert result.score <= 100
