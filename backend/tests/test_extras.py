"""Live events, org settings, schema gating, key prefixes, ReqIF round
trip, expired-lock sweep."""

import asyncio
from datetime import datetime, timedelta, timezone

from app.services.events import Subscriber, bus


class _Collector:
    """Subscribes to the in-process bus without an event loop thread."""

    def __init__(self, user, project_ids=()):
        self.loop = asyncio.new_event_loop()
        self.queue = asyncio.Queue()
        self.sub = Subscriber(user_id=user.id, org_id=user.org_id, queue=self.queue, loop=self.loop,
                              project_ids=set(project_ids))
        bus.subscribe(self.sub)

    def drain(self):
        self.loop.run_until_complete(asyncio.sleep(0))
        out = []
        while not self.queue.empty():
            out.append(self.queue.get_nowait())
        return out

    def close(self):
        bus.unsubscribe(self.sub)
        self.loop.close()


def test_lock_events_reach_project_watchers_only(world):
    world.user("anna", "editor")
    bob = world.user("bob", "editor")
    item = world.create_item("anna")
    watcher = _Collector(bob, [world.project.id])
    outsider = _Collector(bob, [])
    try:
        world.client.post(f"/api/v1/items/{item['id']}/lock", headers=world.h("anna"))
        events = [e for e in watcher.drain() if e["type"] == "lock"]
        assert events and events[-1]["lock"]["user_name"] == "Anna"
        assert events[-1]["document_id"] == str(world.doc.id)
        assert outsider.drain() == []
        # Heartbeats don't spam; release announces "free".
        world.client.post(f"/api/v1/items/{item['id']}/lock/heartbeat", headers=world.h("anna"))
        assert [e for e in watcher.drain() if e["type"] == "lock"] == []
        world.client.delete(f"/api/v1/items/{item['id']}/lock", headers=world.h("anna"))
        assert watcher.drain()[-1]["lock"] is None
    finally:
        watcher.close()
        outsider.close()


def test_notification_events_are_per_user(world):
    world.user("ed", "editor")
    appr = world.user("appr", "editor")
    world.assign("approver", "appr")
    c = _Collector(appr)
    try:
        item = world.create_item("ed")
        world.transition("ed", item, "submit")
        assert any(e["type"] == "notification" and e["user_id"] == str(appr.id) for e in c.drain())
    finally:
        c.close()


def test_sweep_announces_and_notifies(world, db):
    from app.models.lock import EditLock
    from app.services.locks import sweep_expired

    world.user("anna", "editor")
    world.user("bob", "editor")
    item = world.create_item("anna")
    world.client.post(f"/api/v1/items/{item['id']}/lock", headers=world.h("anna"))
    world.client.post(f"/api/v1/items/{item['id']}/lock/notify-when-free", headers=world.h("bob"))
    lock = db.query(EditLock).filter_by(scope="item").one()
    lock.expires_at = datetime.now(timezone.utc) - timedelta(seconds=5)
    db.commit()
    assert sweep_expired(db) >= 1
    inbox = world.client.get("/api/v1/me/notifications", headers=world.h("bob")).json()
    assert inbox["items"][0]["kind"] == "lock.released"


def test_org_settings_drive_lock_timeout(world):
    world.user("boss", "admin", org_admin=True)
    world.user("ed", "editor")
    c = world.client
    assert c.put(f"/api/v1/organizations/{world.org.id}/settings", json={"edit_lock_timeout_minutes": 2},
                 headers=world.h("ed")).status_code == 403
    assert c.put(f"/api/v1/organizations/{world.org.id}/settings", json={"edit_lock_timeout_minutes": 0},
                 headers=world.h("boss")).status_code == 422
    r = c.put(f"/api/v1/organizations/{world.org.id}/settings", json={"edit_lock_timeout_minutes": 2},
              headers=world.h("boss"))
    assert r.json()["values"]["edit_lock_timeout_minutes"] == 2
    item = world.create_item("ed")
    status = c.post(f"/api/v1/items/{item['id']}/lock", headers=world.h("ed")).json()
    assert status["timeout_minutes"] == 2
    expires = datetime.fromisoformat(status["lock"]["expires_at"])
    assert expires - datetime.now(timezone.utc) < timedelta(minutes=2, seconds=5)


