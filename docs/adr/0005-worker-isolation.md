# ADR 0005: Worker isolation and `--no-sandbox`

**Status:** accepted

The worker runs as a non-root user in a read-only container with all capabilities dropped. Chromium runs with `--no-sandbox` because the container is the sandbox and the kernel sandbox needs capabilities we deliberately drop. Outbound traffic is restricted by an allow-listing proxy added after real sync is proven (`EGRESS_MODE=off|log|enforce`).
