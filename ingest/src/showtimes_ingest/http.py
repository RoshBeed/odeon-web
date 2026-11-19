"""Plain JSON requests to a chain's public API, as its own website makes them.

One request at a time with a pause between, no retries (a failure is recorded
and the next scheduled check tries again), and a User-Agent that says who is
asking.
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request

from showtimes_ingest.log import log

USER_AGENT = "showtimes/1.0 (+https://github.com/RoshBeed/showtimes)"


class Client:
    def __init__(self, base, pause=1.0, timeout=60):
        self.base, self.pause, self.timeout = base.rstrip("/"), pause, timeout
        self.requests = 0
        self.last = 0.0

    def url(self, path, params=()):
        query = urllib.parse.urlencode(list(params), doseq=True)
        return f"{self.base}{path}" + (f"?{query}" if query else "")

    def get(self, path, params=(), headers=None):
        """The JSON a GET returns."""
        return self.send(urllib.request.Request(self.url(path, params)), headers)

    def post(self, path, form, headers=None):
        """The JSON a form POST returns."""
        body = urllib.parse.urlencode(form).encode()
        request = urllib.request.Request(self.url(path), data=body, method="POST")
        request.add_header("Content-Type", "application/x-www-form-urlencoded")
        return self.send(request, headers)

    def text(self, path, headers=None):
        """A page as text, for what a site writes into its HTML."""
        return self.send(urllib.request.Request(self.url(path)), headers, raw=True)

    def send(self, request, headers=None, raw=False):
        wait = self.last + self.pause - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        request.add_header("User-Agent", USER_AGENT)
        request.add_header("Accept", "application/json, text/html;q=0.8")
        for name, value in (headers or {}).items():
            request.add_header(name, value)
        self.requests += 1
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"HTTP {error.code} from {request.full_url}") from None
        except (urllib.error.URLError, TimeoutError) as error:
            reason = getattr(error, "reason", error)
            raise RuntimeError(f"{request.full_url}: {reason}") from None
        finally:
            self.last = time.monotonic()
        if raw:
            return body
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            log.error("not JSON from %s: %.200s", request.full_url, body)
            raise RuntimeError(f"Not JSON from {request.full_url}") from None
