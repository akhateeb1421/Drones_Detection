# Upgrade notes — auth, tracking, and ML overhaul (2026-08-31)

This change set fixes the bugs found in the code review and adds the
requested enhancements. Follow the steps below once to bring a running
install up to date.

## 1. Run the database migration

```bash
cd backend
python -m alembic upgrade head
```

Migration `0007` adds the `users` and `audit_log` tables and two new
columns on `tracks` (`last_speed_mps`, `last_cam_bearing_deg`).

## 2. Add the new settings to backend/.env

```ini
# Secret used to sign login session tokens. If unset, one is derived from
# ADMIN_TOKEN — set it explicitly for production.
AUTH_SECRET=generate_a_long_random_string_here

# Session lifetime (hours).
AUTH_TOKEN_TTL_HOURS=12

# Bootstrap accounts, created automatically on first startup when the
# users table is empty. Usernames default to admin / operator.
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_me_admin
OPERATOR_USERNAME=operator
OPERATOR_PASSWORD=change_me_operator

# Minimum seconds between audible alarms for the same track (live and
# recorded-clip paths both honour this).
ALARM_THROTTLE_S=3.0

# Two-camera triangulation: how recent (seconds) the linked camera's last
# sighting must be, and the maximum plausible target range (metres).
TRIANGULATION_WINDOW_S=3.0
TRIANGULATION_MAX_RANGE_M=20000
```

If `ADMIN_PASSWORD` is unset, the bootstrap admin password falls back to
the value of `ADMIN_TOKEN` (or literally `admin`, with a loud warning in
the logs). Set both passwords before first startup.

## 3. How sign-in works now

* Everyone — operator and admin — signs in on the new login page with a
  username + password. The SERVER decides the role; the old client-side
  role toggle is gone.
* Two accounts are created automatically on first startup: `admin`
  (role admin) and `operator` (role operator), with the passwords from
  `.env`.
* Every REST endpoint except `/health` and `/auth/login` now requires a
  session token. Admin-only actions (camera/area writes, approve/reject,
  debug endpoints) require the admin role. The legacy `X-Admin-Token`
  header is still accepted for tooling/scripts.
* Both WebSockets (`/ws/live/{id}`, `/ws/alarms`) require
  `?token=<session token>` and close with code 4401 otherwise. The
  frontend appends it automatically.
* Privileged actions (logins, approvals, rejections, camera/area edits,
  pause/resume) are recorded in the `audit_log` table; admins can read
  the trail at `GET /auth/audit`.

## 4. Retrain the risk classifier

The classifier had two bugs (serving-time features missing month/weekday,
and a leaky random train/test split). After pulling these changes:

```bash
python ml/train_classifier.py            # time-based split + meta file
python ml/evaluate.py                    # honest post-cutoff metrics
```

Expect the reported metrics to DROP versus the old numbers — the old ones
were inflated by temporal leakage. The new ones are the defensible ones.

## 5. Optional: evaluate the YOLO detector

`ml/evaluate_detector.py` computes per-class precision/recall/mAP, the
confusion matrix, and hostile-boundary rates (missed drones / false
alarms) on a YOLO-format labeled dataset the model was not trained on:

```bash
python ml/evaluate_detector.py --weights models/best_video.pt --data path/to/data.yaml
```

## 6. What changed behaviourally

* **Live speeds/ETAs are now correct.** Velocity comes from a per-track
  constant-velocity Kalman filter fed with real timestamps, so the live
  path's sparse sampling no longer inflates speed (previously ~N× too
  high, where N was the frame gap between YOLO passes).
* The live map shows an **uncertainty cone** around the predicted path
  (from the Kalman heading sigma) and a badge when a position is a
  **two-camera triangulated fix** rather than an assumed-distance
  estimate.
* Cross-camera linking now requires **class compatibility** (a bird can
  no longer link to a Shahed), uses the last observed speed, and skips
  candidates with no heading.
* The audible alarm fires once per new threat (3 s backend throttle per
  track + 10 s client cooldown), and re-alerts immediately only when the
  threat **escalates** (ETA collapses).
* Forecast points now carry `method: "prophet" | "heuristic"`, and the
  heuristic no longer injects fake Gaussian noise.
* Approving a track that is cross-camera-linked to an already-approved
  drone is refused (409) so one incident can't be double-counted.

## 7. Housekeeping

* `frontend/src/components/AdminSignInButton.tsx` is a deprecated stub —
  delete it when convenient.
* `_review_src.tgz` in the project root was a temporary review artifact —
  safe to delete.
* CI: `.github/workflows/ci.yml` runs the backend unit tests (fast subset
  of deps) on every push/PR.
