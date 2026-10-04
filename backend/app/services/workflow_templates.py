"""Reference workflows (wymagania-wspolbieznosc-i-workflow.md, "Workflow
wymagań") plus the built-in system workflows for suggestions,
applicability records and roadmap ideas.

Item workflows are copied from these templates into `workflow_definitions`
rows (and can then be edited/overridden per project); the system
workflows for non-item objects are used straight from code.

Transition `roles` tokens (any one matching is enough; empty = anyone with
the `workflow.transition` permission):
  role:<viewer|reviewer|editor|admin>  effective project role at least that
  perm:<permission>                    holds that named permission
  doc:reviewer / doc:approver          assigned on the item's document
  author                               the subject's author/submitter
  owner                                the requirement's `owner` attribute
  any                                  any signed-in user who can read it
"""

import copy


def _state(key, label, category, *, read_only=False, is_obsolete=False, initial=False, color=None):
    return {
        "key": key,
        "label": label,
        "category": category,  # draft | active | done | side
        "read_only": read_only,
        "is_obsolete": is_obsolete,
        "initial": initial,
        "color": color,
    }


def _t(key, label, frm, to, *, roles=None, conditions=None, actions=None, requires_comment=False):
    return {
        "key": key,
        "label": label,
        "from": frm if isinstance(frm, list) else [frm],
        "to": to,
        "roles": roles or [],
        "conditions": conditions or [],
        "actions": actions or [],
        "requires_comment": requires_comment,
    }


_APPROVERS = ["doc:approver", "role:admin"]
_NOTIFY_ALL = {"type": "notify", "targets": ["watchers", "doc_reviewers", "doc_approvers", "author"]}

BASIC = {
    "name": "Basic",
    "variant": "basic",
    "states": [
        _state("draft", "Draft", "draft", initial=True, color="#64748b"),
        _state("review", "In Review", "active", color="#d97706"),
        _state("approved", "Approved", "active", read_only=True, color="#16a34a"),
        _state("implemented", "Implemented", "active", read_only=True, color="#2563eb"),
        _state("verified", "Verified", "done", read_only=True, color="#0d9488"),
        _state("rejected", "Rejected", "side", read_only=True, color="#dc2626"),
        _state("obsolete", "Obsolete", "side", read_only=True, is_obsolete=True, color="#94a3b8"),
    ],
    "transitions": [
        _t("submit", "Submit for review", "draft", "review",
           actions=[{"type": "notify", "targets": ["doc_reviewers", "doc_approvers", "watchers"]}]),
        _t("rework", "Back to draft", "review", "draft", requires_comment=True,
           actions=[_NOTIFY_ALL]),
        _t("approve", "Approve", "review", "approved", roles=_APPROVERS,
           actions=[{"type": "stamp_approval"}, _NOTIFY_ALL]),
        _t("reject", "Reject", "review", "rejected", roles=_APPROVERS, requires_comment=True,
           actions=[_NOTIFY_ALL]),
        _t("implement", "Mark implemented", "approved", "implemented"),
        _t("verify", "Mark verified", "implemented", "verified"),
        _t("reopen", "Reopen", "rejected", "draft"),
        _t("retire", "Make obsolete", ["draft", "review", "approved", "implemented", "verified", "rejected"],
           "obsolete", roles=["role:editor"], requires_comment=True, actions=[_NOTIFY_ALL]),
        _t("restore", "Restore from obsolete", "obsolete", "draft", roles=["role:admin"], requires_comment=True),
    ],
}

CHANGE_MANAGED = copy.deepcopy(BASIC)
CHANGE_MANAGED["name"] = "Change-managed"
CHANGE_MANAGED["variant"] = "change_managed"
CHANGE_MANAGED["states"].insert(
    5, _state("change_requested", "Change Requested", "active", read_only=True, color="#9333ea")
)
CHANGE_MANAGED["transitions"] = [
    t for t in CHANGE_MANAGED["transitions"] if t["key"] not in ()
] + [
    _t("request_change", "Request change", ["approved", "implemented", "verified"], "change_requested",
       roles=["role:reviewer"], requires_comment=True,
       actions=[{"type": "create_change_request"}, _NOTIFY_ALL]),
    _t("accept_change", "Accept change request", "change_requested", "draft", roles=_APPROVERS,
       actions=[{"type": "change_request_status", "status": "accepted"}, _NOTIFY_ALL]),
    _t("reject_change", "Reject change request", "change_requested", "approved", roles=_APPROVERS,
       requires_comment=True,
       actions=[{"type": "change_request_status", "status": "rejected"}, _NOTIFY_ALL]),
]
# Re-approval after an accepted change request flags everything linked to
# the item as suspect and closes the change request.
for _tr in CHANGE_MANAGED["transitions"]:
    if _tr["key"] == "approve":
        _tr["actions"] = [
            {"type": "stamp_approval"},
            {"type": "mark_suspect", "only_after_change_request": True},
            {"type": "change_request_status", "status": "implemented"},
            _NOTIFY_ALL,
        ]
    if _tr["key"] == "retire":
        _tr["from"] = _tr["from"] + ["change_requested"]

