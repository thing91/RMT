"""Roadmap: ideas, votes, workflow, duplicates, official replies, privacy."""

import pytest


@pytest.fixture
def rm(world):
    from app.models.organization import Organization
    from app.models.user import User

    world.user("alice")
    world.user("bob")
    world.user("pt", org_admin=True)  # product team: org admin holds roadmap.manage
    other = Organization(name="Other Org")
    world.db.add(other)
    world.db.flush()
    eve = User(org_id=other.id, username="eve", display_name="Eve", email="eve@example.com")
    world.db.add(eve)
    world.db.commit()
    world.users["eve"] = eve
    return world


def _idea(w, user, title="Bulk edit attributes in table view", category="Usability"):
    r = w.client.post("/api/v1/roadmap/ideas", json={"title": title, "description": "Please", "category": category},
                      headers=w.h(user))
    assert r.status_code == 201, r.text
    return r.json()


def _t(w, user, idea, key, **body):
    return w.client.post(f"/api/v1/workflow/idea/{idea['id']}/transitions/{key}", json=body, headers=w.h(user))


def test_submit_vote_and_status_flow(rm):
    w = rm
    idea = _idea(w, "alice")
    assert idea["key"] == "IDEA-1" and idea["status"] == "submitted" and idea["watching"]

    r = w.client.post(f"/api/v1/roadmap/ideas/{idea['id']}/vote", headers=w.h("bob"))
    assert r.json()["votes"] == 1 and r.json()["voted"] and r.json()["watching"]
    # One vote per user; can be withdrawn.
    w.client.post(f"/api/v1/roadmap/ideas/{idea['id']}/vote", headers=w.h("bob"))
    assert w.client.get(f"/api/v1/roadmap/ideas/{idea['id']}", headers=w.h("bob")).json()["votes"] == 1
    assert w.client.delete(f"/api/v1/roadmap/ideas/{idea['id']}/vote", headers=w.h("bob")).json()["votes"] == 0
    w.client.post(f"/api/v1/roadmap/ideas/{idea['id']}/vote", headers=w.h("bob"))

    # Regular users can't move it through the workflow.
    assert _t(w, "alice", idea, "start_review").status_code == 403
    assert _t(w, "pt", idea, "start_review").status_code == 200
    assert _t(w, "pt", idea, "plan").status_code == 200
    detail = w.client.get(f"/api/v1/roadmap/ideas/{idea['id']}", headers=w.h("alice")).json()
    assert detail["status_label"] == "Planned" and detail["horizon"] == "next"
    assert [t["to"] for t in detail["timeline"]] == ["Submitted", "Under review", "Planned"]

    # Submitter and voter were notified about the status change.
    for u in ("alice", "bob"):
        inbox = w.client.get("/api/v1/me/notifications", headers=w.h(u)).json()
        assert any("Planned" in n["title"] for n in inbox["items"]), u

    board = w.client.get("/api/v1/roadmap/board", headers=w.h("eve")).json()
    assert board["planned"][0]["key"] == "IDEA-1"


def test_decline_needs_reason_and_release_needs_note(rm):
    w = rm
    a = _idea(w, "alice")
    assert _t(w, "pt", a, "decline").status_code == 422
    assert _t(w, "pt", a, "decline", comment="Out of scope for this product").status_code == 200

    b = _idea(w, "alice", "Export to DOCX")
    _t(w, "pt", b, "plan")
    _t(w, "pt", b, "start")
    r = _t(w, "pt", b, "release")
    assert r.status_code == 422
    note = w.client.post("/api/v1/roadmap/release-notes", json={"version": "1.4", "title": "DOCX export"},
                         headers=w.h("pt")).json()
    assert _t(w, "pt", b, "release", payload={"release_note_id": note["id"]}).status_code == 200
    detail = w.client.get(f"/api/v1/roadmap/ideas/{b['id']}", headers=w.h("bob")).json()
    assert detail["release"]["version"] == "1.4"
    assert w.client.post(f"/api/v1/roadmap/ideas/{b['id']}/vote", headers=w.h("bob")).status_code == 409


def test_needs_info_returns_to_review_on_answer(rm):
    w = rm
    idea = _idea(w, "alice")
    assert _t(w, "pt", idea, "ask_info", comment="Which table view?").status_code == 200
    w.client.post(f"/api/v1/roadmap/ideas/{idea['id']}/comments", json={"body": "The project table"},
                  headers=w.h("alice"))
    assert w.client.get(f"/api/v1/roadmap/ideas/{idea['id']}", headers=w.h("alice")).json()["status"] == "under_review"


