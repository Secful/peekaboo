"""Helper functions for the API crawler."""

import asyncio
import logging
import re
from typing import Optional
from urllib.parse import urlparse

from playwright.async_api import Page, Response

logger = logging.getLogger(__name__)

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


async def _deep_interact(page: Page):
    """Perform deep page interaction to discover more API calls.

    Used only for remote browser sessions. Scrolls the full page, clicks
    buttons/tabs/accordions/load-more links, submits one search form,
    and follows pagination — all to trigger lazy-loaded XHR/fetch calls.
    Each action is individually wrapped in try/except for fault tolerance.
    Total execution is capped at 30 seconds.
    """

    async def _run():
        page_origin = urlparse(page.url).netloc

        # -- 1a. Full-page scroll (capped at 20,000px) -----------------------
        try:
            await page.evaluate("""async () => {
                await new Promise(r => {
                    let t = 0; const s = 500;
                    const maxH = Math.min(document.body.scrollHeight, 20000);
                    const i = setInterval(() => {
                        window.scrollBy(0, s); t += s;
                        if (t >= maxH) { clearInterval(i); r(); }
                    }, 200);
                });
                window.scrollTo(0, 0);
            }""")
            await page.wait_for_timeout(500)
        except Exception:
            pass

        # -- helper: safe click that skips cross-origin links -----------------
        async def _safe_click(el):
            try:
                href = await el.get_attribute("href")
                if href and href.startswith("http"):
                    link_origin = urlparse(href).netloc
                    if link_origin and link_origin != page_origin:
                        return
                await el.click(timeout=2000)
                await page.wait_for_timeout(800)
            except Exception:
                pass

        # -- 1b. Click buttons & tabs (up to 8) ------------------------------
        for sel in ["button:visible", "[role='tab']:visible"]:
            try:
                elements = await page.query_selector_all(sel)
                for el in elements[:8]:
                    await _safe_click(el)
            except Exception:
                pass

        # -- 1b cont. Accordions / collapsibles (up to 5) --------------------
        accordion_sels = [
            "details > summary",
            "[aria-expanded='false']",
            ".accordion-header",
            ".collapse-toggle",
        ]
        clicked_accordion = 0
        for sel in accordion_sels:
            if clicked_accordion >= 5:
                break
            try:
                elements = await page.query_selector_all(sel)
                for el in elements:
                    if clicked_accordion >= 5:
                        break
                    await _safe_click(el)
                    clicked_accordion += 1
            except Exception:
                pass

        # -- 1b cont. "Load more" / "Show more" links (up to 3) --------------
        try:
            candidates = await page.query_selector_all("a:visible, button:visible")
            load_more_count = 0
            for el in candidates:
                if load_more_count >= 3:
                    break
                try:
                    text = (await el.inner_text()).strip()
                    if re.search(r"load\s*more|show\s*more|view\s*all|see\s*all|next\s*page", text, re.IGNORECASE):
                        await _safe_click(el)
                        load_more_count += 1
                except Exception:
                    pass
        except Exception:
            pass

        # -- 1c. Fill and submit one search/filter form -----------------------
        try:
            forms = await page.query_selector_all("form:visible")
            for form in forms:
                text_input = await form.query_selector("input[type='search'], input[type='text']")
                if text_input:
                    try:
                        await text_input.fill("test")
                        await text_input.press("Enter")
                        await page.wait_for_timeout(1500)
                    except Exception:
                        pass
                    break  # only one form
        except Exception:
            pass

        # -- 1d. Pagination (up to 2 clicks) ----------------------------------
        pagination_sels = [
            ".pagination a",
            "nav[aria-label*='pag'] a",
            "[role='navigation'] a",
        ]
        pagination_clicks = 0
        for sel in pagination_sels:
            if pagination_clicks >= 2:
                break
            try:
                links = await page.query_selector_all(sel)
                for link in links:
                    if pagination_clicks >= 2:
                        break
                    try:
                        text = (await link.inner_text()).strip().lower()
                        if text in ("next", "2", "»", "›", ">"):
                            await _safe_click(link)
                            pagination_clicks += 1
                    except Exception:
                        pass
            except Exception:
                pass

        # -- 1e. Wait for network settle --------------------------------------
        try:
            await page.wait_for_load_state("networkidle", timeout=5000)
        except Exception:
            pass

    # Cap total execution at 30 seconds
    try:
        await asyncio.wait_for(_run(), timeout=30)
    except asyncio.TimeoutError:
        logger.debug("_deep_interact timed out after 30s")
    except Exception as exc:
        logger.debug("_deep_interact error: %s", exc)


