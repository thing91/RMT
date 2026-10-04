"""Versioning, ETag/If-Match, edit locks, structure locks, soft delete."""


def test_create_records_version_and_etag(world):
    world.user("ed", "editor")
    item = world.create_item("ed", "Battery capacity")
    assert item["version"] == 1
    assert item["etag"] == f'"{item["id"]}:1"'
    assert item["attributes"]["status"] == "draft"  # workflow initial state

    versions = world.client.get(f"/api/v1/items/{item['id']}/versions", headers=world.h("ed")).json()
    assert [v["version"] for v in versions] == [1]
    assert versions[0]["reason"] == "create"


def test_content_edit_requires_if_match(world):
    world.user("ed", "editor")
    item = world.create_item("ed")
    r = world.patch("ed", item, etag=False, title="New")
    assert r.status_code == 428

    r = world.patch("ed", item, title="New")
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 2
    assert r.headers["ETag"] == f'"{item["id"]}:2"'


def test_stale_if_match_returns_412_with_diff(world):
    world.user("anna", "editor")
    world.user("bob", "editor")
    item = world.create_item("anna", "Original title")
    assert world.patch("anna", item, title="Anna's title").status_code == 200

    r = world.patch("bob", item, title="Bob's title")  # still based on v1
    assert r.status_code == 412
    detail = r.json()["detail"]
    assert detail["code"] == "version_conflict"
    assert detail["your_version"] == 1 and detail["current_version"] == 2
    assert detail["changes_since_yours"][0]["field"] == "title"
    assert detail["changes_since_yours"][0]["new"] == "Anna's title"


def test_noop_patch_does_not_create_version(world):
    world.user("ed", "editor")
    item = world.create_item("ed", "Same")
    r = world.patch("ed", item, title="Same")
    assert r.status_code == 200
    assert r.json()["version"] == 1


def test_viewer_cannot_edit(world):
    world.user("ed", "editor")
    world.user("vic", "viewer")
    item = world.create_item("ed")
    assert world.patch("vic", item, title="x").status_code == 403


def test_status_cannot_be_patched_directly(world):
    world.user("ed", "editor")
    item = world.create_item("ed")
    r = world.patch("ed", item, attributes={**item["attributes"], "status": "approved"})
    assert r.status_code == 422
    assert "workflow" in r.text


def test_item_lock_blocks_other_writers(world):
    world.user("anna", "editor")
    world.user("bob", "editor")
    item = world.create_item("anna")
    c = world.client

    r = c.post(f"/api/v1/items/{item['id']}/lock", headers=world.h("anna"))
    assert r.status_code == 200 and r.json()["mine"]

    # Bob sees who holds it, can't take it, can't write.
    status = c.get(f"/api/v1/items/{item['id']}/lock", headers=world.h("bob")).json()
    assert status["lock"]["user_name"] == "Anna" and not status["mine"]
    assert c.post(f"/api/v1/items/{item['id']}/lock", headers=world.h("bob")).status_code == 423
    r = world.patch("bob", item, title="Bob")
    assert r.status_code == 423
    assert r.json()["detail"]["lock"]["user_name"] == "Anna"

    # The tree shows the lock too.
    tree = c.get(f"/api/v1/documents/{world.doc.id}/items", headers=world.h("bob")).json()
    assert tree[0]["lock"]["user_name"] == "Anna"

    # Anna saves fine; after release Bob can lock.
    assert world.patch("anna", item, title="Anna").status_code == 200
    assert c.delete(f"/api/v1/items/{item['id']}/lock", headers=world.h("anna")).status_code == 200
    assert c.post(f"/api/v1/items/{item['id']}/lock", headers=world.h("bob")).status_code == 200


def test_expired_lock_is_free(world, db):
    from datetime import datetime, timedelta, timezone

    from app.models.lock import EditLock

    world.user("anna", "editor")
    world.user("bob", "editor")
    item = world.create_item("anna")
    world.client.post(f"/api/v1/items/{item['id']}/lock", headers=world.h("anna"))
    lock = db.query(EditLock).filter_by(scope="item").one()
    lock.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    db.commit()

    r = world.client.post(f"/api/v1/items/{item['id']}/lock", headers=world.h("bob"))
    assert r.status_code == 200 and r.json()["mine"]
    # Anna's heartbeat now reports the loss.
    r = world.client.post(f"/api/v1/items/{item['id']}/lock/heartbeat", headers=world.h("anna"))
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "lock_lost"


def test_lock_override_is_admin_only_and_audited(world):
    world.user("anna", "editor")
    world.user("bob", "editor")
    world.user("boss", "admin")
    item = world.create_item("anna")
    c = world.client
    c.post(f"/api/v1/items/{item['id']}/lock", headers=world.h("anna"))

    assert c.post(f"/api/v1/items/{item['id']}/lock/override", headers=world.h("bob")).status_code == 403
    r = c.post(f"/api/v1/items/{item['id']}/lock/override?take_over=true", headers=world.h("boss"))
    assert r.status_code == 200 and r.json()["mine"]

    audit = c.get(f"/api/v1/items/{item['id']}/audit", headers=world.h("boss")).json()
    assert audit[0]["action"] == "lock.take_over"
    assert "Anna" in audit[0]["summary"]
    inbox = c.get("/api/v1/me/notifications", headers=world.h("anna")).json()
    assert inbox["unread"] == 1 and inbox["items"][0]["kind"] == "lock.overridden"


