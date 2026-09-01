"""Evaluate the YOLO detector itself: per-class precision/recall/mAP and a
confusion matrix (drone-vs-bird confusion is the failure mode the alarm
gate depends on, so it gets called out explicitly).

Requirements
------------
A YOLO-format labeled dataset that the model has NOT been trained on —
ideally frames from held-out clips. Layout (standard ultralytics):

    dataset/
      data.yaml          # names: [...], val: images/val (or test:)
      images/val/*.jpg
      labels/val/*.txt   # class cx cy w h (normalized)

Run:
    python ml/evaluate_detector.py --weights models/best_video.pt \
        --data dataset/data.yaml [--imgsz 640] [--split val] [--conf 0.25]

Outputs the per-class table, overall mAP50/mAP50-95, and the confusion
matrix, plus a JSON summary in ml/artifacts/detector_eval.json.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

# The hostile/non-hostile split the alarm gate uses. Confusions across
# this boundary are operational failures: hostile→non-hostile means a
# missed alarm, non-hostile→hostile means a false alarm.
HOSTILE = {
    "shahed", "shahed_136", "shahed-136", "shahed136",
    "orlan", "orlan-10", "orlan10", "orlan_10",
    "dji", "drone",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--weights", required=True, help="Path to the .pt weights to evaluate.")
    parser.add_argument("--data", required=True, help="Path to the dataset's data.yaml.")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--split", default="val", choices=["val", "test", "train"])
    parser.add_argument("--conf", type=float, default=0.25)
    parser.add_argument("--out", default=str(REPO / "ml" / "artifacts" / "detector_eval.json"))
    args = parser.parse_args()

    from ultralytics import YOLO  # heavy import, deferred

    model = YOLO(args.weights)
    metrics = model.val(
        data=args.data,
        imgsz=args.imgsz,
        split=args.split,
        conf=args.conf,
        plots=True,  # writes confusion_matrix.png etc. into the run dir
        verbose=True,
    )

    names = [metrics.names[i] for i in sorted(metrics.names)]
    per_class = {}
    # metrics.box.p/r are per-class arrays aligned with ap_class_index.
    for idx, cls_i in enumerate(metrics.box.ap_class_index):
        cls_name = metrics.names[int(cls_i)]
        per_class[cls_name] = {
            "precision": float(metrics.box.p[idx]),
            "recall": float(metrics.box.r[idx]),
            "ap50": float(metrics.box.ap50[idx]),
            "ap50_95": float(metrics.box.ap[idx]),
        }

    # Confusion matrix: rows = predicted, cols = true (ultralytics
    # convention), with an extra background row/col at the end.
    cm = metrics.confusion_matrix.matrix
    labels = names + ["background"]

    # Hostile-boundary summary — the numbers that matter to the alarm gate.
    def is_hostile(name: str) -> bool:
        return name.lower().strip() in HOSTILE

    missed_hostile = 0.0    # true hostile predicted as non-hostile/background
    false_hostile = 0.0     # true non-hostile/background predicted hostile
    total_hostile_truth = 0.0
    for pi, pname in enumerate(labels):
        for ti, tname in enumerate(labels):
            v = float(cm[pi][ti])
            true_h = tname != "background" and is_hostile(tname)
            pred_h = pname != "background" and is_hostile(pname)
            if true_h:
                total_hostile_truth += v
                if not pred_h:
                    missed_hostile += v
            elif pred_h:
                false_hostile += v

    print("\n=== Per-class metrics ===")
    for cls_name, m in per_class.items():
        print(
            f"  {cls_name:<14} P={m['precision']:.3f}  R={m['recall']:.3f}  "
            f"AP50={m['ap50']:.3f}  AP50-95={m['ap50_95']:.3f}"
        )
    print(f"\n  overall mAP50    = {float(metrics.box.map50):.3f}")
    print(f"  overall mAP50-95 = {float(metrics.box.map):.3f}")
    print("\n=== Hostile boundary (what the alarm gate sees) ===")
    if total_hostile_truth > 0:
        print(f"  missed-hostile rate (would-be missed alarms): {missed_hostile / total_hostile_truth:.3%}")
    print(f"  false-hostile detections (would-be false alarms): {int(false_hostile)}")
    print("\n=== Confusion matrix (rows=predicted, cols=true) ===")
    print("  " + " ".join(f"{n[:9]:>10}" for n in labels))
    for pi, pname in enumerate(labels):
        row = " ".join(f"{int(cm[pi][ti]):>10}" for ti in range(len(labels)))
        print(f"  {pname[:12]:<12} {row}")

    out = {
        "weights": str(args.weights),
        "data": str(args.data),
        "split": args.split,
        "imgsz": args.imgsz,
        "map50": float(metrics.box.map50),
        "map50_95": float(metrics.box.map),
        "per_class": per_class,
        "confusion_matrix": {"labels": labels, "matrix": [[int(v) for v in row] for row in cm]},
        "hostile_boundary": {
            "missed_hostile": int(missed_hostile),
            "total_hostile_truth": int(total_hostile_truth),
            "false_hostile": int(false_hostile),
        },
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=2))
    print(f"\nSaved JSON summary to {out_path}")
    print("Plots (confusion_matrix.png, PR curves) are in the ultralytics run directory printed above.")


if __name__ == "__main__":
    main()
