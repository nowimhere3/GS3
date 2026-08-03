# Architecture Lab

This folder is a sandbox to validate a provider-agnostic Runtime/Provider design **without touching production code**.

## Purpose

Validate that:

1. Runtime owns collection behavior.
2. Providers own data/persistence semantics.
3. Runtime stays unchanged when providers are swapped.
4. Panel/grid/workspace integration is intentionally out of scope (until Phase 4C is complete).

## Scope (in)

- Runtime contract and behavior
- Provider contract
- FakeProvider
- URLProvider (lab-only shim around existing URL DB shape)
- Minimal tests
- Minimal browser demo

## Scope (out)

- `js/launch.js`, `js/single-launch.js`, `js/grid.js` integration
- Workspace switching / serialization
- Undo stack integration
- Extension integration

## Success Criteria

- [ ] FakeProvider passes runtime tests
- [ ] URLProvider passes runtime tests
- [ ] LocalFolderProvider prototype can be added without runtime changes
- [ ] Runtime remains provider-agnostic

## Graduation Rule

Only after criteria pass should code move into production paths:

- `architecture-lab/runtime/*` → `js/runtime/*`
- `architecture-lab/providers/*` → `js/providers/*`
