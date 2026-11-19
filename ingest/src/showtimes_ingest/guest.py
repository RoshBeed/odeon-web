"""Anonymous Vista sessions obtained from the public ticketing pages.

Uses curl-impersonate's pinned Chrome profile, as the reference cinema clients
do. Tokens stay in memory, are passed over stdin and are never logged. Requests
do not follow redirects, disable certificate checks or retry a rejection.
"""

import base64
import json
import os
import re
import subprocess
import time
from dataclasses import dataclass
from urllib.parse import urlencode

from showtimes_ingest.http import USER_AGENT
from showtimes_ingest.log import log


@dataclass(frozen=True)
class Source:
    name: str
    api: str
    page: str
    token_data: str
    region: str | None = None


def extract_token(html, source):
    try:
        if source.token_data == "next":
            script = re.search(
                r'<script\b[^>]*\bid=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>',
                html,
                re.S,
            )
            token = json.loads(script[1])["props"]["pageProps"]["environment"][
                "gasToken"
            ]
        else:
            assignment = re.search(r"\bwindow\.initialData\s*=\s*", html)
            token = json.JSONDecoder().raw_decode(html[assignment.end() :])[0]["api"][
                "authToken"
            ]
        if not isinstance(token, str) or not re.fullmatch(
            r"[\w-]+\.[\w-]+\.[\w-]+", token, re.ASCII
        ):
            raise ValueError("invalid JWT")
        payload = token.split(".")[1]
        expiry = int(
            json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))[
                "exp"
            ]
        )
        if expiry <= time.time():
            raise ValueError("expired JWT")
        return token, expiry
    except (ValueError, KeyError, TypeError, AttributeError):
        raise RuntimeError(
            f"{source.name}: missing, invalid or expired guest session"
        ) from None


class Client:
    def __init__(self, source, pause=1, executable=None):
        self.source, self.pause = source, pause
        self.executable = executable or os.environ.get(
            "SHOWTIMES_CURL_BIN", "/opt/curl-impersonate/curl-impersonate"
        )
        self.requests, self.last = 0, 0.0
        self.token, self.expiry = None, 0

    def request(self, url, headers=None):
        wait = self.last + self.pause - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        args = [
            self.executable,
            "--disable",
            "--impersonate",
            "chrome150",
            "--compressed",
            "--silent",
            "--show-error",
            "--connect-timeout",
            "10",
            "--max-time",
            "45",
            "--config",
            "-",
            "--write-out",
            "\n%{http_code}",
        ]
        proxy = os.environ.get("SHOWTIMES_PROXY")
        if proxy:
            proxy = re.sub(r"^socks5://", "socks5h://", proxy)
            args += ["--proxy", proxy]
        args.append(url)
        # Config input avoids exposing the credential in command arguments.
        config = "".join(
            f'header = "{name}: {value}"\n' for name, value in (headers or {}).items()
        )
        self.requests += 1
        try:
            result = subprocess.run(
                args, input=config, capture_output=True, text=True, timeout=50
            )
        except FileNotFoundError:
            raise RuntimeError(
                "curl-impersonate is missing; run the ingest container"
            ) from None
        except subprocess.TimeoutExpired:
            raise RuntimeError(
                f"{self.source.name}: guest/API request timed out"
            ) from None
        finally:
            self.last = time.monotonic()
        if result.returncode:
            raise RuntimeError(
                f"{self.source.name}: HTTP transport exited {result.returncode}"
            )
        body, separator, status = result.stdout.rpartition("\n")
        if not separator or not status.isdigit():
            raise RuntimeError(f"{self.source.name}: invalid HTTP response")
        return body, int(status)

    def capture(self):
        body, status = self.request(self.source.page)
        if status not in (200, 404):
            raise RuntimeError(f"{self.source.name}: guest page returned HTTP {status}")
        token, expiry = extract_token(body, self.source)
        self.token, self.expiry = token, expiry
        log.info("%s: public guest session ready", self.source.name)

    def get(self, route, params=()):
        if self.token is None or self.expiry <= time.time() + 60:
            self.capture()
        headers = {
            "Authorization": "Bearer " + self.token,
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        if self.source.region:
            headers["Connect-Region-Code"] = self.source.region
        query = urlencode(list(params))
        url = (
            self.source.api.rstrip("/")
            + "/"
            + route.lstrip("/")
            + ("?" + query if query else "")
        )
        body, status = self.request(url, headers)
        if status == 401:
            self.token, self.expiry = None, 0
        if status == 204:
            return {}
        if status != 200:
            raise RuntimeError(f"{self.source.name}: {route} returned HTTP {status}")
        try:
            return json.loads(body)
        except ValueError:
            raise RuntimeError(
                f"{self.source.name}: {route} did not return JSON"
            ) from None