REGULATED = copy.deepcopy(CHANGE_MANAGED)
REGULATED["name"] = "Regulated"
REGULATED["variant"] = "regulated"
for _tr in REGULATED["transitions"]:
    if _tr["key"] == "approve":
        _tr["conditions"] = [{"type": "author_cannot_execute"}, {"type": "no_open_comments"}]
        _tr["actions"] = [{"type": "require_signature", "meaning": "approval"}] + _tr["actions"]
    if _tr["key"] == "submit":
        _tr["conditions"] = [{"type": "required_fields", "fields": ["title", "description_md"]}]
    if _tr["key"] == "verify":
        _tr["conditions"] = [{"type": "linked_tests_passed", "link_type": "verifies",
                              "result_attribute": "result", "pass_value": "pass"}]
    if _tr["key"] == "accept_change":
        _tr["actions"] = [{"type": "require_signature", "meaning": "change approval"}] + _tr["actions"]

TEST_CASE = {
    "name": "Test case",
    "variant": "custom",
    "states": [
        _state("draft", "Draft", "draft", initial=True, color="#64748b"),
        _state("review", "In Review", "active", color="#d97706"),
        _state("approved", "Approved", "done", read_only=True, color="#16a34a"),
        _state("obsolete", "Obsolete", "side", read_only=True, is_obsolete=True, color="#94a3b8"),
    ],
    "transitions": [
        _t("submit", "Submit for review", "draft", "review",
           actions=[{"type": "notify", "targets": ["doc_reviewers", "doc_approvers", "watchers"]}]),
        _t("rework", "Back to draft", "review", "draft", requires_comment=True, actions=[_NOTIFY_ALL]),
        _t("approve", "Approve", "review", "approved", roles=_APPROVERS,
           actions=[{"type": "stamp_approval"}, _NOTIFY_ALL]),
        _t("revise", "Revise", "approved", "draft", roles=["role:editor"], requires_comment=True),
        _t("retire", "Make obsolete", ["draft", "review", "approved"], "obsolete",
           roles=["role:editor"], requires_comment=True),
        _t("restore", "Restore from obsolete", "obsolete", "draft", roles=["role:admin"], requires_comment=True),
    ],
}

ITEM_TEMPLATES = {
    "basic": BASIC,
    "change_managed": CHANGE_MANAGED,
    "regulated": REGULATED,
    "test_case": TEST_CASE,
}
DEFAULT_ITEM_TEMPLATE = "change_managed"


# ---- system workflows for non-item objects (not user-editable) ----------

SUGGESTION = {
    "name": "Change suggestion",
    "variant": "system",
    "states": [
        _state("open", "Open", "active", initial=True, color="#2563eb"),
        _state("accepted", "Accepted", "done", read_only=True, color="#16a34a"),
        _state("accepted_modified", "Accepted with modification", "done", read_only=True, color="#0d9488"),
        _state("rejected", "Rejected", "done", read_only=True, color="#dc2626"),
        _state("withdrawn", "Withdrawn", "side", read_only=True, color="#94a3b8"),
        _state("outdated", "Outdated", "side", color="#d97706"),
    ],
    "transitions": [
        _t("accept", "Accept", ["open", "outdated"], "accepted",
           roles=["owner", "perm:suggestion.resolve"],
           conditions=[{"type": "author_cannot_execute", "setting": "suggestion_self_resolve"}],
           actions=[{"type": "apply_suggestion"}, {"type": "notify", "targets": ["author", "watchers"]}]),
        _t("accept_modified", "Accept with modification", ["open", "outdated"], "accepted_modified",
           roles=["owner", "perm:suggestion.resolve"], requires_comment=True,
           conditions=[{"type": "author_cannot_execute", "setting": "suggestion_self_resolve"}],
           actions=[{"type": "apply_suggestion", "modified": True},
                    {"type": "notify", "targets": ["author", "watchers"]}]),
        _t("reject", "Reject", ["open", "outdated"], "rejected",
           roles=["owner", "perm:suggestion.resolve"], requires_comment=True,
           conditions=[{"type": "author_cannot_execute", "setting": "suggestion_self_resolve"}],
           actions=[{"type": "notify", "targets": ["author", "watchers"]}]),
        _t("withdraw", "Withdraw", ["open", "outdated"], "withdrawn", roles=["author"]),
        # System-only: fired when the target item changes underneath an open suggestion.
        _t("mark_outdated", "Mark outdated", "open", "outdated", roles=["system"],
           actions=[{"type": "notify", "targets": ["author"]}]),
        _t("refresh", "Update to current version", "outdated", "open", roles=["author"]),
    ],
}

