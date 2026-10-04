"""Workflow engine on items: transitions, roles, conditions, change
management, suspect links, read-only states, signatures, configuration."""


def _approved_item(world, author="ed", approver="appr", title="Req"):
    item = world.create_item(author, title)
    assert world.transition(author, item, "submit").status_code == 200
    r = world.transition(approver, item, "approve")
    assert r.status_code == 200, r.text
    return r.json()


def test_available_transitions_and_roles(world):
    world.user("ed", "editor")
    world.user("rev", "reviewer")
    world.user("appr", "editor")
    world.assign("approver", "appr")
    item = world.create_item("ed")
    c = world.client

    wf = c.get(f"/api/v1/workflow/item/{item['id']}", headers=world.h("ed")).json()
    assert wf["state"] == "draft"
    keys = {t["key"]: t for t in wf["transitions"]}
    assert keys["submit"]["allowed"]

    assert world.transition("ed", item, "submit").status_code == 200
    # A plain editor who isn't an assigned approver can't approve.
    r = world.transition("ed", item, "approve")
    assert r.status_code == 403
    r = world.transition("appr", item, "approve")
    assert r.status_code == 200
    body = r.json()
    assert body["attributes"]["status"] == "approved"
    assert body["approved_by"] == "Appr"
    assert body["read_only_reason"]

    hist = c.get(f"/api/v1/workflow/item/{item['id']}", headers=world.h("ed")).json()["history"]
    assert [h["to_state"] for h in hist] == ["review", "approved"]


def test_wrong_state_and_comment_required(world):
    world.user("ed", "editor")
    item = world.create_item("ed")
    r = world.transition("ed", item, "approve")
    assert r.status_code == 422 and "isn't possible" in r.json()["detail"]["message"]
    world.transition("ed", item, "submit")
    r = world.transition("ed", item, "rework")
    assert r.status_code == 422 and r.json()["detail"]["reasons"] == ["comment_required"]
    assert world.transition("ed", item, "rework", comment="needs units").status_code == 200


def test_approved_is_read_only_until_change_request(world):
    world.user("ed", "editor")
    world.user("appr", "editor")
    world.assign("approver", "appr")
    item = _approved_item(world)

    r = world.patch("ed", item, title="sneaky edit")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "read_only"

    assert world.transition("ed", item, "request_change", comment="Needs 3h").status_code == 200
    r = world.transition("appr", item, "accept_change")
    assert r.status_code == 200
    item = r.json()
    assert item["attributes"]["status"] == "draft"
    assert world.patch("ed", item, title="Battery lasts 3h").status_code == 200

    crs = world.client.get(f"/api/v1/projects/{world.project.id}/change-requests", headers=world.h("ed")).json()
    assert crs[0]["key"] == "CR-001" and crs[0]["status"] == "accepted" and crs[0]["reason"] == "Needs 3h"


def test_reapproval_after_change_marks_links_suspect(world):
    world.user("ed", "editor")
    world.user("appr", "editor")
    world.assign("approver", "appr")
    c = world.client
    req = _approved_item(world, title="Battery 2h")
    test = world.create_item("ed", "Battery test", type_=world.va)
    r = c.post(
        "/api/v1/links",
        json={"source_item_id": test["id"], "target_item_id": req["id"], "link_type_id": str(world.verifies.id)},
        headers=world.h("ed"),
    )
    assert r.status_code in (200, 201), r.text

    world.transition("ed", req, "request_change", comment="3h")
    cr = c.get(f"/api/v1/projects/{world.project.id}/change-requests", headers=world.h("ed")).json()[0]
    assert cr["impact"][0]["key"] == test["key"]  # impact analysis lists the test

    world.transition("appr", req, "accept_change")
    req = c.get(f"/api/v1/items/{req['id']}", headers=world.h("ed")).json()
    world.patch("ed", req, title="Battery 3h")
    world.transition("ed", req, "submit")
    r = world.transition("appr", req, "approve")
    assert r.status_code == 200
    assert r.json()["suspect_links"] == 1

    suspects = c.get(f"/api/v1/projects/{world.project.id}/suspect-links", headers=world.h("ed")).json()
    assert len(suspects) == 1 and "CR-001" in suspects[0]["reason"]
    cr = c.get(f"/api/v1/projects/{world.project.id}/change-requests", headers=world.h("ed")).json()[0]
    assert cr["status"] == "implemented"

    r = c.post(f"/api/v1/links/{suspects[0]['id']}/clear-suspect", json={"comment": "rechecked"}, headers=world.h("ed"))
    assert r.status_code == 200
    assert c.get(f"/api/v1/projects/{world.project.id}/suspect-links", headers=world.h("ed")).json() == []