async def _try_click_in_frames(page: Page, js_script: str, description: str) -> bool:
    """Run a JS finder script across the main frame and all iframes.

    The JS script must return either a CSS selector string for the best
    matching element, or null if nothing was found.  When the element has
    no usable id we stamp it with a ``data-vc-dismiss`` attribute so a
    unique CSS selector can be returned from inside the JS.

    Returns True if an element was found and clicked.
    """
    for frame in page.frames:
        try:
            selector = await frame.evaluate(js_script)
            if selector:
                el = frame.locator(selector).first
                await el.click(timeout=2000)
                logger.info("Dismissed consent banner via %s (frame=%s)", description, frame.url[:80])
                return True
        except Exception:
            continue
    return False


# ---------------------------------------------------------------------------
# JS finder scripts – each returns a CSS selector string or null
# ---------------------------------------------------------------------------

_FRAMEWORK_SELECTORS_JS = """(() => {
    const sels = [
        '#onetrust-accept-btn-handler',
        '.onetrust-close-btn-handler',
        '#accept-recommended-btn-handler',
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
        '#CybotCookiebotDialogBodyButtonAccept',
        '#CybotCookiebotDialogBodyLevelButtonAccept',
        '#didomi-notice-agree-button',
        '.didomi-continue-without-agreeing',
        '#axeptio_btn_acceptAll',
        '#tarteaucitronPersonalize2',
        '#tarteaucitronAllAllowed',
        '.cc-accept-all',
        '.cc-btn.cc-allow',
        '.cc-compliance .cc-btn',
        '#consent_prompt_submit',
        "#qc-cmp2-ui button[mode='primary']",
        '.sp_choice_type_11',
        "[data-testid='uc-accept-all-button']",
        '#cookie-accept',
        '#accept-cookies',
        '#cookies-accept',
        '#acceptAllCookies',
        '#allow-all-cookies',
        '#ez-accept-all',
        '.fc-cta-consent',
        '.cmpboxbtn.cmpboxbtnyes',
        '#iubenda-cs-accept-btn',
        '#moove_gdpr_cookie_info_bar .mgbutton',
        '#hs-eu-confirmation-button',
        '.evidon-banner-acceptbutton',
        '.truste_popframe .call',
    ];
    for (const s of sels) {
        try {
            const el = document.querySelector(s);
            if (el && el.offsetParent !== null) return s;
        } catch(e) {}
    }
    return null;
})()"""

_TEXT_MATCH_JS = """(() => {
    // Patterns ordered by priority (cookie-specific first, then generic).
    // Each entry: [regex, priority] — lower number = higher priority.
    const patterns = [
        [/^accept all$/i, 1],
        [/^accept cookies?$/i, 1],
        [/^allow all$/i, 1],
        [/^allow cookies?$/i, 1],
        [/^i agree$/i, 1],
        [/^agree and continue$/i, 1],
        [/^tout accepter$/i, 1],
        [/^alle akzeptieren$/i, 1],
        [/^alle accepteren$/i, 1],
        [/^accetta tutti$/i, 1],
        [/^aceptar todo$/i, 1],
        [/^aceitar tudo$/i, 1],
        [/^accept$/i, 2],
        [/^agree$/i, 2],
        [/^accepter$/i, 2],
        [/^aceptar$/i, 2],
        [/^accetta$/i, 2],
        [/^aceitar$/i, 2],
        [/^akzeptieren$/i, 2],
        [/^accepteren$/i, 2],
        [/^אישור$/i, 2],
        [/^אשר$/i, 2],
        [/^קיבלתי$/i, 2],
        [/^הבנתי$/i, 2],
        [/^מסכים$/i, 2],
        [/^אני מסכים$/i, 2],
        [/^got it$/i, 3],
        [/^i understand$/i, 3],
        [/^ok$/i, 4],
        [/^okay$/i, 4],
        [/^continue$/i, 4],
        [/^confirm$/i, 4],
        [/^close$/i, 4],
        [/^dismiss$/i, 4],
        [/^d'accord$/i, 4],
        [/^compris$/i, 4],
        [/^fermer$/i, 4],
        [/^continuer$/i, 4],
        [/^cerrar$/i, 4],
        [/^continuar$/i, 4],
        [/^entendido$/i, 4],
        [/^de acuerdo$/i, 4],
        [/^schließen$/i, 4],
        [/^weiter$/i, 4],
        [/^verstanden$/i, 4],
        [/^einverstanden$/i, 4],
        [/^chiudi$/i, 4],
        [/^d'accordo$/i, 4],
        [/^ho capito$/i, 4],
        [/^fechar$/i, 4],
        [/^concordo$/i, 4],
        [/^akkoord$/i, 4],
        [/^sluiten$/i, 4],
        [/^סגור$/i, 4],
        [/^המשך$/i, 4],
        [/^אפשר$/i, 4],
        [/^אוקיי$/i, 4],
        [/^כן$/i, 4],
        [/^yes$/i, 5],
        [/^allow$/i, 5],
        [/^oui$/i, 5],
        [/^ja$/i, 5],
        [/^sí$/i, 5],
        [/^sì$/i, 5],
        [/^no thanks$/i, 5],
        [/^maybe later$/i, 5],
        [/^not now$/i, 5],
    ];

    let best = null;
    let bestPri = 999;
    const clickable = document.querySelectorAll(
        'button, a, [role="button"], div[onclick], span[onclick]'
    );
    for (const el of clickable) {
        if (el.offsetParent === null) continue;  // hidden
        const txt = (el.textContent || '').trim();
        if (txt.length > 50) continue;  // skip paragraph-like elements
        for (const [re, pri] of patterns) {
            if (pri >= bestPri) continue;
            if (re.test(txt)) {
                best = el;
                bestPri = pri;
                break;
            }
        }
    }
    if (!best) return null;
    if (best.id) return '#' + CSS.escape(best.id);
    const tag = 'vc-' + Math.random().toString(36).slice(2, 8);
    best.setAttribute('data-vc-dismiss', tag);
    return '[data-vc-dismiss="' + tag + '"]';
})()"""

