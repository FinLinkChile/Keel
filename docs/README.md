---
type: Guía
title: "Conventions of the Keel documentation"
description: "How the docs are stored and referenced: one concept per file, frontmatter, folders, links, identifiers, precedence, and when and how to change them."
tags: [okf, conventions, docs]
modo: ambos
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-14T04:10:00Z }
---

# docs (Area 5)

The documentation is an [Open Knowledge Format (OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundle: a tree of short markdown files with YAML frontmatter. Each file is one **concept** and answers one question, so a person or an agent reads only what the task needs.

Internal documents are in Spanish. Everything delivered to the jury is in English.

# How to find something

1. Open [index.md](index.md): it routes the common needs to a file and lists the folders.
2. Open the `index.md` of the folder: one line per concept, with its description.
3. Open only the concept you need. Before designing anything new, start at [flujo/checklist-componente.md](flujo/checklist-componente.md).

| Folder | Contents |
|---|---|
| `flujo/` | Goal, principles, actors, the steps of the Keel Trade flow, states, threats and scope. The team reference |
| `arquitectura/` | Wallet pieces, permission tiers, document pipeline, identity, evidence, stack |
| `interfaces/` | Extraction schemas, intents, PDR, events and errors, and their change rules |
| `personal/` | Keel Personal, the second mode |
| `pagos/` | Token and network, fiat, exchange rate, settlement models, regulation |
| `decisiones/` | Cross-cutting decisions D1 to D14 and open decisions |
| `trabajo/` | The five areas with their tasks, calendar, cut rules |
| `contexto/` | Importer interview, positioning, WeBank, glossary, backup for jury questions |
| `entrega/` | Demo, security report, red team metrics, deliverables |

# Concept files

Every `.md` file except `index.md` and `log.md` is a concept. Its ID is its path without `.md`, for example `flujo/paso-5-saldo`.

```yaml
---
type: Paso del flujo          # required: the kind of concept
title: "Paso 5, gatillo 2: saldo"
description: "One line saying which question the concept answers."
tags: [paso-5, saldo, pdr]
modo: trade                   # trade | personal | ambos
status: draft                 # draft | stable | deprecated. Absent means stable
generated: { by: human:<github-user>, at: 2026-10-14T02:45:00Z }
verified: { by: human:<github-user>, at: 2026-10-15T12:00:00Z }
---
```

* `description` is what the index shows and what a search matches. Write it as the question the concept answers.
* `status: draft` marks a proposal the team has not confirmed. Inside the text, **[PROPUESTA]** marks a suggested design and **[ABIERTO]** something still to decide or verify. **[HECHO]**, **[EN CURSO]** and **[DISEÑO]** say whether code exists.
* `generated` says who last wrote the content: `human:<id>` for a person, `<tool>/<model>` for an agent. `verified` is added by a team member who reviewed the concept against the team's decisions. A concept without `verified` has not been reviewed by a person. An agent never adds `verified`.
* `stale_after` (optional) is the instant after which the content must be rechecked. `sources` (optional) lists what the concept derives from; cite one with a footnote whose label is the source `id`.
* The body starts at `#` headings. The title is not repeated in the body.
* Types in use: `Objetivo`, `Principios`, `Problema`, `Actores`, `Flujo`, `Paso del flujo`, `Máquina de estados`, `Interfaz`, `Amenazas`, `Alcance`, `Guía`, `Arquitectura`, `Regla`, `Modo`, `Pagos`, `Decisiones`, `Área de trabajo`, `Plan`, `Contexto`, `Glosario`, `Entrega`. Reuse one before adding another.

# References

* Link concepts with **relative** markdown links: `[paso 5](../flujo/paso-5-saldo.md)`. They work on GitHub and in editors. Do not cite section numbers: link the concept.
* One fact lives in one concept. Other concepts link to it instead of repeating it.
* Stable identifiers resolve by convention, without a search:

| Identifier | Where it lives |
|---|---|
| `D1` to `D14` | [decisiones/transversales.md](decisiones/transversales.md) |
| Open decision 1 to 14 | [decisiones/abiertas.md](decisiones/abiertas.md) |
| Task `Tn.m` | `trabajo/area-n-*.md` (task m of area n) |
| Step 0 to 6 | `flujo/paso-n-*.md` |
| Criticism 8 to 19 | [trabajo/mapa-de-criticas.md](trabajo/mapa-de-criticas.md) |

# Precedence

`flujo/` defines the goal of the project and the flow it implements. If another concept contradicts it, `flujo/` is right and the other concept is fixed. If the team changes the goal or the flow, `flujo/` is updated first and the code after.

# When to change the documentation

Update a concept in the same pull request as the change that makes it outdated:

* The team changed the goal or the flow, or closed an open decision. The documentation changes first, the code after.
* The team confirmed or dropped something marked **[PROPUESTA]** or `status: draft`.
* A shared interface in `schemas/` or `contracts/src/` changed with the approval of the owning area.
* Something marked **[EN CURSO]** or **[DISEÑO]** is done.
* A task, the calendar, a cut rule or a deliverable changed.

Raise it with the team before editing when a decision is involved: the code contradicts a concept, two concepts contradict each other, a new threat or residual risk appears, something moves in or out of scope, or a question nobody has decided comes up (add it to [decisiones/abiertas.md](decisiones/abiertas.md), do not answer it). Never edit a concept just to make it match the code.

The documentation does not record progress or implementation details that the code already shows.

# Changing the documentation

1. Edit the concept that owns the fact, or add a new concept in the folder where it belongs. Keep it short: if a concept answers two questions, split it.
2. Update `generated` and remove `verified` if the content changed in substance.
3. Update the folder `index.md` when a concept is added, renamed, removed or its `description` changes. Index files have no frontmatter (only the root one carries `okf_version`).
4. Add a line to [log.md](log.md) under the date, newest first.
5. Closing an open decision: update the affected concept, then [decisiones/abiertas.md](decisiones/abiertas.md), then the code.

# Evidence

PDR records are stored in `evidence/pdr/`, outside this bundle. Their hash goes on chain in the gate event. See [arquitectura/evidencia-y-bitacora.md](arquitectura/evidencia-y-bitacora.md).
