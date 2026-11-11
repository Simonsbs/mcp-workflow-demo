# Validation

Local validation completed on 11 November 2026. Public deployment, custom-domain verification and final CI evidence are pending; version 1 is not yet declared complete.

| Validation | Recorded outcome |
| --- | --- |
| Strict TypeScript check | Pass |
| Unit and SDK interoperability tests | 40 passed |
| SQLite HTTP scenarios | 34 passed, 45 actual requests |
| Compiled Worker/D1 HTTP scenarios | 34 passed, 45 actual requests |
| Both local process restarts | Complete state and original access capabilities preserved |
| Local browser checks | 20 passed, including five actual denial probes |
| Downloaded browser ZIP | Six files extracted; 44 independent evidence checks passed; no capability keys |
| Compiled Worker artifact | Embedded assets, documentation, security/cache headers and route/method boundaries passed |
| Dependency audit | Zero reported vulnerabilities |

The HTTP suite exercises genuine SDK negotiation and discovery, strict tool schemas, read-only investigation, an adversarial retrieved-content fixture, wrong token audience, read/write scope separation, approval bypass, controller self-approval denial, explicit rejection, exact proposal validation, digest tampering, cross-workspace isolation, parallel approved execution, source staleness, replay, legacy stateless interoperability, independent audit verification, ZIP extraction, origin checks and request size limits. Unit tests also cover clock expiry, actor/resource binding, failed optimistic commits, evidence tampering and resource bounds.

Local browser checks cover workspace creation, modern MCP investigation, live tool discovery, exact task inspection, pending-write denial, reviewer scope enforcement, explicit rejection, rejected-write denial, explicit approval, successful task creation, replay, all five denial probes, retrieved injection data, a healthy-order denial, actual ZIP download, independent downloaded-file validation, uploaded evidence verification, reload recovery, mobile layout and the captured protocol exchange. The mobile viewport was 390 by 844, with no horizontal page overflow and all form inputs labelled. Browser automation used the real UI.

Machine-readable evidence is in [docs/validation](docs/validation). [development-failures.json](docs/validation/development-failures.json) retains the initial compile/test issues and the incorrect security-probe display. No failed attempt is represented as a passing run. CI repeats type, unit, build, actual HTTP/restart and dependency checks on Windows and Linux.

These are agent-run engineering checks using synthetic data, not an independent security audit or human acceptance sign-off. Manual demo tokens are not a full OAuth implementation; a fixed deterministic runner does not validate an arbitrary language model's prompt-injection resistance.
