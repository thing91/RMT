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
sync of every item to YAML (§7), a document view and table view with saved
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

- **Language** — the interface is Polish by default with an English
  switch in the account menu (avatar, top right); the choice is remembered
  per browser. Every UI string goes through `t()` (`frontend/src/i18n/`):
  the English text is the key, `pl.ts` holds the Polish dictionary, and a
  string without a translation simply shows in English. Requirement content
  is never translated.
- **Top bar** — RMT and the breadcrumb on the left; a search box in the
  middle (**Ctrl+K / ⌘K** from anywhere) that finds requirements by key or
  text, documents, reviews, change suggestions and projects — Enter opens a
  requirement right in its document with the details panel open; the
  notification bell; **⚙** (organization admins only) for the
  administration page; the account menu (language, glossary, ideas &
  roadmap, sign out).
- **Administration** (`/admin`) — one page with tabs for everything
  organization-wide: item types, link types, workflows, permissions &
  settings, standards and the glossary. Non-admins can open it read-only.
- **Projects (landing page)** — every project and library as a card, with
  "N waiting for you" when something needs you there.
- **Project sidebar** — three fixed groups: **Documents** (always visible,
  with avatars of whoever is editing in each), **Work** (My work, Reviews,
  Change suggestions, Change requests & verification — each with a count of
  what is waiting for you) and **Project** (Applicability or Library
  releases, Traceability matrix, Parameters, Baselines, Workflows,
  Settings). Collapsible with the `‹`/`›` strip.
- **My work (project home)** — tiles for what is waiting for you (to
  approve, review votes, suggestions to resolve, to re-verify, change
  requests to decide) that filter the list below them; every document with
  a progress bar of its requirements by status; recent activity (with the
  audit-read permission). Documents and document groups are created here.
- **Document toolbar** — above the Document and the Table view: the
  document's name and who is in it, search within the document, a status
  filter, **Review / Edit** (Edit only for people with edit rights), the
  Document/Table switch, **Split** (a second document side by side) and a
  ⋯ menu with Excel/HTML/ReqIF export, ReqIF import, review & approval
  roles, retired requirements and resolved comments. The outline (table of
  contents) is a collapsible column on the left.
- **Reading a document (Review)** — numbered section headings and one
  compact block per requirement: key, title and status on the first line,
  the description, and one muted line with the type (only when the
  document mixes types), the filled-in attributes and the links. Comment,
  suggest-a-change and change-request icons appear on hover; a counter
  stays visible when there is something (e.g. 2 open comments). Clicking a
  requirement opens its details panel. This is the view for everyone
  without edit rights.
- **Editing a document (Edit)** — double-click a title or description to
  edit it in place: the item's edit lock is taken automatically (others see
  your avatar on it), the change is saved with If-Match when you click away
  and the lock is released. Selecting a row shows the structure toolbar —
  ↑/↓ reorder, ⇤/⇥ outdent/indent, copy/cut and paste (the clipboard is
  shared with the Table view and across documents); hover between rows to
  insert a new item there. Numbering recomputes automatically. The Table
  view follows the same Review/Edit modes.
- **Details panel** — header with the key, type, title, the current status
  and the next workflow step as one button (other transitions under
  "More ▾"), "Suggest a change", watch, and a ⋯ menu (graph, delete). Below
  it a single banner with the most important thing right now (someone else
  is editing, retired, needs re-verification, open change request,
  read-only). Tabs: **Details** (description and attributes — click to edit
  in Edit mode), **Activity** (one timeline of comments, versions with their
  diffs, workflow steps, signatures and audited events, filterable),
  **Links**, **Suggestions** and, for library items, **Rules**. There is no
  separate Edit/Save step.
- **Statuses** — one palette everywhere: the colors and order come from the
  workflow definition, so a status looks the same in the document, the
  panel, the dashboard and the filters.
- **Document groups** — an optional, flat way to organize a project's
  documents, managed on the project home: "+ New group", move a document
  into one from its card, double-click a group heading to rename it.
- **Point-and-click linking** — in Edit mode every requirement gets small
  "•→" (source) / "→•" (target) buttons on hover. Mark one item as source
  and another as target — in the same pane or across split panes — and a
  popup asks for the link type. Duplicate links are rejected.
- **Review & approval roles per document** — document toolbar ⋯ → "Review
  & approval roles": assigns **reviewers**/**approvers** per document
  (`document_workflow_roles`), the sign-off authority used by workflow
  transitions (`doc:approver` / `doc:reviewer`), distinct from the project
  RBAC `reviewer` role. The same dialog runs one transition on every
  eligible item of the document at once.
- **Comments** — on the Activity tab of a requirement: post a comment,
  reply (one level), edit or delete your own, resolve/reopen a thread,
  `@`-mention people (they get an email), and turn a thread into a formal
  change suggestion. Commenting makes you a watcher.
