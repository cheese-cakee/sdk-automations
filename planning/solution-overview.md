# Solution Overview — Architecture at a Glance (work in progress)

> ⚠️ **Work in progress.** This is the high-level map of the layers, meant as the entry point to the design,
> not the specification. It will change as the open decisions below are settled. The detailed design lives
> in the linked docs.
>
> **The doc set this sits on top of:**
> - `planning/opt-in-modules.md` — the modules and how they interact through the core
> - `planning/test-architecture.md` — how the layered system is tested
> - `planning/lessons-learned.md` — the coupling failures this design is built to avoid
> - `planning/goals.md` — the vision and constraints

## The shape in one picture

A hosted GitHub App in layers: events come in at the top, flow down through config and the opt-in modules,
and **only the core touches GitHub on the way back out.**

```mermaid
flowchart TB
    GH(["GitHub — events in · writes out"])

    subgraph APP["Hosted GitHub App  ·  one install  ·  minimal permissions"]
        direction TB
        SHELL["**App shell** — receive webhooks, authenticate"]
        CFGREG["**Config + Registry** — resolve .github/hiero-automation.json (+ _extends);<br/>enable only the modules a repo declares"]
        MODS["**Modules (opt-in)** — intake · assignment · inactivity · pr-quality ·<br/>review-routing · progression · notifications · admin"]
        subgraph CORE["**Shared core** — owns everything modules share"]
            direction LR
            SM["state<br/>machine"]
            RES["resolvers"]
            SAFE["safety<br/>engine"]
            CMT["comment<br/>manager"]
            TAX["taxonomy"]
        end
        ADP["**GitHub adapter** — the single boundary to GitHub"]
    end

    GH --> SHELL --> CFGREG --> MODS
    MODS -->|"request state · read resolvers"| CORE
    CORE --> ADP --> GH

    classDef core fill:#eef,stroke:#88a;
    class SM,RES,SAFE,CMT,TAX core;
```

## The layers, one line each

| Layer | Responsibility | Detail in |
|---|---|---|
| **App shell** | Receive GitHub webhooks; one install; minimal scopes (`issues:write` · `pull-requests:write` · `contents:read`) | solution.md §2 |
| **Config + Registry** | Load and validate the repo's config, resolve `_extends` org defaults, enable only the declared modules with only their declared permissions | solution.md §3, §6 |
| **Modules (opt-in)** | Independent capabilities a repo switches on one at a time; each declares a contract and talks **only to the core** | opt-in-modules.md |
| **Shared core** | Owns every piece of state and logic modules share — the `status:` state machine, the canonical resolvers, the safety/grace-period engine, the comment manager, the taxonomy | solution.md §4 |
| **GitHub adapter** | The single place that calls GitHub, so the external contract is modelled (and tested) once | test-architecture.md §2.3 |

