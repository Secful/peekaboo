"""Helper functions for the API crawler."""

from typing import Optional
from urllib.parse import urlparse

from playwright.async_api import Page, Response

from .constants import (
    STATIC_EXTENSIONS,
    API_SCRIPT_EXTENSIONS,
    API_PATH_PATTERNS,
    API_CONTENT_TYPES,
    ID_PATTERNS,
)


def _templatize(path: str) -> str:
    """Replace ID-like path segments with placeholders."""
    parts = path.strip("/").split("/")
    result = []
    for part in parts:
        replaced = False
        for pattern, placeholder in ID_PATTERNS:
            if pattern.fullmatch(part):
                result.append(placeholder)
                replaced = True
                break
        if not replaced:
            result.append(part)
    return "/" + "/".join(result) if result else "/"


def _is_static(req_url: str) -> bool:
    """Check if a URL points to a static file."""
    # Parse URL and get path without query parameters
    parsed_path = urlparse(req_url).path.lower()
    # Strip trailing slashes/backslashes before checking extension
    parsed_path = parsed_path.rstrip('/\\')
    # Check if it ends with any static extension
    return any(parsed_path.endswith(ext) for ext in STATIC_EXTENSIONS)


async def _auto_scroll(page: Page):
    """Automatically scroll the page to trigger lazy loading."""
    try:
        await page.evaluate("""async () => {
            await new Promise(r => {
                let t = 0; const s = 400;
                const i = setInterval(() => {
                    window.scrollBy(0, s); t += s;
                    if (t >= document.body.scrollHeight || t > 6000) { clearInterval(i); r(); }
                }, 150);
            });
        }""")
        await page.wait_for_timeout(800)
    except Exception:
        pass


async def _interact(page: Page):
    """Click on interactive elements to trigger API calls."""
    for sel in ["button:visible", "[role='tab']:visible"]:
        try:
            elements = await page.query_selector_all(sel)
            for el in elements[:3]:
                try:
                    await el.click(timeout=2000)
                    await page.wait_for_timeout(600)
                except Exception:
                    pass
        except Exception:
            pass


async def _dismiss_floating_dialogs(page: Page):
    """Attempt to dismiss any floating dialogs, modals, overlays, and popups."""
    try:
        # Generic dismiss button text patterns (case-insensitive, multiple languages)
        dismiss_patterns = [
            # English
            "OK", "ok", "Close", "close", "Accept", "accept", "Agree", "agree",
            "Continue", "continue", "Got it", "got it", "I understand", "Dismiss",
            "dismiss", "Allow", "allow", "Yes", "yes", "Confirm", "confirm",
            "No thanks", "no thanks", "Maybe later", "maybe later", "Not now", "not now",
            # French
            "Accepter", "accepter", "D'accord", "d'accord", "Fermer", "fermer",
            "Continuer", "continuer", "Oui", "oui", "Compris", "compris",
            # Spanish
            "Aceptar", "aceptar", "Cerrar", "cerrar", "Continuar", "continuar",
            "Entendido", "entendido", "Sí", "sí", "De acuerdo", "de acuerdo",
            # German
            "Akzeptieren", "akzeptieren", "Schließen", "schließen", "Weiter", "weiter",
            "Verstanden", "verstanden", "Ja", "ja", "Einverstanden", "einverstanden",
            # Italian
            "Accetta", "accetta", "Chiudi", "chiudi", "Continua", "continua",
            "Ho capito", "ho capito", "Sì", "sì", "D'accordo", "d'accordo",
            # Hebrew
            "אישור", "אשר", "קיבלתי", "הבנתי", "סגור", "המשך", "אני מסכים",
            "מסכים", "אפשר", "אוקיי", "כן",
            # Portuguese
            "Aceitar", "aceitar", "Fechar", "fechar", "Concordo", "concordo",
            # Dutch
            "Accepteren", "accepteren", "Akkoord", "akkoord", "Sluiten", "sluiten",
            # Cookie-specific text (multi-lang)
            "Accept all", "Accept All", "Accept cookies", "Accept Cookies",
            "Allow all", "Allow All", "Allow cookies", "Allow Cookies",
            "I agree", "I Agree", "Tout accepter", "Alle akzeptieren",
            "Accetta tutti", "Aceptar todo", "Aceitar tudo",
        ]

        # Strategy 1: Try text-based button matching
        for pattern in dismiss_patterns:
            try:
                selectors = [
                    f"button:has-text('{pattern}')",
                    f"a:has-text('{pattern}')",
                    f"[role='button']:has-text('{pattern}')",
                    f"div[onclick]:has-text('{pattern}')",
                    f"span[onclick]:has-text('{pattern}')",
                ]

                for selector in selectors:
                    try:
                        element = page.locator(selector).first
                        if await element.is_visible(timeout=300):
                            await element.click(timeout=800)
                            await page.wait_for_timeout(400)
                            return
                    except Exception:
                        continue
            except Exception:
                continue

        # Strategy 2: Try common close button symbols and classes
        close_selectors = [
            # Close button symbols
            "button:has-text('×')",
            "button:has-text('✕')",
            "a:has-text('×')",
            "[aria-label*='close' i]",
            "[aria-label*='dismiss' i]",
            "[title*='close' i]",
            # Common modal/dialog close buttons
            ".modal button.close",
            ".modal .close-button",
            ".modal-close",
            ".dialog-close",
            ".popup-close",
            ".overlay-close",
            "[class*='close'][class*='button']",
            "[class*='dismiss'][class*='button']",
            # Cookie consent frameworks (OneTrust, CookieBot, Didomi, Quantcast, etc.)
            "#onetrust-accept-btn-handler",
            ".onetrust-close-btn-handler",
            "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
            "#CybotCookiebotDialogBodyButtonAccept",
            "#didomi-notice-agree-button",
            ".didomi-continue-without-agreeing",
            "#axeptio_btn_acceptAll",
            "#tarteaucitronPersonalize2",
            ".cc-accept-all",
            ".cc-btn.cc-allow",
            ".cc-compliance button",
            "#consent_prompt_submit",
            "#qc-cmp2-ui button[mode='primary']",
            ".sp_choice_type_11",
            "[data-testid='uc-accept-all-button']",
            # Generic cookie selectors
            ".cookie-consent button",
            ".cookie-banner button",
            "[class*='cookie'] button[class*='accept']",
            "[class*='cookie'] button[class*='allow']",
            "[class*='consent'] button[class*='accept']",
            "[class*='consent'] button[class*='allow']",
            "[id*='cookie'] button",
            "#cookie-accept",
            "#accept-cookies",
            "#cookies-accept",
            "#acceptAllCookies",
            "#allow-all-cookies",
            # Modal/dialog role-based
            "[role='dialog'] button",
            "[role='alertdialog'] button",
            # Generic modal classes
            ".modal-footer button",
            ".dialog-footer button",
            "[class*='modal'] button[class*='primary']",
            "[class*='modal'] button[class*='accept']",
        ]

        for selector in close_selectors:
            try:
                element = page.locator(selector).first
                if await element.is_visible(timeout=300):
                    await element.click(timeout=800)
                    await page.wait_for_timeout(400)
                    return
            except Exception:
                continue

        # Strategy 3: Try pressing Escape key to close modals
        try:
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(300)
        except Exception:
            pass

    except Exception:
        # Silently fail - not all pages have dialogs
        pass


