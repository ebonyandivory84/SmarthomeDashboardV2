# SmartHome Dashboard V2 Adapter

This folder contains the adapter runtime and static web hosting target.

For full project documentation (features, install, development workflow, screenshots),
see the repository root README:

- [README.md](../README.md)

## Adapter Responsibilities

- hosts the exported web app under `/smarthome-dashboard-v2`
- provides API endpoints for config, state reads/writes, object browse, camera proxy, and dashboard storage
- supports optional dev-server proxy mode for rapid frontend iteration

## Important

Before pushing production updates, export the current web bundle:

```bash
npm run export:web
```

Then commit `adapter/www` together with code changes.
