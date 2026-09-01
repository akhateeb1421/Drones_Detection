"""Set (or reset) a user account's password from the command line.

The bootstrap accounts are created ONCE, on the first startup with an
empty users table — editing ADMIN_PASSWORD / OPERATOR_PASSWORD in .env
afterwards does NOT change an existing account. Use this script instead:

    cd backend
    python -m seed.set_password admin
    python -m seed.set_password operator --password newpass123

With no --password flag it prompts securely (input hidden). If the
username doesn't exist yet it is created (role defaults to 'operator';
pass --role admin to create an admin).
"""

from __future__ import annotations

import argparse
import getpass
import sys

from sqlalchemy import select

from app.core.db import SessionLocal
from app.core.security import hash_password
from app.models import User
from app.services.audit import audit


def main() -> None:
    parser = argparse.ArgumentParser(description="Set or reset a user's password.")
    parser.add_argument("username", help="Account to update (created if missing).")
    parser.add_argument("--password", default=None, help="New password (omit to be prompted securely).")
    parser.add_argument(
        "--role", default=None, choices=["admin", "operator"],
        help="Role when CREATING a new account (existing accounts keep their role unless this is passed).",
    )
    args = parser.parse_args()

    password = args.password
    if not password:
        password = getpass.getpass(f"New password for '{args.username}': ")
        confirm = getpass.getpass("Repeat password: ")
        if password != confirm:
            sys.exit("Passwords do not match — nothing changed.")
    if len(password) < 4:
        sys.exit("Password too short — nothing changed.")

    with SessionLocal() as db:
        user = db.execute(select(User).where(User.username == args.username)).scalar_one_or_none()
        if user is None:
            role = args.role or "operator"
            user = User(username=args.username, password_hash=hash_password(password), role=role)
            db.add(user)
            audit(db, "cli", "user_create", {"username": args.username, "role": role})
            print(f"Created user '{args.username}' with role '{role}'.")
        else:
            user.password_hash = hash_password(password)
            if args.role and args.role != user.role:
                print(f"Role changed: {user.role} -> {args.role}")
                user.role = args.role
            audit(db, "cli", "password_reset", {"username": args.username})
            print(f"Password updated for '{args.username}' (role: {user.role}).")
        db.commit()
    print("Done. Sign in with the new password — existing sessions stay valid until they expire.")


if __name__ == "__main__":
    main()
