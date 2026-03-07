"""Proxy pool management for BrightData proxy rotation."""

import logging
import random
from typing import Optional

logger = logging.getLogger(__name__)


class ProxyPool:
    """Manages a pool of BrightData proxies for rotation."""

    def __init__(self, proxies: list[dict], enable_dynamic_sessions: bool = True) -> None:
        """Initialize proxy pool.

        Args:
            proxies: List of proxy dicts with keys: server, username, password
            enable_dynamic_sessions: If True, generate new session IDs for each rotation (fresh IPs)
        """
        self.proxies = proxies if proxies else []
        self.current_idx = 0
        self.failed_proxies: set[int] = set()
        self.request_count = 0
        self.enable_dynamic_sessions = enable_dynamic_sessions

        # Store base usernames (without session IDs) for dynamic generation
        self.base_usernames = []
        if self.enable_dynamic_sessions and self.proxies:
            for proxy in self.proxies:
                username = proxy.get('username', '')
                # Remove existing session ID if present
                if '-session-' in username:
                    base_username = username.rsplit('-session-', 1)[0]
                else:
                    base_username = username
                self.base_usernames.append(base_username)

    def get_next_proxy(self) -> Optional[dict]:
        """Get next proxy in rotation.

        If dynamic_sessions is enabled, generates a NEW session ID for each call,
        ensuring each rotation gets a fresh residential IP from BrightData.
        """
        if not self.proxies:
            return None

        if len(self.failed_proxies) >= len(self.proxies):
            logger.warning("All proxies have failed")
            return None

        # Try to find a working proxy
        attempts = 0
        while attempts < len(self.proxies):
            proxy = self.proxies[self.current_idx]
            proxy_idx = self.current_idx
            self.current_idx = (self.current_idx + 1) % len(self.proxies)
            attempts += 1

            if proxy_idx not in self.failed_proxies:
                self.request_count += 1

                # Generate new session ID for fresh IP (if enabled)
                if self.enable_dynamic_sessions and self.base_usernames:
                    new_session_id = random.randint(100000, 999999)
                    base_username = self.base_usernames[proxy_idx]
                    new_username = f"{base_username}-session-{new_session_id}"

                    logger.info(f"🔄 Generated fresh residential IP session: {new_session_id}")

                    # Return proxy with new session ID
                    return {
                        "server": proxy["server"],
                        "username": new_username,
                        "password": proxy["password"]
                    }

                return proxy

        return None
