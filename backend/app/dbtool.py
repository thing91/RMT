"""Whole-database export / import from the command line.

    python -m app.dbtool export rmt-2026-10-05.zip
    python -m app.dbtool inspect rmt-2026-10-05.zip
    python -m app.dbtool import rmt-2026-10-05.zip            # into an empty database
    python -m app.dbtool import rmt-2026-10-05.zip --replace  # overwrite everything

The database is the one in DATABASE_URL (backend/.env). Import recreates
the schema at the export's version, loads the data and migrates it to the
current version, in a single transaction.
"""

import argparse
import json
import sys

from app.database import engine
from app.services import dbdump


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.dbtool", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("export", help="write the whole database to a .zip")
    p.add_argument("file")
    p.add_argument("--no-files", action="store_true", help="leave out uploaded PDFs")
    p = sub.add_parser("import", help="load a .zip export into this database")
    p.add_argument("file")
    p.add_argument("--replace", action="store_true", help="drop everything in the target database first")
    p.add_argument("--no-upgrade", action="store_true", help="keep the export's schema version (don't migrate)")
    p = sub.add_parser("inspect", help="show what an export contains")
    p.add_argument("file")
    args = parser.parse_args(argv)

    try:
        if args.cmd == "export":
            manifest = dbdump.export_database(
                engine, args.file, None if args.no_files else dbdump.default_files_dir(), dbdump.app_version()
            )
            total = sum(manifest["tables"].values())
            print(f"Exported {total} rows from {len(manifest['tables'])} tables and {len(manifest['files'])} files "
                  f"(schema {manifest['alembic_revision']}) to {args.file}")
        elif args.cmd == "inspect":
            print(json.dumps(dbdump.read_manifest(args.file), indent=2))
        else:
            if args.replace:
                answer = input("This deletes everything in the target database. Type REPLACE to continue: ")
                if answer.strip() != "REPLACE":
                    print("Cancelled.")
                    return 1
            result = dbdump.import_database(
                engine, args.file, dbdump.default_files_dir(), replace=args.replace, upgrade_to_head=not args.no_upgrade
            )
            print(f"Imported {sum(result['loaded'].values())} rows into {len(result['loaded'])} tables "
                  f"(export schema {result['manifest']['alembic_revision']}"
                  f"{'' if args.no_upgrade else ', migrated to ' + dbdump.head_revision()}).")
    except dbdump.DumpError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