def test_first_approval_does_not_mark_suspect(world):
    world.user("ed", "editor")
    world.user("appr", "editor")
    world.assign("approver", "appr")
    req = world.create_item("ed")
    test = world.create_item("ed", "T", type_=world.va)
    world.client.post(
        "/api/v1/links",
        json={"source_item_id": test["id"], "target_item_id": req["id"], "link_type_id": str(world.verifies.id)},
        headers=world.h("ed"),
    )
    world.transition("ed", req, "submit")
    assert world.transition("appr", req, "approve").json()["suspect_links"] == 0


def test_regulated_variant(world):
    world.user("ed", "editor")
    world.user("boss", "admin", org_admin=True)
    c = world.client
    r = c.put(f"/api/v1/item-types/{world.req.id}/workflow", json={"template": "regulated"}, headers=world.h("boss"))
    assert r.status_code == 200, r.text

    item = world.create_item("boss", "Self-authored")
    # Required fields: description missing.
    r = world.transition("boss", item, "submit")
    assert r.status_code == 422 and "description_md" in r.json()["detail"]["reasons"][0]
    item = c.get(f"/api/v1/items/{item['id']}", headers=world.h("boss")).json()
    world.patch("boss", item, description_md="Shall do X")
    assert world.transition("boss", item, "submit").status_code == 200
    # Author can't approve own requirement.
    r = world.transition("boss", item, "approve", password="x")
    assert r.status_code == 422 and "authored" in r.json()["detail"]["reasons"][0]

    item2 = world.create_item("ed", "By editor", description_md="d")
    world.transition("ed", item2, "submit")
    r = world.transition("boss", item2, "approve")
    assert r.status_code == 422 and r.json()["detail"]["reasons"] == ["signature_required"]
    r = world.transition("boss", item2, "approve", password="secret")
    assert r.status_code == 200, r.text
    sigs = c.get(f"/api/v1/items/{item2['id']}/signatures", headers=world.h("ed")).json()
    assert sigs[0]["meaning"] == "approval" and len(sigs[0]["content_hash"]) == 64


def test_project_override_and_validation(world):
    world.user("padmin", "admin")
    world.user("ed", "editor")
    c = world.client
    # A project admin can't change the org workflow…
    assert c.put(f"/api/v1/item-types/{world.req.id}/workflow", json={"template": "basic"},
                 headers=world.h("padmin")).status_code == 403
    # …but can override it for the project.
    r = c.put(
        f"/api/v1/projects/{world.project.id}/item-types/{world.req.id}/workflow",
        json={"template": "basic"}, headers=world.h("padmin"),
    )
    assert r.status_code == 200 and r.json()["is_override"]
    effective = c.get(f"/api/v1/projects/{world.project.id}/workflows", headers=world.h("ed")).json()
    assert {w["item_type_name"]: w["variant"] for w in effective}["Requirement"] == "basic"

    # Removing a state still in use is refused.
    world.create_item("ed")
    bad = {
        "name": "Tiny",
        "states": [{"key": "open", "label": "Open", "initial": True}],
        "transitions": [],
    }
    r = c.put(f"/api/v1/projects/{world.project.id}/item-types/{world.req.id}/workflow", json=bad,
              headers=world.h("padmin"))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "states_in_use"
    # Broken references are refused.
    broken = {
        "states": [{"key": "draft", "label": "Draft", "initial": True}],
        "transitions": [{"key": "x", "label": "X", "from": ["draft"], "to": "nowhere"}],
    }
    r = c.put(f"/api/v1/projects/{world.project.id}/item-types/{world.req.id}/workflow", json=broken,
              headers=world.h("padmin"))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "invalid_workflow"


