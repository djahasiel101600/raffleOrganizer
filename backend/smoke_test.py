"""Simple end-to-end smoke test against a running backend."""
import json
import sys
import urllib.request

BASE = "http://127.0.0.1:8000"


def req(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def main():
    status, login = req("POST", "/api/auth/login/", {"username": "admin", "password": "admin123"})
    assert status == 200, login
    token = login["access"]
    print("login ok")

    status, dashboard = req("GET", "/api/dashboard/", token=token)
    assert status == 200, dashboard
    print("dashboard:", dashboard["total_tickets"], "tickets,", dashboard["total_reservations"], "reservations")

    status, created = req(
        "POST",
        "/api/reservations/",
        {
            "customer_name": "Maria Santos",
            "contact_number": "09171234567",
            "ticket_numbers": [10, 11, 12, 13],
            "notes": "Test reservation",
        },
        token=token,
    )
    assert status == 201, created
    rid = created["id"]
    print("created reservation", created["display_id"], created["ticket_numbers"])

    status, conflict = req(
        "POST",
        "/api/reservations/",
        {"customer_name": "Duplicate", "ticket_numbers": [10]},
        token=token,
    )
    assert status == 400 and conflict["code"] == "ticket_reserved", conflict
    print("conflict rejected:", conflict["detail"])

    status, monitor = req("GET", "/api/monitor/")
    assert status == 200, monitor
    print("monitor:", monitor["reserved_tickets"], "reserved,", monitor["total_reservations"], "active reservations")

    status, res = req("GET", f"/api/reservations/{rid}/", token=token)
    assert status == 200 and len(res["ticket_numbers"]) == 4, res
    print("detail ok:", res["display_id"], "->", res["ticket_numbers"])

    status, cancel = req("POST", f"/api/reservations/{rid}/cancel/", token=token)
    assert status == 200 and cancel["status"] == "cancelled", cancel
    print("cancelled ok")

    status, monitor2 = req("GET", "/api/monitor/")
    assert monitor2["reserved_tickets"] == monitor["reserved_tickets"] - 4, monitor2
    print("monitor after cancel:", monitor2["reserved_tickets"], "reserved")

    print("ALL SMOKE TESTS PASSED")


if __name__ == "__main__":
    sys.exit(main())