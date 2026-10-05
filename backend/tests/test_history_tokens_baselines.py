"""Automatic record history, personal API tokens, document baselines."""


def test_every_record_change_is_recorded_with_actor_and_fields(world):
    world.user("ed", "editor")
    c = world.client
    item = world.create_item("ed", "Battery shall last 2h")
    r = world.patch("ed", item, title="Battery shall last 3h")
    assert r.status_code == 200, r.text

    hist = c.get(f"/api/v1/changes/items/{item['id']}", headers=world.h("ed")).json()
    assert [h["action"] for h in hist] == ["update", "create"]
    assert hist[0]["changes"]["title"] == ["Battery shall last 2h", "Battery shall last 3h"]
    assert hist[0]["actor_name"] == "Ed"
    assert "version" not in hist[0]["changes"] and "updated_at" not in hist[0]["changes"]
    assert hist[1]["changes"]["title"] == [None, "Battery shall last 2h"]
    assert hist[0]["project_id"] == str(world.project.id)


def test_history_covers_other_tables_and_deletes(world):
    world.user("ed", "editor")
    world.user("boss", "admin", org_admin=True)
    c = world.client
    # A document (any table, not only items).
    r = c.patch(f"/api/v1/documents/{world.doc.id}", json={"name": "SRS v2"}, headers=world.h("boss"))
    assert r.status_code == 200, r.text
    hist = c.get(f"/api/v1/changes/documents/{world.doc.id}", headers=world.h("ed")).json()
    assert hist[0]["changes"]["name"] == ["SRS", "SRS v2"] and hist[0]["actor_name"] == "Boss"

    # A link, then its deletion.
    a = world.create_item("ed", "A")
    b = world.create_item("ed", "B")
    link = c.post("/api/v1/links", json={"source_item_id": a["id"], "target_item_id": b["id"],
                                         "link_type_id": str(world.verifies.id)}, headers=world.h("ed")).json()
    assert c.delete(f"/api/v1/links/{link['id']}", headers=world.h("ed")).status_code == 204
    hist = c.get(f"/api/v1/changes/links/{link['id']}", headers=world.h("ed")).json()
    assert [h["action"] for h in hist] == ["delete", "create"]
    assert hist[0]["changes"]["source_item_id"] == [a["id"], None]

    # The project change log lists them all.
    log = c.get(f"/api/v1/projects/{world.project.id}/changes", headers=world.h("ed")).json()
    assert {"documents", "items", "links"} <= {e["entity_type"] for e in log}


def test_history_of_private_project_is_hidden_from_outsiders(world):
    world.user("ed", "editor")
    world.user("outsider")
    item = world.create_item("ed", "Secret")
    c = world.client
    assert c.get(f"/api/v1/changes/items/{item['id']}", headers=world.h("outsider")).status_code == 404
    assert c.get(f"/api/v1/projects/{world.project.id}/changes", headers=world.h("outsider")).status_code == 404


def test_api_token_acts_as_its_owner_until_revoked(world):
    world.user("ed", "editor")
    c = world.client
    r = c.post("/api/v1/me/api-tokens", json={"name": "CI export", "expires_in_days": 30}, headers=world.h("ed"))
    assert r.status_code == 201, r.text
    token = r.json()["token"]
    assert token.startswith("rmt_") and r.json()["prefix"] == token[:10]
    # The plain token is never listed again.
    listed = c.get("/api/v1/me/api-tokens", headers=world.h("ed")).json()
    assert "token" not in listed[0] and listed[0]["name"] == "CI export"

    bearer = {"Authorization": f"Bearer {token}"}
    assert c.get("/api/v1/auth/me", headers=bearer).json()["username"] == "ed"
    r = c.post(f"/api/v1/documents/{world.doc.id}/items",
               json={"title": "Via API", "item_type_id": str(world.req.id)}, headers=bearer)
    assert r.status_code == 201
    hist = c.get(f"/api/v1/changes/items/{r.json()['id']}", headers=bearer).json()
    assert hist[0]["actor_name"] == "Ed"

    assert c.delete(f"/api/v1/me/api-tokens/{listed[0]['id']}", headers=world.h("ed")).status_code == 204
    assert c.get("/api/v1/auth/me", headers=bearer).status_code == 401


def test_api_token_validation_and_ownership(world):
    world.user("ed", "editor")
    world.user("other", "editor")
    c = world.client
    assert c.post("/api/v1/me/api-tokens", json={"name": " "}, headers=world.h("ed")).status_code == 422
    assert c.post("/api/v1/me/api-tokens", json={"name": "x", "expires_in_days": 0},
                  headers=world.h("ed")).status_code == 422
    tok = c.post("/api/v1/me/api-tokens", json={"name": "x"}, headers=world.h("ed")).json()
    assert c.delete(f"/api/v1/me/api-tokens/{tok['id']}", headers=world.h("other")).status_code == 404
    assert c.get("/api/v1/auth/me", headers={"Authorization": "Bearer rmt_not-a-real-token"}).status_code == 401


def test_document_baseline_is_a_frozen_read_only_copy(world):
    world.user("ed", "editor")
    world.user("view", "viewer")
    c = world.client
    sec = world.create_item("ed", "General", type_=world.section)
    req = world.create_item("ed", "Mass below 85 kg", parent_id=sec["id"])

    r = c.post(f"/api/v1/documents/{world.doc.id}/baselines", json={"name": "SRR"}, headers=world.h("ed"))
    assert r.status_code == 201, r.text
    b = r.json()
    assert b["document_id"] == str(world.doc.id) and b["document_name"] == "SRS" and b["item_count"] == 2

    # The live document moves on; the baseline doesn't.
    assert world.patch("ed", req, title="Mass below 90 kg").status_code == 200
    detail = c.get(f"/api/v1/baselines/{b['id']}", headers=world.h("view")).json()
    frozen = {i["id"]: i for i in detail["snapshot"]["items"]}
    assert frozen[req["id"]]["title"] == "Mass below 85 kg"
    assert detail["snapshot"]["item_types"][str(world.section.id)]["behavior"] == "structural"

    listed = c.get(f"/api/v1/documents/{world.doc.id}/baselines", headers=world.h("view")).json()
    assert [x["name"] for x in listed] == ["SRR"]
    # Viewers can read but not create baselines.
    assert c.post(f"/api/v1/documents/{world.doc.id}/baselines", json={"name": "X"},
                  headers=world.h("view")).status_code == 403
    # It also shows among the project's baselines.
    proj = c.get(f"/api/v1/projects/{world.project.id}/baselines", headers=world.h("view")).json()
    assert proj[0]["document_name"] == "SRS"


def test_api_docs_are_served_under_api(client):
    assert client.get("/api/docs").status_code == 200
    spec = client.get("/api/openapi.json").json()
    assert "bearer" in spec["components"]["securitySchemes"]
    assert "/api/v1/changes/{entity_type}/{entity_id}" in spec["paths"]