def test_bulk_document_transition(world):
    world.user("ed", "editor")
    world.user("appr", "editor")
    world.assign("approver", "appr")
    a = world.create_item("ed", "A")
    b = world.create_item("ed", "B")
    world.create_item("ed", "C")  # stays draft
    world.transition("ed", a, "submit")
    world.transition("ed", b, "submit")
    r = world.client.post(f"/api/v1/documents/{world.doc.id}/transitions/approve", json={}, headers=world.h("appr"))
    assert r.status_code == 200
    assert sorted(r.json()["applied"]) == sorted([a["key"], b["key"]])


def test_linked_tests_condition(world):
    from app.services.workflow_engine import ItemSubject, execute

    world.user("ed", "editor")
    world.user("appr", "editor")
    world.user("boss", "admin", org_admin=True)
    world.assign("approver", "appr")
    world.client.put(f"/api/v1/item-types/{world.req.id}/workflow", json={"template": "regulated"},
                     headers=world.h("boss"))
    req = world.create_item("ed", "R", description_md="d")
    world.transition("ed", req, "submit")
    world.transition("appr", req, "approve", password="p")
    world.transition("ed", req, "implement")
    r = world.transition("ed", req, "verify")
    assert r.status_code == 422 and "No linked" in r.json()["detail"]["reasons"][0]

    test = world.create_item("ed", "T", type_=world.va, attributes={"result": "fail"})
    world.client.post(
        "/api/v1/links",
        json={"source_item_id": test["id"], "target_item_id": req["id"], "link_type_id": str(world.verifies.id)},
        headers=world.h("ed"),
    )
    r = world.transition("ed", req, "verify")
    assert r.status_code == 422 and "not passed" in r.json()["detail"]["reasons"][0]
    test = world.client.get(f"/api/v1/items/{test['id']}", headers=world.h("ed")).json()
    world.patch("ed", test, attributes={**test["attributes"], "result": "pass"})
    assert world.transition("ed", req, "verify").status_code == 200


def test_new_item_type_gets_default_workflow(world):
    world.user("boss", "admin", org_admin=True)
    r = world.client.post(
        f"/api/v1/organizations/{world.org.id}/item-types",
        json={"key": "user_story", "name": "User story", "prefix": "US-", "behavior": "content"},
        headers=world.h("boss"),
    )
    assert r.status_code == 201, r.text
    wfs = world.client.get(f"/api/v1/organizations/{world.org.id}/workflows").json()
    assert "User story" in {w["item_type_name"] for w in wfs}


def test_notifications_on_transition(world):
    world.user("ed", "editor")
    world.user("appr", "editor")
    world.assign("approver", "appr")
    item = world.create_item("ed")
    world.transition("ed", item, "submit")
    inbox = world.client.get("/api/v1/me/notifications", headers=world.h("appr")).json()
    assert inbox["unread"] == 1 and "In Review" in inbox["items"][0]["title"]
    world.transition("appr", item, "approve")
    # Author watches their own item automatically.
    inbox = world.client.get("/api/v1/me/notifications", headers=world.h("ed")).json()
    assert any("Approved" in n["title"] for n in inbox["items"])


def test_permissions_endpoint(world):
    world.user("ed", "editor")
    p = world.client.get(f"/api/v1/me/permissions?project_id={world.project.id}", headers=world.h("ed")).json()
    assert p["role"] == "editor"
    assert "item.edit" in p["permissions"] and "lock.override" not in p["permissions"]