_GENERIC_CLOSE_JS = """(() => {
    const sels = [
        "[aria-label*='close' i]",
        "[aria-label*='dismiss' i]",
        "[aria-label*='fermer' i]",
        "[aria-label*='schließen' i]",
        "[aria-label*='cerrar' i]",
        "[aria-label*='סגור' i]",
        "[title*='close' i]",
        "[title*='dismiss' i]",
        '.modal button.close',
        '.modal .close-button',
        '.modal-close',
        '.dialog-close',
        '.popup-close',
        '.overlay-close',
        ".cookie-consent button",
        ".cookie-banner button",
        "[class*='cookie'] button",
        "[class*='consent'] button",
        "[id*='cookie'] button",
        "[role='dialog'] button",
        "[role='alertdialog'] button",
        ".modal-footer button",
        ".dialog-footer button",
        "[class*='modal'] button[class*='primary']",
        "[class*='modal'] button[class*='accept']",
        "[class*='close'][class*='button']",
        "[class*='dismiss'][class*='button']",
    ];
    for (const s of sels) {
        try {
            const el = document.querySelector(s);
            if (el && el.offsetParent !== null) {
                if (el.id) return '#' + CSS.escape(el.id);
                const tag = 'vc-' + Math.random().toString(36).slice(2, 8);
                el.setAttribute('data-vc-dismiss', tag);
                return '[data-vc-dismiss="' + tag + '"]';
            }
        } catch(e) {}
    }
    return null;
})()"""


async def _dismiss_floating_dialogs(page: Page):
    """Dismiss cookie consent banners, modals, overlays, and popups.

    Uses batched in-browser JavaScript evaluation across the main frame
    and all iframes so that consent frameworks rendered in iframes
    (OneTrust, CookieBot, TrustArc, Quantcast CMP, etc.) are found.
    Retries up to 3 times to handle multi-step consent flows.
    """
    try:
        for attempt in range(3):
            clicked = False

            # Phase 1: Framework-specific CSS selectors
            if await _try_click_in_frames(page, _FRAMEWORK_SELECTORS_JS, "framework selector"):
                clicked = True

            # Phase 2: Text-based matching (only if phase 1 didn't click)
            if not clicked and await _try_click_in_frames(page, _TEXT_MATCH_JS, "text match"):
                clicked = True

            # Phase 3: Generic close buttons (only if nothing found yet)
            if not clicked and await _try_click_in_frames(page, _GENERIC_CLOSE_JS, "generic close"):
                clicked = True

            if not clicked:
                break  # Nothing found — stop retrying

            # Wait for potential follow-up dialog before next attempt
            await page.wait_for_timeout(500)

        # Phase 4: Escape key as last resort (always try once)
        try:
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(200)
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