def test_duplicate_moves_votes_and_watchers(rm):
    w = rm
    original = _idea(w, "alice", "Dark mode for the whole app")
    dup = _idea(w, "bob", "Dark theme please")
    w.client.post(f"/api/v1/roadmap/ideas/{dup['id']}/vote", headers=w.h("eve"))
    w.client.post(f"/api/v1/roadmap/ideas/{original['id']}/vote", headers=w.h("bob"))
    assert _t(w, "pt", dup, "mark_duplicate").status_code == 422
    r = _t(w, "pt", dup, "mark_duplicate", payload={"duplicate_of_id": original["id"]})
    assert r.status_code == 200, r.text
    o = w.client.get(f"/api/v1/roadmap/ideas/{original['id']}", headers=w.h("eve")).json()
    assert o["votes"] == 2 and o["watching"]  # Eve's vote and watch moved over
    d = w.client.get(f"/api/v1/roadmap/ideas/{dup['id']}", headers=w.h("eve")).json()
    assert d["duplicate_of"]["key"] == original["key"]


def test_official_reply_and_internal_fields(rm):
    w = rm
    idea = _idea(w, "alice")
    w.client.post(f"/api/v1/roadmap/ideas/{idea['id']}/vote", headers=w.h("bob"))
    assert w.client.post(f"/api/v1/roadmap/ideas/{idea['id']}/comments", json={"body": "x", "official": True},
                         headers=w.h("bob")).status_code == 403
    w.client.post(f"/api/v1/roadmap/ideas/{idea['id']}/comments", json={"body": "On our list!", "official": True},
                  headers=w.h("pt"))
    inbox = w.client.get("/api/v1/me/notifications", headers=w.h("bob")).json()
    assert inbox["items"][0]["kind"] == "idea.official_reply"

    assert w.client.patch(f"/api/v1/roadmap/ideas/{idea['id']}", json={"priority": "high"},
                          headers=w.h("alice")).status_code == 403
    w.client.patch(f"/api/v1/roadmap/ideas/{idea['id']}",
                   json={"priority": "high", "effort": "M", "internal_note": "Ties into v2 table", "horizon": "now"},
                   headers=w.h("pt"))
    seen_by_user = w.client.get(f"/api/v1/roadmap/ideas/{idea['id']}", headers=w.h("alice")).json()
    assert seen_by_user["priority"] is None and seen_by_user["internal_note"] is None
    assert seen_by_user["horizon"] == "now"
    seen_by_pt = w.client.get(f"/api/v1/roadmap/ideas/{idea['id']}", headers=w.h("pt")).json()
    assert seen_by_pt["internal_note"] == "Ties into v2 table"


def test_other_org_is_anonymized(rm):
    w = rm
    idea = _idea(w, "alice")
    same = w.client.get(f"/api/v1/roadmap/ideas/{idea['id']}", headers=w.h("bob")).json()
    other = w.client.get(f"/api/v1/roadmap/ideas/{idea['id']}", headers=w.h("eve")).json()
    assert same["organization"] == w.org.name and same["author"] == "Alice"
    assert other["organization"] == "Organization hidden" and other["author"] == "A user"


def test_list_filters_facets_and_similar(rm):
    w = rm
    a = _idea(w, "alice", "Bulk edit attributes in table view")
    _idea(w, "bob", "Keyboard shortcuts for tree view", "Requirements editing")
    w.client.post(f"/api/v1/roadmap/ideas/{a['id']}/vote", headers=w.h("bob"))
    r = w.client.get("/api/v1/roadmap/ideas", params={"q": "keyboard"}, headers=w.h("alice")).json()
    assert [i["title"] for i in r["items"]] == ["Keyboard shortcuts for tree view"]
    r = w.client.get("/api/v1/roadmap/ideas", params={"mine": True}, headers=w.h("alice")).json()
    assert len(r["items"]) == 1
    r = w.client.get("/api/v1/roadmap/ideas", params={"sort": "votes"}, headers=w.h("alice")).json()
    assert r["items"][0]["votes"] == 1
    assert {f["status"]: f["count"] for f in r["facets"]}["submitted"] == 2
    sim = w.client.get("/api/v1/roadmap/ideas/similar", params={"title": "edit attributes in bulk"},
                       headers=w.h("eve")).json()
    assert sim and sim[0]["key"] == a["key"]


def test_anonymous_has_no_access(rm):
    assert rm.client.get("/api/v1/roadmap/ideas").status_code == 401
