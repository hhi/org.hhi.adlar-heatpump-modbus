# Aurora I/II synchronization with upstream 3.12.3

Source: `hhi/org.hhi.adlar-heatpump` main commit
`9b0556e1e25022ca439faad9139323b18fc5cbf4`.

The pre-heating insight, calculation Flow card and recommendation use the
24-hour mean of the building model after at least 18 hours of history. The
history follows model persistence, reset and profile changes. Classic PI settings
are applied at construction; the configured deadband applies when model learning
is disabled. The setting hint is updated in all four languages.

The standalone app keeps its unsuffixed Flow and capability IDs and Aurora I/II
register definitions. Aurora III schema changes do not apply to this driver.

Validation: run `npm test`, `npm run lint` and `homey app validate`. On hardware,
verify custom PI values after a restart, the deadband with learning off/on, and
pre-heating recommendations after the history has warmed up.