def _looks_like_js_payload(content_type: str, body: Optional[str] = None) -> bool:
    """Return True if the response looks like a JavaScript payload rather than API data."""
    ct = content_type.lower()
    # Explicit JS content types
    if any(t in ct for t in ("javascript", "ecmascript")):
        return True
    # Check body for obfuscated / minified JS patterns
    if body:
        trimmed = body.strip()[:2000]  # only inspect first 2KB
        # Starts with typical JS constructs (not JSON)
        if trimmed and trimmed[0] not in ('{', '[', '<', '"'):
            # Common obfuscated JS signatures
            js_indicators = 0
            for pattern in (
                "function(", "function (", "var ", "let ", "const ", "=>",
                "!function", "(function", "self.__next",
                "window.", "document.", "eval(", "atob(",
                ".call(", ".apply(", ".prototype",
                "try{", "try {", "catch(", "catch (",
                ";var ", ";let ", ";const ", "void 0",
                "===", "!==", "typeof ",
                "new Function", "String.fromCharCode",
            ):
                if pattern in trimmed:
                    js_indicators += 1
            if js_indicators >= 2:
                return True
    return False


def _classify(req_url: str, method: str, resource_type: str, response: Response) -> str:
    """Classify whether a URL is an API endpoint."""
    parsed = urlparse(req_url)
    path = parsed.path

    # Non-GET methods are always APIs
    if method not in ("GET", "HEAD", "OPTIONS"):
        return f"{method} request"

    # Check Content-Type for JSON/XML responses (regardless of resource type)
    resp_ct = response.headers.get("content-type", "").lower()
    if any(ct in resp_ct for ct in API_CONTENT_TYPES):
        if resource_type in ("xhr", "fetch"):
            return "XHR/fetch JSON/XML response"
        return "JSON/XML response"

    # Check for server-side script extensions (PHP, ASP, JSP, etc.)
    path_lower = path.lower()
    for ext in API_SCRIPT_EXTENSIONS:
        if path_lower.endswith(ext):
            return f"Server-side script ({ext})"

    # Check API path patterns
    for pattern in API_PATH_PATTERNS:
        if pattern.search(path):
            return f"API path pattern"

    # XHR/fetch without JSON is still likely an API
    if resource_type in ("xhr", "fetch"):
        return "XHR/fetch request"

    return ""