def test_notify_when_lock_released(world):
    world.user("anna", "editor")
    world.user("bob", "editor")
    item = world.create_item("anna")
    c = world.client
    c.post(f"/api/v1/items/{item['id']}/lock", headers=world.h("anna"))
    c.post(f"/api/v1/items/{item['id']}/lock/notify-when-free", headers=world.h("bob"))
    c.delete(f"/api/v1/items/{item['id']}/lock", headers=world.h("anna"))
    inbox = c.get("/api/v1/me/notifications", headers=world.h("bob")).json()
    assert inbox["items"][0]["kind"] == "lock.released"


def test_beacon_release(world):
    from app.services.auth import create_access_token

    world.user("anna", "editor")
    item = world.create_item("anna")
    c = world.client
    c.post(f"/api/v1/items/{item['id']}/lock", headers=world.h("anna"))
    token = create_access_token(world.users["anna"].id, "anna")
    assert c.post(f"/api/v1/items/{item['id']}/lock/release", json={"token": token}).status_code == 204
    assert c.get(f"/api/v1/items/{item['id']}/lock", headers=world.h("anna")).json()["lock"] is None


def test_structure_and_content_locks_are_independent(world):
    world.user("anna", "editor")
    world.user("bob", "editor")
    s1 = world.create_item("anna", "Section 1", type_=world.section)
    s2 = world.create_item("anna", "Section 2", type_=world.section)
    item = world.create_item("anna", "Req", parent_id=s1["id"])
    c = world.client

    # Anna holds the content lock; Bob may still move the item (structure)…
    c.post(f"/api/v1/items/{item['id']}/lock", headers=world.h("anna"))
    r = c.patch(f"/api/v1/items/{item['id']}", json={"parent_id": s2["id"]}, headers=world.h("bob"))
    assert r.status_code == 200, r.text
    # …which did not bump the content version, so Anna's save still applies.
    assert r.json()["version"] == 1
    assert world.patch("anna", item, title="Edited").status_code == 200

    # Bob's move took an implicit structure lease: Anna can't reorder now.
    r = c.patch(f"/api/v1/items/{s1['id']}", json={"order": 5}, headers=world.h("anna"))
    assert r.status_code == 423
    # But Anna can still edit content.
    item2 = c.get(f"/api/v1/items/{item['id']}", headers=world.h("anna")).json()
    assert world.patch("anna", item2, title="Edited again").status_code == 200


def test_delete_rules(world):
    world.user("ed", "editor")
    c = world.client
    fresh = world.create_item("ed", "Typo")
    assert c.delete(f"/api/v1/items/{fresh['id']}", headers=world.h("ed")).status_code == 204

    edited = world.create_item("ed", "Real")
    world.patch("ed", edited, title="Real requirement")
    r = c.delete(f"/api/v1/items/{edited['id']}", headers=world.h("ed"))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "use_obsolete"

    section = world.create_item("ed", "Sec", type_=world.section)
    world.create_item("ed", "Child", parent_id=section["id"])
    r = c.delete(f"/api/v1/items/{section['id']}", headers=world.h("ed"))
    assert r.status_code == 409 and r.json()["detail"]["code"] == "section_not_empty"


def test_obsolete_hidden_by_default(world):
    world.user("ed", "editor")
    item = world.create_item("ed", "Retire me")
    r = world.transition("ed", item, "retire", comment="Superseded by SYS-010")
    assert r.status_code == 200, r.text
    assert r.json()["obsolete"] is True
    c = world.client
    assert c.get(f"/api/v1/documents/{world.doc.id}/items", headers=world.h("ed")).json() == []
    tree = c.get(f"/api/v1/documents/{world.doc.id}/items?include_obsolete=true", headers=world.h("ed")).json()
    assert tree[0]["obsolete"] is True


def test_version_diff(world):
    world.user("ed", "editor")
    item = world.create_item("ed", "The battery shall last 2 hours")
    world.patch("ed", item, title="The battery shall last 3 hours")
    d = world.client.get(f"/api/v1/items/{item['id']}/diff?from_version=1", headers=world.h("ed")).json()
    assert d["to_version"] == 2
    ops = d["changes"][0]["ops"]
    assert {"op": "delete", "text": "2"} in ops and {"op": "insert", "text": "3"} in ops
    v1 = world.client.get(f"/api/v1/items/{item['id']}/versions/1", headers=world.h("ed")).json()
    assert v1["snapshot"]["title"] == "The battery shall last 2 hours"