APPLICABILITY = {
    "name": "Applicability decision",
    "variant": "system",
    "states": [
        _state("to_be_assessed", "To be assessed", "draft", initial=True, color="#64748b"),
        _state("applicable", "Applicable", "done", color="#16a34a"),
        _state("applicable_modified", "Applicable with modification", "active", color="#0d9488"),
        _state("not_applicable_pending", "Not applicable — awaiting approval", "active", color="#d97706"),
        _state("not_applicable", "Not applicable", "done", color="#94a3b8"),
    ],
    "transitions": [
        _t("mark_applicable", "Applicable", ["to_be_assessed", "applicable_modified", "not_applicable",
                                             "not_applicable_pending"], "applicable",
           roles=["perm:applicability.decide"]),
        _t("mark_modified", "Applicable with modification",
           ["to_be_assessed", "applicable", "not_applicable", "not_applicable_pending"], "applicable_modified",
           roles=["perm:applicability.decide"], requires_comment=True,
           actions=[{"type": "create_modified_copy"}]),
        _t("propose_not_applicable", "Not applicable",
           ["to_be_assessed", "applicable", "applicable_modified"], "not_applicable_pending",
           roles=["perm:applicability.decide"], requires_comment=True,
           actions=[{"type": "notify", "targets": ["permission:applicability.approve"]}]),
        _t("approve_not_applicable", "Approve exclusion", "not_applicable_pending", "not_applicable",
           roles=["perm:applicability.approve"],
           conditions=[{"type": "author_cannot_execute", "setting": "applicability_self_approve"}],
           actions=[{"type": "notify", "targets": ["author"]}]),
        _t("reject_not_applicable", "Reject exclusion", "not_applicable_pending", "to_be_assessed",
           roles=["perm:applicability.approve"], requires_comment=True,
           actions=[{"type": "notify", "targets": ["author"]}]),
        _t("reassess", "Reassess", ["applicable", "applicable_modified", "not_applicable"], "to_be_assessed",
           roles=["perm:applicability.decide"], requires_comment=True),
    ],
}

IDEA = {
    "name": "Roadmap idea",
    "variant": "system",
    "states": [
        _state("submitted", "Zgłoszony", "draft", initial=True, color="#64748b"),
        _state("under_review", "W ocenie", "active", color="#d97706"),
        _state("needs_info", "Potrzebne info", "side", color="#9333ea"),
        _state("planned", "Zaplanowany", "active", color="#2563eb"),
        _state("in_progress", "W realizacji", "active", color="#0891b2"),
        _state("released", "Wdrożony", "done", read_only=True, color="#16a34a"),
        _state("declined", "Odrzucony", "side", read_only=True, color="#dc2626"),
        _state("duplicate", "Duplikat", "side", read_only=True, color="#94a3b8"),
    ],
    "transitions": [
        _t("start_review", "Rozpocznij ocenę", ["submitted"], "under_review", roles=["perm:roadmap.manage"]),
        _t("ask_info", "Poproś o informacje", ["submitted", "under_review"], "needs_info",
           roles=["perm:roadmap.manage"], requires_comment=True),
        # Fired automatically when the submitter answers (comment on a needs_info idea).
        _t("info_provided", "Informacje uzupełnione", "needs_info", "under_review", roles=["author", "system"]),
        _t("plan", "Zaplanuj", ["submitted", "under_review", "in_progress"], "planned",
           roles=["perm:roadmap.manage"]),
        _t("start", "Rozpocznij realizację", ["planned"], "in_progress", roles=["perm:roadmap.manage"]),
        _t("release", "Oznacz jako wdrożony", ["in_progress", "planned"], "released",
           roles=["perm:roadmap.manage"], conditions=[{"type": "required_fields", "fields": ["release_ref"]}]),
        _t("decline", "Odrzuć", ["submitted", "under_review", "needs_info", "planned"], "declined",
           roles=["perm:roadmap.manage"], requires_comment=True),
        _t("mark_duplicate", "Oznacz jako duplikat", ["submitted", "under_review", "needs_info"], "duplicate",
           roles=["perm:roadmap.manage"], conditions=[{"type": "required_fields", "fields": ["duplicate_of_id"]}],
           actions=[{"type": "merge_duplicate"}]),
        _t("reopen", "Przywróć do oceny", ["declined", "duplicate"], "under_review", roles=["perm:roadmap.manage"]),
    ],
}

for _wf in (SUGGESTION, APPLICABILITY, IDEA):
    for _tr in _wf["transitions"]:
        if not any(a["type"] == "notify" for a in _tr["actions"]):
            _tr["actions"].append({"type": "notify", "targets": ["watchers", "author"]})

SYSTEM_WORKFLOWS = {
    "suggestion": SUGGESTION,
    "applicability": APPLICABILITY,
    "idea": IDEA,
}
