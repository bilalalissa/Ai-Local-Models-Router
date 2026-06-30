# Model Catalog

The model catalog stores seeded local model recommendations and scores them
against the active machine.

## Compatibility Labels

- Smooth: expected to run comfortably.
- Good: acceptable with normal resource pressure.
- Tight: may run, but memory, VRAM, or load constraints are likely.
- Avoid: unsupported or likely to fail on the selected machine.

## Scoring Inputs

- Platform and architecture.
- Total and available RAM.
- VRAM and GPU family.
- CPU/GPU load.
- Disk free space.
- Provider support.
- Installed status.
- Use case and user preference.
- Pause state.
- Remote availability when paired brokers expose compatible models.

Fixtures cover Apple Silicon, Intel Mac 8 GB, Intel Mac 16 GB, Intel Mac 32 GB,
and Windows GTX 1060 with 30 GB RAM.
