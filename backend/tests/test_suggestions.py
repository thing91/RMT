"""Comments vs. change suggestions, suggestion workflow, reviews."""


def _suggest(world, user, item, **kw):
    body = {"target_field": "title", "proposed_value": "Better title", "rationale": "clearer", **kw}
    return world.client.post(f"/api/v1/items/{item['id']}/suggestions", json=body, headers=world.h(user))


def test_reviewer_without_edit_rights_can_suggest_and_owner_accepts(world):
    world.user("ed", "editor")
    world.user("rev", "reviewer")
    world.user("own", "viewer")  # owner of the requirement, no edit role at all
    item = world.create_item("ed", "Batery shall last 2h", attributes={"owner": "own"})
    # Anna holds the edit lock — suggesting still works.
    world.client.post(f"/api/v1/items/{item['id']}/lock", headers=world.h("ed"))
    world.client.delete(f"/api/v1/items/{item['id']}/lock", headers=world.h("ed"))

    r = _suggest(world, "rev", item, proposed_value="Battery shall last 2h", kind="editorial", severity="minor")
    assert r.status_code == 201, r.text
    s = r.json()
    assert s["key"] == "SUG-0001" and s["status"] == "open"
    assert {"op": "insert", "text": "Battery"} in s["diff"]

    # The author can't resolve their own suggestion.
    r = world.client.post(f"/api/v1/workflow/suggestion/{s['id']}/transitions/accept", json={},
                          headers=world.h("rev"))
    assert r.status_code == 403
    # The requirement owner can.
    r = world.client.post(f"/api/v1/workflow/suggestion/{s['id']}/transitions/accept", json={},
                          headers=world.h("own"))
    assert r.status_code == 200, r.text

    item = world.client.get(f"/api/v1/items/{item['id']}", headers=world.h("ed")).json()
    assert item["title"] == "Battery shall last 2h" and item["version"] == 2
    versions = world.client.get(f"/api/v1/items/{item['id']}/versions", headers=world.h("ed")).json()
    assert versions[0]["reason"] == "suggestion" and versions[0]["source_ref"] == "SUG-0001"
    assert versions[0]["author"] == "Rev" and versions[0]["changed_by"] == "Own"


def test_reject_requires_justification_and_is_visible_to_author(world):
    world.user("ed", "editor")
    world.user("rev", "reviewer")
    world.user("boss", "admin")
    item = world.create_item("ed")
    s = _suggest(world, "rev", item).json()
    url = f"/api/v1/workflow/suggestion/{s['id']}/transitions/reject"
    assert world.client.post(url, json={}, headers=world.h("boss")).status_code == 422
    assert world.client.post(url, json={"comment": "Out of scope"}, headers=world.h("boss")).status_code == 200
    s = world.client.get(f"/api/v1/suggestions/{s['id']}", headers=world.h("rev")).json()
    assert s["status"] == "rejected" and s["resolution_text"] == "Out of scope" and s["resolved_by"] == "Boss"
    inbox = world.client.get("/api/v1/me/notifications", headers=world.h("rev")).json()
    assert any("Rejected" in n["title"] for n in inbox["items"])


def test_accept_with_modification(world):
    world.user("ed", "editor")
    world.user("rev", "reviewer")
    world.user("boss", "admin")
    item = world.create_item("ed", "Old")
    s = _suggest(world, "rev", item, proposed_value="New").json()
    url = f"/api/v1/workflow/suggestion/{s['id']}/transitions/accept_modified"
    r = world.client.post(url, json={"comment": "tweaked"}, headers=world.h("boss"))
    assert r.status_code == 422  # final_value missing
    r = world.client.post(url, json={"comment": "tweaked", "payload": {"final_value": "Newer"}},
                          headers=world.h("boss"))
    assert r.status_code == 200, r.text
    item = world.client.get(f"/api/v1/items/{item['id']}", headers=world.h("ed")).json()
    assert item["title"] == "Newer"


