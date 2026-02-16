"""HTTP Basic Auth middleware for Starlette/FastAPI."""

import base64
import secrets

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class BasicAuthMiddleware(BaseHTTPMiddleware):
    """Middleware that enforces HTTP Basic Auth.

    Bypasses /health so ALB health checks pass without credentials.
    """

    def __init__(self, app, username: str, password: str) -> None:
        super().__init__(app)
        self.username = username
        self.password = password

    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/health":
            return await call_next(request)

        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Basic "):
            try:
                decoded = base64.b64decode(auth_header[6:]).decode("utf-8")
                provided_user, provided_pass = decoded.split(":", 1)
                if secrets.compare_digest(provided_user, self.username) and \
                   secrets.compare_digest(provided_pass, self.password):
                    return await call_next(request)
            except Exception:
                pass

        return Response(
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="Peekaboo"'},
            content="Unauthorized",
        )
