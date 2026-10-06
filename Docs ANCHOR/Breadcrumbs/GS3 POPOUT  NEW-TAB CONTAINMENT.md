# BREADCRUMB — GS3 POPOUT / NEW-TAB CONTAINMENT

## FEATURE

Create a first-class GS3 capability for preventing unwanted provider-driven tabs/windows from escaping the GS3 experience.

Working names:

```text
Popout Shield
Navigation Containment
External Launch Blocker
```

Final naming TBD.

---

## USER PROBLEM

Many adult-video providers use click-triggered advertising behavior.

Typical flow:

```text
GS3 Panel contains provider page
→ Human clicks Play / video
→ provider launches unwanted new tab/window/popunder
→ browser shifts Human away from GS3
→ Human must close unwanted page
→ return to GS3
```

This is highly disruptive to the multi-panel GS3 experience.

Desired behavior:

```text
Human clicks inside GS3 Panel
→ legitimate in-panel interaction continues
→ unwanted external tab/window launch is absorbed or blocked
→ Human remains inside GS3
```

---

## PRODUCT INTENT

This should become a **first-class GS3 capability**, not a provider-specific userscript hack.

It should ideally operate generically across providers.

Examples may include:

```text
XNXX
XVideos
Pornhub
SpankBang
Eporner
PornTrex
TNAFlix
Chaturbate
other web content used inside GS3
```

Provider-specific exceptions may exist, but the architecture should begin from a generic containment model.

---

## IMPORTANT

Do NOT assume the correct implementation is literally:

```text
find advertising JavaScript
→ block that script
```

Because provider content is often cross-origin, GS3 parent JavaScript cannot freely inspect or rewrite the child document.

Investigate the strongest browser-level / iframe-level containment mechanisms first.

Potential territory includes:

```text
iframe sandbox policy
allow-popups
allow-popups-to-escape-sandbox
top-navigation restrictions
window.open behavior
target="_blank"
popunder behavior
user-activation rules
CDP browser events
extension/webNavigation interception if ever required
```

The ideal architecture prevents the escape rather than reverse-engineering every provider's advertising script.

---

## GOLDEN BEHAVIOR

```text
CLICK PLAY
→ video still plays

CLICK NORMAL IN-PANEL NAVIGATION
→ allowed when intended

UNWANTED POPUP / POPUNDER / NEW TAB
→ blocked

ATTEMPTED ESCAPE FROM PANEL
→ GS3 remains foreground experience
```

---

## DO NOT BREAK

Containment must not accidentally destroy:

```text
video playback
player controls
fullscreen
legitimate in-frame navigation
Current-URL Bridge observation
provider Embed adapters
authentication/session state
GS3 Refresh
Shuffle
Move / Swap
Panel continuity
```

---

## IMPORTANT DISTINCTIONS TO TEST

Not every "escape" is necessarily the same mechanism.

Classify at least:

```text
window.open(...)

<a target="_blank">

popunder

top.location / parent navigation attempt

redirect of the actual Panel itself

new browser tab

new browser window

provider-controlled intermediate ad page

user-intended explicit Open in New Tab
```

GS3 may need different policies for these.

---

## PRODUCT BOUNDARY

The feature should distinguish:

```text
UNWANTED PROVIDER ESCAPE
→ block / contain
```

from:

```text
EXPLICIT GS3 ACTION
"Open Current in New Tab"
→ allow
```

The Human should remain in control.

---

## RELATION TO CURRENT-URL BRIDGE

These are complementary first-class primitives.

```text
Current-URL Bridge
= know where the Panel actually navigated

Popout Shield
= prevent unwanted navigation from escaping the Panel/browser experience
```

Potential future synergy:

```text
provider attempts navigation
→ GS3 can classify:
   in-panel navigation
   observed navigation
   external escape attempt
```

Do NOT merge their state models unnecessarily.

---

## DESIRED UX

Default hypothesis:

```text
Popout Shield: ON
```

Prefer quiet protection rather than constant UI.

Possible future Panel / Settings state:

```text
🛡 Popout Shield
ON
```

If a launch is blocked, optionally provide a restrained status cue:

```text
Blocked external popout
```

Do not create noisy notifications on every click.

---

## SCOUT QUESTIONS FOR LATER

Before implementation, determine:

1. Which unwanted launches can be prevented purely through iframe `sandbox` policy?

2. Which sandbox tokens are currently required by GS3/provider playback?

3. Can `allow-popups` simply be omitted while preserving playback and ordinary in-frame browsing?

4. Which providers break under stronger iframe sandboxing?

5. Can unwanted top-level navigation also be contained?

6. Are some provider pages already dependent on popup capability for legitimate controls/authentication?

7. Can CDP observe/block browser target creation if sandbox containment is insufficient?

8. Is a Chrome extension/browser companion ever necessary, or can GS3 solve the common case entirely from its iframe construction policy?

9. How does this interact with Current-URL Bridge and future `Open Current` commands?

10. Should protection be:
   - global default
   - per Panel
   - per provider
   - capability-negotiated?

---

## R0 SUCCESS TEST

Use several real provider pages known to trigger unwanted launches.

For each:

```text
load provider in real GS3 Panel
→ click player / video repeatedly
→ playback remains functional
→ in-panel navigation remains functional
→ no unwanted external tab/window steals focus
```

Also test a deliberate GS3-controlled external-open action and confirm that it can still be allowed.

---

## FIRST-CLASS INVARIANT

> **Content inside a GS3 Panel should not be able to eject the Human from the GS3 experience without explicit Human intent.**

---

## STATUS

```text
BREADCRUMBED
NOT YET SCOUTED
NOT YET ARCHITECTED
NOT YET IMPLEMENTED
```

Do not mix this into the active Current-URL Bridge R0 unless a discovery there directly informs this feature.