# Automations

## Purpose

Automations describe what Runtime should do when Runtime Events occur.

Automations only execute inside Runtime.

They never execute inside the Workspace Editor.

---

## Philosophy

Runtime Events answer:

"What happened?"

Automations answer:

"What should happen because it happened?"

---

## Basic Structure

IF

Runtime Event

AND

Conditions

THEN

Execute Actions

---

## Example

IF

Video Finished

AND

Repeat = On

THEN

Reload Panel

---

## Example

IF

Video Finished

AND

Reload Count >= 3

THEN

Shuffle Collection

---

## Example

IF

Timer Elapsed

THEN

Launch Workspace 4

---

## Example

IF

Panel Failed

THEN

Reload

WAIT 5 Seconds

IF Failed Again

THEN

Shuffle

---

## Runtime Variables

Automations may reference Runtime Variables.

Examples

Repeat Count

Reload Count

Time Watched

Panels Remaining

Random Value

Current Workspace

Current Collection

Current Folder

Current Capability

---

## Future Actions

Examples include:

Reload Panel

Shuffle

Shuffle All

Launch Workspace

Launch Stream

Launch Solo

Load Collection

Move Panel

Enable Timer

Disable Timer

Pause Runtime

Resume Runtime

Set Runtime Variable

Call Agent

Trigger Webhook

Run Script

---

## Design Goals

Automations should be:

Predictable

Composable

Serializable

Independent of UI

Independent of panel implementation

Everything should execute from Runtime Session.

## Future Stream Loop capability chain (breadcrumb only)

LAUNCH WORKSPACE → LOAD → PROVIDER ADAPT → AUTO FILL → EXCLUSIVE PLAYBACK → DELAY / SMART DELAY → AUTOPLAY.

Keep PROVIDER_PRESENTATION, FILL_PRESENTATION, POPOUT_CONTAINMENT, EXCLUSIVE_PLAYBACK, AUTOPLAY,
PLAYBACK_DELAY and SMART_PLAYBACK_DELAY as independently composed Runtime policies.
Provider URL adapters remain pure presentation mappings from assignedUrl; they do
not own timing, autoplay, or canonical content identity. This breadcrumb introduces
no production behavior.

## Exclusive playback (future policy; documentation only)

ENTER FILL → remember underlying presentation/playback state → pause or suspend
the underlying presentation when possible → if cross-origin cooperation makes
pause impossible, mute is an acceptable fallback → the Fill presentation becomes
the Human-controlled audio source.

EXIT FILL → remove the Fill presentation → restore the underlying presentation
according to product policy and its remembered state.

Default preference: pause/suspend underlying media. Fallback: mute. An optional
future setting may leave underlying media playing. Muting solves audible
competition; suspension is preferable because hidden playback may otherwise
continue consuming CPU, GPU and network resources. These are product preferences,
not a claim that parent JavaScript can universally pause or mute a cross-origin
player. No exclusive playback, Auto Fill, autoplay, delay or smart delay behavior
is implemented by this breadcrumb.