def test_parallel_suggestions_and_outdating(world):
    world.user("ed", "editor")
    world.user("a", "reviewer")
    world.user("b", "reviewer")
    world.user("boss", "admin")
    item = world.create_item("ed", "Title v1")
    s1 = _suggest(world, "a", item, proposed_value="Title A").json()
    s2 = _suggest(world, "b", item, proposed_value="Title B").json()
    s3 = _suggest(world, "b", item, target_field="description_md", proposed_value="Desc").json()

    world.client.post(f"/api/v1/workflow/suggestion/{s1['id']}/transitions/accept", json={},
                      headers=world.h("boss"))
    s2 = world.client.get(f"/api/v1/suggestions/{s2['id']}", headers=world.h("b")).json()
    s3 = world.client.get(f"/api/v1/suggestions/{s3['id']}", headers=world.h("b")).json()
    assert s2["status"] == "outdated"  # same field changed underneath
    assert s2["current_value"] == "Title A" and s2["diff_vs_current"]
    assert s3["status"] == "open"  # other field untouched

    # Direct edits outdate too.
    item = world.client.get(f"/api/v1/items/{item['id']}", headers=world.h("ed")).json()
    world.patch("ed", item, description_md="Edited by hand")
    s3 = world.client.get(f"/api/v1/suggestions/{s3['id']}", headers=world.h("b")).json()
    assert s3["status"] == "outdated"

    # The author rebases by revising it.
    r = world.client.patch(f"/api/v1/suggestions/{s2['id']}", json={"proposed_value": "Title B2"},
                           headers=world.h("b"))
    assert r.status_code == 200 and r.json()["status"] == "open"
    assert r.json()["base_value"] == "Title A"


def test_accepting_on_approved_item_raises_change_request(world):
    world.user("ed", "editor")
    world.user("appr", "editor")
    world.user("rev", "reviewer")
    world.user("boss", "admin")
    world.assign("approver", "appr")
    item = world.create_item("ed", "Approved text")
    world.transition("ed", item, "submit")
    world.transition("appr", item, "approve")

    s = _suggest(world, "rev", item, proposed_value="Changed text", severity="major").json()
    r = world.client.post(f"/api/v1/workflow/suggestion/{s['id']}/transitions/accept", json={},
                          headers=world.h("boss"))
    assert r.status_code == 200, r.text
    item = world.client.get(f"/api/v1/items/{item['id']}", headers=world.h("ed")).json()
    assert item["attributes"]["status"] == "change_requested"
    assert item["title"] == "Approved text"  # not applied yet
    s = world.client.get(f"/api/v1/suggestions/{s['id']}", headers=world.h("rev")).json()
    assert s["apply_pending"] is True

    world.transition("appr", item, "accept_change")
    item = world.client.get(f"/api/v1/items/{item['id']}", headers=world.h("ed")).json()
    assert item["attributes"]["status"] == "draft"
    assert item["title"] == "Changed text"


def test_comment_vs_suggestion_threads_and_conversion(world):
    world.user("ed", "editor")
    world.user("rev", "reviewer")
    item = world.create_item("ed", "Some text")
    c = world.client
    com = c.post(f"/api/v1/items/{item['id']}/comments", json={"body": "Should be 'Some better text'?"},
                 headers=world.h("rev")).json()
    r = c.post(f"/api/v1/comments/{com['id']}/convert-to-suggestion",
               json={"target_field": "title", "proposed_value": "Some better text"}, headers=world.h("rev"))
    assert r.status_code == 201
    s = r.json()
    assert s["source_comment_id"] == com["id"] and s["rationale"].startswith("Should be")

    # Discussion on the suggestion stays out of the item's comment list.
    c.post(f"/api/v1/items/{item['id']}/comments", json={"body": "agree", "suggestion_id": s["id"]},
           headers=world.h("ed"))
    item_threads = c.get(f"/api/v1/items/{item['id']}/comments", headers=world.h("ed")).json()
    assert len(item_threads) == 1
    sug_threads = c.get(f"/api/v1/suggestions/{s['id']}/comments", headers=world.h("ed")).json()
    assert sug_threads[0]["body"] == "agree"
    # The item creator (watcher) was notified about the comment.
    inbox = c.get("/api/v1/me/notifications", headers=world.h("ed")).json()
    assert any(n["kind"] == "comment.new" for n in inbox["items"])


