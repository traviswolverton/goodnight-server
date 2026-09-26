"""Security response headers on every response. Pure ASGI middleware (not
BaseHTTPMiddleware) so it doesn't buffer or disturb streaming responses."""
from __future__ import annotations

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.settings import settings

# The React app needs no inline scripts, so script-src is 'self' only.
# style-src keeps 'unsafe-inline' because Radix/Sonner set inline style
# attributes at runtime.
_COMMON = ("img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; "
           "base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
CSP = f"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; {_COMMON}"

HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope["path"]

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("Content-Security-Policy", CSP)
                for name, value in HEADERS.items():
                    headers.setdefault(name, value)
                if settings.https_only:
                    headers.setdefault("Strict-Transport-Security", "max-age=31536000")
                if path.startswith("/api/"):
                    headers.setdefault("Cache-Control", "no-store")
            await send(message)

        await self.app(scope, receive, send_with_headers)
