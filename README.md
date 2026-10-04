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
- **Review & approval roles per document** — the sidebar's "⚖ Review &
  approval" panel assigns **reviewers**/**approvers** per document
  (`document_workflow_roles`): sign-off *authority* used by workflow
  transitions (`doc:approver` / `doc:reviewer`), distinct from the project
  RBAC `reviewer` role. The same panel runs one transition on every eligible
  item of the document at once (e.g. approve everything In Review).
- **Comments** (§ not in the brief — added by request, GitHub-PR/Google-Docs
  style rather than arbitrary nesting) — a "Comments" section at the bottom
  of every content item's detail panel (and inline in Document View's right
  margin). Post a top-level comment, reply to it (one level of replies per
  thread, not infinitely nested), edit or delete your own comments, and mark
  a whole thread "✓ resolved" (by its author or a project editor) — a
  resolved thread stays visible, greyed in, with who resolved it and when,
  and can be reopened. Type `@` in the comment box to pick a user from the
  org directory (autocomplete, same list the workflow role pickers use) —
  mentioning someone emails them a link straight to the comment. Every new
  comment/reply also notifies the item's watchers and the thread's
  participants (bell + email); commenting makes you a watcher. A thread can
  be turned into a formal change suggestion ("→ Make it a suggestion").
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
  under a name: the exact item versions, parameter values and the
  applicability matrix. Tick "Milestone" (project admins) to make the frozen
  items read-only outside Draft until a change request is accepted. The Git
  Sync Log below shows every local commit triggered by item writes (§7) —
  not tied to baselines yet (`baselines.git_commit_sha` stays null).
- **Deleting an item** — requirements are retired with the "Make obsolete"
  transition, never deleted, so history and traceability survive (the tree
  hides obsolete items unless "Show obsolete" is ticked). Only a brand-new,
  untouched item (version 1, no links, no comments) or an empty section can
  be deleted.
- **Roles** — sign out and confirm reads still work on the public Demo
  Project but every "Add"/"Save"/"Delete" now fails with "Requires at
  least 'editor' role..."; sign back in as `admin` to restore editing.

## Concurrency, workflow & change management

Implements `wymagania-wspolbieznosc-i-workflow.md` (the plan and its status
are in `docs/PLAN-wdrozenia.md`). Backend tests: `cd backend &&
.venv/Scripts/python.exe -m pytest` (runs against an isolated `rmt_test`
schema in the dev database; `pip install -r requirements-dev.txt` first).

- **Permissions** — every project role maps to named permissions
  (`item.edit`, `structure.edit`, `lock.override`, `suggestion.resolve`,
  `applicability.decide/approve`, `workflow.configure`, …; see
  `app/services/permissions.py`). An org can grant/revoke single
  permissions per role (`PUT /organizations/{id}/role-permissions`). An
  **org admin** (`users.org_role = "admin"`, the seeded `admin`) is project
  admin everywhere in the org and holds the org permissions
  (`roadmap.manage`, `library.release`, `workflow.configure_org`).
- **Edit locks (leases)** — "✎ Edit" in the item details takes the item's
  lock, a heartbeat keeps it alive, Save/Cancel (or closing the tab, via
  `sendBeacon`) releases it, and it expires on its own after
  `EDIT_LOCK_TIMEOUT_MINUTES` (default 10) — no orphaned locks. Others see
  "✎ Anna is editing (3 min)" in the tree and a read-only panel, can ask to
  be notified when it's free, and `lock.override` holders can release or
  take it over (audited, previous holder notified).
- **Optimistic concurrency** — every item has a version (`ETag:
  "<id>:<n>"`); every content write must send `If-Match`, otherwise 428; a
  stale one gets 412 with a diff of what changed, shown as a conflict
  dialog (discard mine / apply mine on top / copy mine). Applies to API
  clients too, not just the UI.
