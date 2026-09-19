"""Container healthcheck for the raffle-ticket-api service.

Any HTTP response — including 401/403 from the authenticated endpoints —
proves daphne is up and serving.  Only connection errors / timeouts fail.
"""

import urllib.error
import urllib.request

try:
    urllib.request.urlopen("http://127.0.0.1:8000/api/settings/", timeout=4)
except urllib.error.HTTPError:
    # The server answered — that is all this check verifies.
    pass
except Exception:
    raise SystemExit(1)