def test_schema_writes_need_org_admin(world):
    world.user("ed", "admin")  # project admin is not enough
    world.user("boss", "admin", org_admin=True)
    c = world.client
    body = {"key": "story", "name": "Story", "prefix": "US-", "behavior": "content"}
    assert c.post(f"/api/v1/organizations/{world.org.id}/item-types", json=body).status_code == 401
    assert c.post(f"/api/v1/organizations/{world.org.id}/item-types", json=body, headers=world.h("ed")).status_code == 403
    assert c.post(f"/api/v1/organizations/{world.org.id}/item-types", json=body, headers=world.h("boss")).status_code == 201
    assert c.patch(f"/api/v1/link-types/{world.verifies.id}", json={"name": "x"}, headers=world.h("ed")).status_code == 403
    assert c.post(f"/api/v1/organizations/{world.org.id}/glossary",
                  json={"abbreviation": "EPS", "term": "Electrical Power System", "definition": "..."},
                  headers=world.h("ed")).status_code == 403


def test_library_key_prefix(world):
    world.user("boss", "admin", org_admin=True)
    c = world.client
    lib = c.post(f"/api/v1/organizations/{world.org.id}/projects",
                 json={"name": "GEN-SAT core", "kind": "library"}, headers=world.h("boss")).json()
    assert lib["key_prefix"] == "GENSAT"
    doc = c.post(f"/api/v1/projects/{lib['id']}/documents", json={"name": "EPS"}, headers=world.h("boss")).json()
    item = c.post(f"/api/v1/documents/{doc['id']}/items", json={"title": "T", "item_type_id": str(world.req.id)},
                  headers=world.h("boss")).json()
    assert item["key"] == "GENSAT-SYS-001"
    item2 = c.post(f"/api/v1/documents/{doc['id']}/items", json={"title": "T2", "item_type_id": str(world.req.id)},
                   headers=world.h("boss")).json()
    assert item2["key"] == "GENSAT-SYS-002"
    r = c.patch(f"/api/v1/projects/{lib['id']}", json={"key_prefix": "bad prefix"}, headers=world.h("boss"))
    assert r.status_code == 422


def test_reqif_document_round_trip(world):
    from app.models.item_type import ItemTypeAttribute

    world.db.add(ItemTypeAttribute(
        item_type_id=world.req.id, key="priority", label="Priority", data_type="enum", order=2,
        enum_options=[{"value": "high", "label": "High", "deprecated": False},
                      {"value": "low", "label": "Low", "deprecated": False}],
    ))
    world.db.commit()
    world.user("ed", "editor")
    c = world.client
    sec = world.create_item("ed", "Power", type_=world.section)
    world.create_item("ed", "Battery capacity", parent_id=sec["id"], description_md="Shall store 40 Wh.",
                      attributes={"priority": "high"})
    world.create_item("ed", "Loose requirement")
    reqif = c.get(f"/api/v1/documents/{world.doc.id}/export.reqif", headers=world.h("ed"))
    assert reqif.status_code == 200 and b"REQ-IF" in reqif.content

    from app.models.document import Document

    target = Document(project_id=world.project.id, name="Imported", order=1)
    world.db.add(target)
    world.db.commit()
    r = c.post(
        f"/api/v1/documents/{target.id}/import.reqif",
        files={"file": ("doc.reqif", reqif.content, "application/xml")},
        data={"item_type_id": str(world.req.id)},
        headers=world.h("ed"),
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"sections": 1, "items": 2, "skipped_attributes": 0}
    tree = c.get(f"/api/v1/documents/{target.id}/items", headers=world.h("ed")).json()
    power = next(n for n in tree if n["title"] == "Power")
    battery = power["children"][0]
    assert battery["description_md"] == "Shall store 40 Wh."
    assert battery["attributes"]["priority"] == "high"
    assert battery["attributes"]["status"] == "draft"
    versions = c.get(f"/api/v1/items/{battery['id']}/versions", headers=world.h("ed")).json()
    assert versions[0]["reason"] == "import"

    bad = c.post(f"/api/v1/documents/{target.id}/import.reqif",
                 files={"file": ("x.reqif", b"<nope/>", "application/xml")},
                 data={"item_type_id": str(world.req.id)}, headers=world.h("ed"))
    assert bad.status_code == 422
