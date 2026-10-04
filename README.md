# RMT-KNA — Requirements Management Tool

Implements all of Phase 1 from `requirements-tool-project-brief.md` §12
(ReqView functional parity), all of §5.3/§5.4 from Phase 3 (numeric
parameters, standards library), plus a status-approval workflow with email
notifications that isn't in the brief at all (added by explicit request —
see "Review & approval workflow" below).

Covers: the generic item-type/attribute model (§4.2, §4.4–4.5), the
structural/content hierarchy constraint (§4.3), typed traceability links
with optional source/target restrictions (§4.6), computed section
numbering, LDAP bind-auth with project roles (§13), a local (no-remote) Git
sync of every item to YAML (§7), a tree view and table view with saved
column configurations (§4.8) and a ReqView-style structure toolbar
(move/indent/cut/copy/paste), a traceability matrix with saved views
(§10.3), DB-only baselines (§4.7), XLSX/HTML export with a resolved
`[[glossary]]`/`[[ref:...]]`/`{{param:...}}` appendix (§5.2/§5.3/§5.4/§8),
and a hierarchical relationship graph (§6). Multiple projects and documents
can be created from the UI, not just seeded.

Not included: a real LDAP directory (dev-mode fallback stands in), pushing
the Git sync to a GitLab remote or its inbound webhook, DOCX export (needs
`pandoc`), Alembic migrations, an org-admin role — see "Known
simplifications" below.

## Stack

- **Backend:** FastAPI + SQLAlchemy 2.0 + PostgreSQL (`backend/`)
- **Frontend:** React + TypeScript + Vite + Tailwind v4 + React Query (`frontend/`)
- **Auth:** `ldap3` bind + JWT session (`PyJWT`)
- **Git sync:** local `git` CLI via `subprocess`, one repo per project under `backend/git_sync_repos/`
- **Email:** stdlib `smtplib` when `SMTP_HOST` is configured; otherwise every
  notification is written as a standalone `.html` file under
  `backend/mail_outbox/` instead of failing, so the review/approve flow is
  exercisable without a real mail server

## Prerequisites

Python 3.12, PostgreSQL 16, and `git` are installed/available. Node.js was
already present.

## First-time setup

1. Database user/database already created via `backend/setup_postgres.ps1`
   (run once, from an elevated PowerShell — see that file's header comment
   if you ever need to redo it, e.g. after reinstalling PostgreSQL).

2. Backend:

   ```bash
   cd backend
   .venv/Scripts/python.exe -m app.seed   # creates schema + demo org/project/item types/link types
   .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
   ```

   API docs: http://localhost:8000/docs

   Note: `--reload`'s file watcher has been unreliable in this environment
   (it sometimes reports "Reloading..." without the worker actually picking
   up the new code) — restart the process manually after backend changes
   rather than trusting `--reload`.

   Schema is now Alembic-managed (`backend/alembic/`, DB URL pulled from the
   same `Settings`/`.env` the app uses — nothing to configure separately).
   `app.seed` and `main.py`'s startup still call `Base.metadata.create_all()`
   too, so a fresh dev DB with no migration history bootstraps in one step;
   a real deployment should instead run `alembic upgrade head` before first
   start. After changing a model, generate a migration instead of hand-editing
   the DB:
   ```bash
   cd backend
   .venv/Scripts/python.exe -m alembic revision --autogenerate -m "add whatever"
   .venv/Scripts/python.exe -m alembic upgrade head
   ```
   Always read the generated migration before running it — autogenerate is a
   diff, not a guarantee (it won't detect a column rename, for one).

3. Frontend (separate terminal):

   ```bash
   cd frontend
   npm run dev
   ```

   App: http://localhost:5173 (proxies `/api` to the backend on :8000)

## Logging in

No real LDAP server is configured, so auth runs in **dev fallback mode**:
any username + any non-empty password succeeds. The seed script provisions
a user named `admin` (email `admin@example.com`, so workflow notifications
have somewhere to go) and grants them the `admin` role on every seeded
project — sign in from the top-right corner as `admin` (any password) to
unlock editing. Browsing stays open without logging in wherever a project
is `public` (§13.4); only writes require a role, always (§13.2).

To point this at a real directory instead, set in `backend/.env` (see
`backend/.env.example` for every option). Preferred for a real directory —
Active Directory included — is search-and-bind, which looks the user up
instead of assuming a fixed DN pattern:
```
LDAP_URL=ldaps://your-ldap-host
LDAP_BASE_DN=ou=people,dc=example,dc=com
LDAP_BIND_DN=cn=svc-rmt,ou=service-accounts,dc=example,dc=com
LDAP_BIND_PASSWORD=...
LDAP_USER_SEARCH_FILTER=(sAMAccountName={username})
DEV_AUTH_FALLBACK=false
```
`LDAP_BIND_DN`/`LDAP_BIND_PASSWORD` can be left blank if your directory
allows anonymous search. The older fixed-template mode still works if every
user's DN follows one exact pattern (only used when `LDAP_BASE_DN` is
blank):
```
LDAP_URL=ldaps://your-ldap-host
LDAP_USER_DN_TEMPLATE=uid={username},ou=people,dc=example,dc=com
DEV_AUTH_FALLBACK=false
```

