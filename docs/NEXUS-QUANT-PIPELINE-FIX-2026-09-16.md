# NEXUS 33 — Quantitative Pipeline Fix

This change closes the audited path from provider data to quantitative markets, calibration, observed market value and Telegram publication.

Principles:
- provider data is never converted into fabricated historical samples;
- missing model inputs remain unknown and block calibrated signals;
- xG/corners/cards are preserved only when observed;
- calibration is explicit and deterministic from the model evidence available at decision time;
- observed odds are the only source of market value;
- Telegram is downstream-only;
- no OpenAI/ChatGPT dependency is introduced;
- legacy settlement paths must not invent half-time results.