- **Standards Library** (§5.4, org-wide — ⚙ Administration → Standards) — add a standard as an uploaded PDF or an external link, add
  locators (e.g. "Clause 5.4.2", optionally a page number) once, then cite
  it from any item's description with `[[ref:CODE#locator]]`. Resolves to
  an interactive chip (in the detail panel's live preview and in HTML
  export) that opens the PDF/link at that page (`#page=N`); marking a
  standard "superseded by" a newer one flags every existing citation with
  ⚠ instead of breaking them. A consistency report calls out standards
  never cited and citations pointing at a superseded version.
- **Reference Documents** (§5.4, per-project — project sidebar →
  Settings → Reference documents) — same citation mechanism, but scoped to one
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
- **Graph** — in an item's details panel choose ⋯ → "Graph" to center
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
  items read-only outside Draft until a change request is accepted. Project
  sidebar → Baselines; the collapsible "Change history" below the list shows
  every local Git commit triggered by item writes (§7).
- **Deleting an item** — requirements are retired with the "Make obsolete"
  transition, never deleted, so history and traceability survive (documents
  hide retired items unless ⋯ → "Show retired requirements" is ticked). Only a brand-new,
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
Frontend tests: `cd frontend && npm test` (Vitest + Testing Library).

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
  (`item_versions`), shown on the details panel's Activity timeline with a
  word diff against the previous version. Workflow transitions,
  overrides, deletions, permission changes etc. go to the append-only
  `audit_events` log (project → "Change requests & verification" → Audit log).
- **Configurable workflows** — ⚙ Administration → Workflows (org default per item
  type) and a project's "Workflows" page (override). Templates: Basic,
  Change-managed (default for requirements), Regulated (e-signature,
  author can't approve own requirement, no open comments/Major
  suggestions, verification tied to passing linked tests) and Test case.
  The status attribute's values are generated from the workflow states, and
  status can only change through transitions.
- **Change management** — Approved → "Request change" creates a change
  request with impact analysis (linked items + children); after it's
  accepted the item is Draft again, and re-approval flags every linked item
  **suspect** (⚠ next to the requirement; re-verify from the Links tab or
  the "Change requests & verification" page).
- **Reviews** — project → Reviews: a review covers chosen items (pinned to
  the reviewed version), has required reviewers who vote, collects change
  suggestions, can require all Major (or all) suggestions resolved and/or a
  complete applicability matrix before closing, and can approve all its
  items on close.
- **Change suggestions (RIDs)** — "Suggest a change" works for anyone who
  can read the item, without edit rights or the edit lock, in parallel.
  Each has an ID (SUG-0001), target field, word diff, justification,
  type/severity and its own discussion. The owner (`owner` attribute) or
  `suggestion.resolve` accepts (applied as a normal versioned write
  credited to the author), accepts with modification, or rejects with a
  reason. Suggestions go Outdated when the field changes underneath them;
  accepting one on an Approved item raises a change request and applies it
  once the item is editable. Project-wide list + Excel RID export.
- **Who is editing right now** — a round avatar with the person's initials
  (stable color per person, ✎ for an item, ⇅ for the document structure)
  appears next to every requirement someone is editing — document and
  table views — and next to every document someone is working in
  (sidebar, project home, document toolbar). Hover for who and since when.
  Driven by a live Server-Sent Events stream (`GET /api/v1/events`), so it
  appears and disappears within a second; expired leases are swept every
  30 s. (The stream is per process — a multi-worker deployment would need
  a shared broker such as Postgres LISTEN/NOTIFY.)
- **Organization settings** (⚙ Administration → Permissions & settings) — lock
  timeouts, separation-of-duties switches, and the role → permission
  matrix (grant/revoke per role, defaults marked).
- **Schema is org-admin only** — item types, link types, glossary and
  standards can only be changed by an organization admin now.
- **Key prefixes** — project sidebar → Settings → General: an optional prefix for
  new item keys (`GENSAT-SYS-001`); libraries get one by default.
- **ReqIF for documents** — document toolbar ⋯ → "Export to ReqIF" /
  "Import ReqIF…", which appends a ReqIF specification (hierarchy → sections, leaves →
  requirements, attributes matched by name).
- **Notifications** — the bell in the top bar (pushed live) plus email
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
- **Workflow/lock edges.** Workflow conditions/actions are a fixed code
  registry (`app/services/workflow_engine.py`), so a new kind of rule is
  code, not configuration. Link edits don't create item versions. Live
  events are in-process (one uvicorn worker). Real-time co-editing (Yjs) is
  out of scope, as the spec says.
- **Migrations from scratch were verified** (empty schema → `alembic
  upgrade head` → `app.seed`, and a pre-workflow database with legacy
  status values). The workflow data migration is plain SQL; it only imports
  the workflow templates (pure data), so changing a template later doesn't
  rewrite history but does change what a *fresh* migration would insert.
- **ReqIF import is one-way and additive** — it appends; it doesn't update
  previously imported items by ReqIF identifier, and relations
  (SPEC-RELATIONS) aren't imported as links yet.
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