To send real emails instead of writing to `backend/mail_outbox/`, set in
`backend/.env`:
```
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USERNAME=...
SMTP_PASSWORD=...
MAIL_FROM=rmt@your-domain.com
APP_BASE_URL=https://your-deployed-frontend-url
```

## What to try

- **Projects (landing page)** — `/` lists every project as a card; open one
  to see its documents, also as cards.
- **Sidebar** — collapsible (the `‹`/`›` strip between it and the content),
  persists across reloads, and inside a project is a vertical accordion of
  four sections — **Table of contents**, **Documents**, **Views**,
  **Project** — stacked one above the other with exactly one expanded at a
  time (opening one collapses whichever was open, not independent
  per-section collapsing). Table of contents lists the open document's
  sections, nested to their real depth, and jumps straight to one (Tree
  View selects it; Document View scrolls to it and briefly flashes it);
  empty until a document is open. Documents shows every document grouped
  into its (flat, one-level) group plus an "Ungrouped" bucket, mirroring
  the grouping managed on the project page. Views has Tree/Table/Document
  View + Split-view for whichever document is open, Export XLSX/HTML, "⚖
  Review & approval", and every saved Table View as a direct link. Project
  has Traceability Matrix and Parameters. "Documents" (the project home)
  isn't its own entry — the project name in the top bar already goes there
  — and neither is "Graph" (only meaningful centered on an item, reached
  via an item's "View Graph" link) or "⚙ Project settings" / "Baselines"
  (both live on the project home page now, alongside the document cards).
- **Document groups** (§ not in the brief — added by request) — an
  optional, flat (no nesting) way to organize a project's documents beyond
  a flat list, managed from the project home page: "+ New group", a
  per-document dropdown to move it into one, double-click a group's heading
  to rename it, "Delete group" ungroups its documents rather than deleting
  them. The sidebar's Documents tab renders the same grouping read-only.
- **Tree View / Table View structure toolbar** — select an item, then
  ↑/↓ reorder among siblings, ⇤/⇥ outdent/indent (only onto/off of a
  Section), ⧉ copy or ✂ cut, then select a target and 📋 paste — pasting
  onto a Section drops the item inside it, onto a content item places it
  right after. The clipboard is shared between Tree View and Table View (and
  across documents) via `ItemClipboardContext`, so cut-here/paste-there
  survives switching views. Word-style numbering (`1`, `1.1`, `1.2`, …)
  recomputes automatically.
- **Table View search** — one box instead of a type dropdown: free text
  matches key/title/description; a `type:Requirement` token narrows to one
  item type (fuzzy-matched against name/key/prefix) and unlocks column
  customization + saved views for it, same as the old dropdown did.
- **Detail panel is opt-in** — clicking a row/title only selects it
  (for the structure toolbar); a "Details ▸" button (hover in Table View,
  always visible in Tree View) or a link-column entry opens the side panel
  explicitly, so browsing a table doesn't keep popping up a panel.
- **Point-and-click linking** — every content row gets small "•→" (source)
  / "→•" (target) buttons on hover. Mark one item as source and another as
  target — in the same pane, across split-view panes, or across Tree/Table
  View — and a popup appears to pick the link type and confirm. Creating a
  link that already exists (same source/target/type) is now rejected with a
  friendly 409 instead of silently duplicating (there's a DB unique
  constraint backing this up too).
- **Review & approval workflow** (§ not in the brief — added by request,
  modeled loosely on DOORS/Polarion):
  - Assign **reviewers**/**approvers** per document from the sidebar's
    "⚖ Review & approval" panel — distinct from the project-wide RBAC
    `reviewer` role (`project_access`), which only gates read access; this
    is sign-off *authority* (`document_workflow_roles`).
  - In Item Types admin, an enum attribute's options can be flagged
    `requires_approval` (only an assigned approver, or a project admin, can
    set an item's Status to it — a plain edit is rejected with a 422
    explaining why) and/or `notify_reviewers` (a plain edit into that value
    emails the document's reviewers+approvers that something needs
    attention). Seeded on the `status` attribute: `In Review` → notify,
    `Approved` → requires approval.
  - The detail panel shows "Approve → X" buttons for any gated status the
    item isn't already at, with an optional note; approving stamps
    `approved_by`/`approved_at` and is flagged **stale** if the item is
    edited again afterward (`approval_stale`, banner in the detail panel).
  - "Approve whole document" (same sidebar panel) bulk-approves every
    content item with a matching gated status in one action.
  - Every transition above emails the relevant people — self-contained
    (project/document/item/status/who/optional note + a deep link straight
    to that item, `?item=<id>` on the Tree/Table route) rather than a bare
    "something changed" ping. Check `backend/mail_outbox/` in dev mode.
- **Comments** (§ not in the brief — added by request, GitHub-PR/Google-Docs
  style rather than arbitrary nesting) — a "Comments" section at the bottom
  of every content item's detail panel (and inline in Document View's right
  margin). Post a top-level comment, reply to it (one level of replies per
  thread, not infinitely nested), edit or delete your own comments, and mark
  a whole thread "✓ resolved" (by its author or a project editor) — a
  resolved thread stays visible, greyed in, with who resolved it and when,
  and can be reopened. Type `@` in the comment box to pick a user from the
  org directory (autocomplete, same list the workflow role pickers use) —
  mentioning someone emails them a link straight to the comment. Otherwise
  doesn't send email notifications yet (a plain new comment/reply, with no
  `@mention`, stays silent) — see "Known simplifications".
- **Document View** (§ not in the brief — added by request) — every item in
  reading order like a printed spec: numbered section headings, each
  requirement as a borderless block (ID, description, status/type badges,
  other populated attributes, links), meant for reviewers who aren't
  systems engineers. A left-margin icon per item shows its link count and
  comment state (open/resolved/none); clicking the comment icon opens that
  item's thread inline in the right margin, Word/Google-Docs style — a
  thread with an unresolved comment is already open on load, no click
  needed. Read/comment only, no inline editing.
- **Standards Library** (§5.4, org-wide — `/standards` in the home
  sidebar) — add a standard as an uploaded PDF or an external link, add
  locators (e.g. "Clause 5.4.2", optionally a page number) once, then cite
  it from any item's description with `[[ref:CODE#locator]]`. Resolves to
  an interactive chip (in the detail panel's live preview and in HTML
  export) that opens the PDF/link at that page (`#page=N`); marking a
  standard "superseded by" a newer one flags every existing citation with
  ⚠ instead of breaking them. A consistency report calls out standards
  never cited and citations pointing at a superseded version.
- **Reference Documents** (§5.4, per-project — "⚙ Project settings" →
  Reference Documents tab) — same citation mechanism, but scoped to one
  project and following its own visibility/ACL instead of being org-wide
  (e.g. the analysis backing a specific requirement's rationale).
- **Parameters** (§5.3, Valispace-style — a project's sidebar →
  "Parameters") — numeric variables referenced from any item's description
  with `{{param:KEY}}`. A `constant` just holds a value; a `derived`
  parameter has a `formula` over other parameters' keys (`+ - * /` and
  parentheses only — a restricted AST evaluator, never `eval()`) that's
  recomputed on read, with cycle detection. Every item that references a
  parameter is tracked as "used in" traceability automatically
  (`parameter_links`, kept in sync on every item save) — click "N used in"
  on a parameter to see exactly which items cite it.
- **Traceability Matrix** — pick a row type, column type, and link type
  (e.g. Requirement × Verification Activity via "Verifies") to see a
  coverage grid; uncovered rows are called out above the table. Save a
  combination as a named, Shared-or-Personal view (Personal views are only
  ever visible to whoever saved them).
- **Graph** — open an item's detail panel and click "View Graph" to center
  a hierarchical relationship graph on it, with independent up/down depth
  controls, edge labels naming the link type, an optional "Show
  description" toggle per node, click-to-select, and double-click-to-re-center.
- **Glossary** — org-wide (§5.2): define `[[ABBR]]` terms once, reference
  them from any item's description *or* any `rich_text` attribute (e.g.
  Justification) — both get the same live preview and the same resolution
  in HTML export now. Import/export the whole glossary as XLSX, same
  round-trip shape as a requirements export. A consistency report surfaces
  unused terms / undefined references.
- **Baselines** — freeze every item/link in the project as of right now
  under a name; the snapshot is stored as JSON. The Git Sync Log below it
  shows every local commit triggered by item writes (§7) — the two aren't
  tied together yet (`baselines.git_commit_sha` stays null), and a baseline
  doesn't yet freeze parameter values or which standard version was cited
  (§5.3/§5.4 both call this out as important — see "Known simplifications").
- **Deleting an item** — the detail panel's "Delete" button asks for
  confirmation and, for a Section, tells you up front how many nested
  items will go with it.
- **Roles** — sign out and confirm reads still work on the public Demo
  Project but every "Add"/"Save"/"Delete" now fails with "Requires at
  least 'editor' role..."; sign back in as `admin` to restore editing.

## Known simplifications (flagged, not forgotten)

- **Comments only email on `@mention`.** A new comment, a reply, or a
  resolved/reopened thread doesn't notify anyone by itself — no equivalent
  of the workflow's "review requested"/"approved" emails exists for plain
  comment activity — so keeping up with a discussion still means checking
  back in the app unless someone explicitly `@mentions` you.
- **Alembic is set up, but the pre-Alembic history isn't captured as
  individual migrations.** Everything up to and including document groups
  was folded into one `baseline` revision generated by autogenerating
  against an empty database and stamped onto the existing dev DB (so it
  matches `head` without re-running). That means the version history starts
  from "everything so far," not from each schema change made along the way
  — fine, since nothing depended on the intermediate steps, but worth
  knowing before assuming `alembic history` tells the whole story. Every
  schema change from here on should be its own migration.
- **Auth is dev-mode by default** (see "Logging in" above) — no MFA/SSO,
  and granting/revoking project access (`POST/DELETE .../access`) has no
  admin-approval queue (§13.5 is explicitly Phase 3).
- **No org-admin role.** Reading the schema/glossary/standards is correctly
  open to everyone per §13.3, but so is *writing* item types/link
  types/standards today by anyone logged in (glossary/standards) or even
  anonymously (item types/link types) — there's no org-level admin role
  modeled yet to gate that with (only per-project roles exist).
- **Git sync is local-only.** No push to a GitLab remote, no inbound
  webhook receiver — both need a real GitLab instance to build/test
  against. Deleting a Section also only removes its own YAML file, not its
  cascade-deleted children's (a known gap, not silent data loss — the DB
  side deletes correctly).
- **Table/Matrix Views** have save/load, shared-vs-personal (now enforced
  server-side — a personal view only lists for its owner), and the
  `filters`/`sort` JSON columns exist on both models — but there's no UI
  yet to actually build a filter or a sort order, so those columns always
  save `null`.
- **DOCX export isn't built** — needs `pandoc` as a subprocess dependency
  (§8.2); XLSX and HTML both work today. Export is synchronous (no job
  queue) since it's fast enough for a single document — revisit before
  real project sizes.
- **Workflow is a project-specific convention, not a generic engine.** The
  gated attribute is always whichever `enum` attribute is keyed exactly
  `"status"` — matching how every seeded content type already defines one —
  rather than letting an org configure an arbitrary field/workflow. Also:
  approval history is "latest only" (`items.approved_by_id`/`approved_at`),
  not a full audit log.
- **Parameters have no unit conversion** (Nm vs. N·m vs. lb·ft, as the
  brief itself flags) and baselines don't freeze parameter values or cited
  standard versions yet — an export "as of baseline X" still shows today's
  live parameter values/standard versions, not what was true at baseline
  time.
- **Standards/Reference Document PDFs are stored on local disk**
  (`backend/reference_files/`), not S3 — fine for one machine, not for a
  real multi-instance deployment. There's no in-app PDF page viewer either;
  citations just open the file/link in a new tab with a `#page=N` fragment
  and rely on the browser's own PDF viewer.
- **Graph traversal direction is a project convention, not the brief's.**
  "up" = outgoing links, "down" = incoming links (documented in
  `app/services/graph.py`) — reasonable, but worth confirming against how
  your organization actually thinks about it.