- **Structure lock** — moving/reordering takes a short implicit lease on
  the document structure (others' moves wait ~90 s); "⇅ Reorganize…" takes
  an explicit one. Structure and content never block each other.
- **Versions & audit** — every content change is a new version
  (`item_versions`): History tab with word diffs between any two versions
  and the exact text of every approved version. Workflow transitions,
  overrides, deletions, permission changes etc. go to the append-only
  `audit_events` log (project → "Change requests & suspect links" → Audit).
- **Configurable workflows** — `/admin/workflows` (org default per item
  type) and a project's "Workflows" page (override). Templates: Basic,
  Change-managed (default for requirements), Regulated (e-signature,
  author can't approve own requirement, no open comments/Major
  suggestions, verification tied to passing linked tests) and Test case.
  Each transition has roles, conditions and actions; edit as JSON.
  The status attribute's values are generated from the workflow states, and
  status can only change through transitions.
- **Change management** — Approved → "Request change" creates a change
  request with impact analysis (linked items + children); after it's
  accepted the item is Draft again, and re-approval flags every linked item
  **suspect** (⚠ in the tree, re-verify from the Links tab or the
  "Change requests & suspect links" page).
- **Reviews** — project → Reviews: a review covers chosen items (pinned to
  the reviewed version), has required reviewers who vote, collects change
  suggestions, can require all Major (or all) suggestions resolved and/or a
  complete applicability matrix before closing, and can approve all its
  items on close.
- **Change suggestions (RIDs)** — "Suggest change" works for anyone who
  can read the item, without edit rights or the edit lock, in parallel.
  Each has an ID (SUG-0001), target field, word diff, justification,
  type/severity and its own discussion. The owner (`owner` attribute) or
  `suggestion.resolve` accepts (applied as a normal versioned write
  credited to the author), accepts with modification, or rejects with a
  reason. Suggestions go Outdated when the field changes underneath them;
  accepting one on an Approved item raises a change request and applies it
  once the item is editable. Project-wide list + Excel RID export.
- **Notifications** — the bell in the top bar (polls every 30 s) plus email
  for status changes, comments, mentions, suggestions, review invites, lock
  overrides; "☆ Watch" any item.
- **Generic requirements library** — create a project of kind "Generic
  requirements library"; its documents are subsystems. "Library releases"
  freezes it as e.g. `GEN-SAT v1.0`. A project's "Applicability matrix"
  imports a release as one record per requirement (a reference, not a
  copy), each needing a decision: Applicable, Applicable with modification
  (creates a project copy that then goes through the normal requirement
  workflow; the diff vs. the library is shown), or Not applicable
  (justification + approval by `applicability.approve`). Dashboard by
  subsystem, completeness check, new-release diff with adopt / stay
  (justified), suspect flags on changed/removed requirements, Excel and
  ReqIF 1.2 export. Library text can use `{{param:KEY}}`, resolved with the
  consuming project's parameters; library rules over mission attributes
  (e.g. "no propulsion → suggest Not applicable") only ever suggest.
- **Roadmap** — top bar → Roadmap: submit improvement ideas (similar ideas
  are offered first), vote (one per user, voting follows the idea), kanban
  by Planned / In progress / Released with Now/Soon/Later horizons, full
  list with status facets and search, status history, official product-team
  replies, internal priority/effort/notes, duplicate merging (votes and
  followers move), release notes. Ideas are visible to all users; another
  organization's name is shown as "Organization hidden".

## Known simplifications (flagged, not forgotten)

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
- **Org admin exists but doesn't gate the schema yet.** Workflows, role
  permissions, the roadmap and library releases are gated by org-level
  permissions, but *writing* item types/link types/standards/glossary is
  still open to anyone logged in (item/link types even anonymously), as
  before — switching those to `org.admin` would change existing behavior,
  so it's left for a deliberate decision.
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
- **Workflow/lock edges.** Lock expiry is lazy: "notify me when free"
  fires on an explicit release or override, not when a lease silently
  expires. Lock and tree state is refreshed by polling (15–20 s), not
  pushed. Workflow conditions/actions are a fixed code registry
  (`app/services/workflow_engine.py`), so a new kind of rule is code, not
  configuration. Link edits don't create item versions. Real-time co-editing
  (Yjs) is out of scope, as the spec says.
- **Data migrations call app code.** The Alembic revision that introduced
  workflows/versions bootstraps data through `app.services.bootstrap`, so
  replaying old migrations on a fresh database depends on today's models —
  a fresh dev DB should use `app.seed` (which calls `create_all`) instead.
- **ReqIF is export-only** and covers the applicability matrix, not
  documents; ReqIF import isn't built.
- **Parameters have no unit conversion** (Nm vs. N·m vs. lb·ft, as the
  brief itself flags). Baselines now freeze parameter values, but not which
  standard version was cited, and exports don't yet render "as of baseline
  X".
- **Standards/Reference Document PDFs are stored on local disk**
  (`backend/reference_files/`), not S3 — fine for one machine, not for a
  real multi-instance deployment. There's no in-app PDF page viewer either;
  citations just open the file/link in a new tab with a `#page=N` fragment
  and rely on the browser's own PDF viewer.
- **Graph traversal direction is a project convention, not the brief's.**
  "up" = outgoing links, "down" = incoming links (documented in
  `app/services/graph.py`) — reasonable, but worth confirming against how
  your organization actually thinks about it.
