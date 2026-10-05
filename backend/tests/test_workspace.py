"""Workspace endpoints behind the simplified UI: search, "my work",
the per-user summary and the project overview."""


def _suggest(world, user, item):
    body = {"target_field": "title", "proposed_value": "Better title", "rationale": "clearer"}
    r = world.client.post(f"/api/v1/items/{item['id']}/suggestions", json=body, headers=world.h(user))
    assert r.status_code == 201, r.text
    return r.json()


def test_search_finds_items_documents_and_respects_access(world):
    from app.models.project import Project

    world.user("ed", "editor")
    world.user("outsider")  # org member without access to the private project
    item = world.create_item("ed", "Battery autonomy")
    c = world.client

    hits = c.get("/api/v1/search", params={"q": "autonomy", "project_id": str(world.project.id)},
                 headers=world.h("ed")).json()
    assert [(h["kind"], h["id"]) for h in hits] == [("item", item["id"])]
    by_key = c.get("/api/v1/search", params={"q": item["key"]}, headers=world.h("ed")).json()
    assert any(h["id"] == item["id"] for h in by_key)
    docs = c.get("/api/v1/search", params={"q": "SRS"}, headers=world.h("ed")).json()
    assert any(h["kind"] == "document" for h in docs)

    # A private project is invisible to someone without access.
    assert c.get("/api/v1/search", params={"q": "autonomy"}, headers=world.h("outsider")).json() == []
    # ...until it becomes public.
    world.db.get(Project, world.project.id).visibility = "public"
    world.db.commit()
    assert c.get("/api/v1/search", params={"q": "autonomy"}, headers=world.h("outsider")).json()


def test_my_work_lists_approvals_only_for_assigned_approvers(world):
    world.user("ed", "editor")
    world.user("appr", "editor")
    world.assign("approver", "appr")
    item = world.create_item("ed", "Needs approval")
    assert world.transition("ed", item, "submit").status_code == 200
    c = world.client

    mine = c.get(f"/api/v1/projects/{world.project.id}/my-work", headers=world.h("appr")).json()
    assert mine["counts"]["approve"] == 1
    assert mine["entries"][0]["item_id"] == item["id"] and mine["entries"][0]["document_id"] == str(world.doc.id)
    # The author is not an approver: nothing to approve.
    theirs = c.get(f"/api/v1/projects/{world.project.id}/my-work", headers=world.h("ed")).json()
    assert theirs["counts"]["approve"] == 0

    summary = c.get("/api/v1/me/work-summary", headers=world.h("appr")).json()
    assert summary == {str(world.project.id): 1}

    # Once approved it is no longer waiting.
    assert world.transition("appr", item, "approve").status_code == 200
    after = c.get(f"/api/v1/projects/{world.project.id}/my-work", headers=world.h("appr")).json()
    assert after["counts"]["approve"] == 0


def test_my_work_lists_suggestions_for_the_owner_not_the_author(world):
    world.user("ed", "editor")
    world.user("rev", "reviewer")
    world.user("own", "viewer")
    item = world.create_item("ed", "Owned requirement", attributes={"owner": "own"})
    s = _suggest(world, "rev", item)
    c = world.client

    owner = c.get(f"/api/v1/projects/{world.project.id}/my-work", headers=world.h("own")).json()
    assert [(e["kind"], e["id"]) for e in owner["entries"]] == [("suggestion", s["id"])]
    author = c.get(f"/api/v1/projects/{world.project.id}/my-work", headers=world.h("rev")).json()
    assert author["counts"]["suggestion"] == 0


def test_overview_counts_statuses_and_hides_activity_without_audit_rights(world):
    world.user("ed", "editor")
    world.user("view", "viewer")
    world.user("rev", "reviewer")
    a = world.create_item("ed", "A")
    world.create_item("ed", "B")
    assert world.transition("ed", a, "submit").status_code == 200
    c = world.client

    ov = c.get(f"/api/v1/projects/{world.project.id}/overview", headers=world.h("rev")).json()
    doc = next(d for d in ov["documents"] if d["id"] == str(world.doc.id))
    assert doc["statuses"] == {"draft": 1, "review": 1} and doc["total"] == 2
    assert any(e["action"] == "workflow.transition" for e in ov["activity"])

    viewer = c.get(f"/api/v1/projects/{world.project.id}/overview", headers=world.h("view")).json()
    assert viewer["activity"] == []
    assert viewer["documents"][0]["total"] == 2