def test_validation(world):
    world.user("ed", "editor")
    world.user("rev", "reviewer")
    item = world.create_item("ed", "T")
    assert _suggest(world, "rev", item, rationale=" ").status_code == 422
    assert _suggest(world, "rev", item, target_field="attributes.status", proposed_value="approved").status_code == 422
    assert _suggest(world, "rev", item, proposed_value="T").status_code == 422  # identical
    assert _suggest(world, "rev", item, severity="huge").status_code == 422


def test_rid_export(world):
    from io import BytesIO

    from openpyxl import load_workbook

    world.user("ed", "editor")
    world.user("rev", "reviewer")
    item = world.create_item("ed", "T")
    _suggest(world, "rev", item, proposed_value="T2", severity="major")
    r = world.client.get(f"/api/v1/projects/{world.project.id}/suggestions/export.xlsx", headers=world.h("ed"))
    assert r.status_code == 200
    ws = load_workbook(BytesIO(r.content)).active
    assert ws["A1"].value == "ID" and ws["A2"].value == "SUG-0001" and ws["I2"].value == "Major"


def test_review_lifecycle(world):
    world.user("lead", "editor")
    world.user("r1", "reviewer")
    world.user("r2", "reviewer")
    world.user("appr", "editor")
    world.assign("approver", "appr")
    c = world.client
    a = world.create_item("lead", "A")
    b = world.create_item("lead", "B")
    world.transition("lead", a, "submit")
    world.transition("lead", b, "submit")

    r = c.post(
        f"/api/v1/projects/{world.project.id}/reviews",
        json={
            "title": "PDR", "item_ids": [a["id"], b["id"]],
            "participants": [{"user_id": str(world.users["r1"].id)}, {"user_id": str(world.users["r2"].id)}],
            "close_requires_resolved": "major",
        },
        headers=world.h("lead"),
    )
    assert r.status_code == 201, r.text
    rev = r.json()
    assert rev["key"] == "REV-001" and rev["votes_required"] == 2
    inbox = c.get("/api/v1/me/notifications", headers=world.h("r1")).json()
    assert inbox["items"][0]["kind"] == "review.invited"

    # A RID raised within the review.
    s = _suggest(world, "r1", a, proposed_value="A2", severity="major", review_id=rev["id"]).json()
    c.post(f"/api/v1/reviews/{rev['id']}/vote", json={"vote": "approve"}, headers=world.h("r1"))
    assert c.post(f"/api/v1/reviews/{rev['id']}/vote", json={"vote": "reject"},
                  headers=world.h("r2")).status_code == 422  # reject needs comment
    c.post(f"/api/v1/reviews/{rev['id']}/vote", json={"vote": "approve_with_comments", "comment": "ok"},
           headers=world.h("r2"))

    detail = c.get(f"/api/v1/reviews/{rev['id']}", headers=world.h("lead")).json()
    assert detail["close_blockers"] == ["1 open Major suggestion(s) must be resolved first."]
    r = c.post(f"/api/v1/reviews/{rev['id']}/close", json={}, headers=world.h("lead"))
    assert r.status_code == 422

    r = c.post(f"/api/v1/workflow/suggestion/{s['id']}/transitions/reject", json={"comment": "no"},
               headers=world.h("appr"))
    assert r.status_code == 403  # approving items ≠ resolving suggestions
    world.user("boss", "admin")
    r = c.post(f"/api/v1/workflow/suggestion/{s['id']}/transitions/reject", json={"comment": "no"},
               headers=world.h("boss"))
    assert r.status_code == 200
    # A plain reviewer can't close it.
    assert c.post(f"/api/v1/reviews/{rev['id']}/close", json={}, headers=world.h("r1")).status_code == 403
    # Close and approve all reviewed items in one go (an editor + approver).
    r = c.post(f"/api/v1/reviews/{rev['id']}/close",
               json={"outcome": "approved", "apply_transition": "approve"}, headers=world.h("appr"))
    assert r.status_code == 200, r.text
    assert sorted(r.json()["applied"]) == sorted([a["key"], b["key"]])
    assert r.json()["review"]["status"] == "closed"
    a = c.get(f"/api/v1/items/{a['id']}", headers=world.h("lead")).json()
    assert a["attributes"]["status"] == "approved"
