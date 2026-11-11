# Validation

Version 1 validation completed on 11 November 2026. The standalone application is public without sign-in at [workflow.bestdev.co.il](https://workflow.bestdev.co.il/), with its own [repository](https://github.com/Simonsbs/mcp-workflow-demo).

| Validation                                  | Recorded outcome                                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript check                     | Pass                                                                                                                                      |
| Unit and SDK interoperability tests         | 40 passed                                                                                                                                 |
| SQLite HTTP scenarios                       | 34 passed, 45 actual requests                                                                                                             |
| Compiled Worker/D1 HTTP scenarios           | 34 passed, 45 actual requests                                                                                                             |
| Public provider URL HTTP scenarios          | 34 passed, 45 actual requests                                                                                                             |
| Public custom domain HTTP scenarios         | 34 passed, 45 actual requests                                                                                                             |
| Both local process restarts                 | Complete state and original access capabilities preserved                                                                                 |
| Local browser checks                        | 20 passed, including five actual denial probes                                                                                            |
| Public browser checks                       | 14 passed, including all five actual denial probes                                                                                        |
| Actual local / public browser ZIP downloads | Six files extracted each; 44 / 30 independent evidence checks passed; no capability keys                                                  |
| Public D1 across redeployment               | Exact original state retained: one task, three proposals, 28 audit events; original controller capability still valid; 49 evidence checks |
| Public hosting checks                       | Six passed on each hostname, including application fingerprint matching                                                                   |
| Existing root and four project hostnames    | All five still return HTTPS 200                                                                                                           |
| Compiled Worker artifact                    | Embedded assets, documentation, security/cache headers and route/method boundaries passed                                                 |
| Dependency audit                            | Zero reported vulnerabilities                                                                                                             |
| Windows and Linux GitHub Actions            | Type, unit, build, HTTP/restart and dependency checks pass                                                                                |

The HTTP suite exercises genuine SDK negotiation and discovery, strict tool schemas, read-only investigation, an adversarial retrieved-content fixture, wrong token audience, read/write scope separation, approval bypass, controller self-approval denial, explicit rejection, exact proposal validation, digest tampering, cross-workspace isolation, parallel approved execution, source staleness, replay, legacy stateless interoperability, independent audit verification, ZIP extraction, origin checks and request size limits. Unit tests also cover clock expiry, actor/resource binding, failed optimistic commits, evidence tampering and resource bounds.

Local browser checks cover workspace creation, modern MCP investigation, live tool discovery, exact task inspection, pending-write denial, reviewer scope enforcement, explicit rejection, rejected-write denial, explicit approval, successful task creation, replay, all five denial probes, retrieved injection data, a healthy-order denial, actual ZIP download, independent downloaded-file validation, uploaded evidence verification, reload recovery, mobile layout and the captured protocol exchange. The mobile viewport was 390 by 844, with no horizontal page overflow and all form inputs labelled. Browser automation used the real UI.

The 14 public browser checks cover sign-in-free workspace creation, modern investigation, pending denial, controller scope denial, explicit approval, task creation, replay, five live security probes, the untrusted injection fixture, live tool discovery, actual download and independent extraction, uploaded JSON verification, reload recovery and the mobile layout. The public ZIP contained one task, one proposal and 17 audit events. The original browser workspace also retained its consumed approval and returned the same task after a public redeployment.

Public SQL retention was tested with a separate checkpoint whose bearer capabilities stayed only in a running Node process. After a successful native redeployment, the same controller key fetched a state deeply equal to the original snapshot. See [public-deployment-retention.json](docs/validation/public-deployment-retention.json). The reproducible command is `node --experimental-strip-types scripts/verify-public.mjs https://workflow.bestdev.co.il --checkpoint`, followed by `verify` after deployment. No keys are written to the report.

Machine-readable evidence is in [docs/validation](docs/validation). [development-failures.json](docs/validation/development-failures.json) retains the initial compile/test issues and the incorrect security-probe display. No failed attempt is represented as a passing run. CI repeats type, unit, build, actual HTTP/restart and dependency checks on Windows and Linux.

The custom hostname initially returned a hosting dispatcher 404 during domain provisioning and briefly after TLS became active. Republishing the already saved version with the active domain binding repaired routing. Both failed attempts are retained. No apex DNS record, other project DNS record or zone-wide SSL setting was changed.

The application source fingerprint is `3e090580a1a8085806d750e8ef7d3d59f930747112856b6b880a9c8a79673cbc`. Documentation/evidence updates do not change that application fingerprint. Exact saved-source commits are tracked by native Site versions and GitHub. [Latest CI runs](https://github.com/Simonsbs/mcp-workflow-demo/actions).

These are agent-run engineering checks using synthetic data, not an independent security audit or human acceptance sign-off. Manual demo tokens are not a full OAuth implementation; a fixed deterministic runner does not validate an arbitrary language model's prompt-injection resistance.
