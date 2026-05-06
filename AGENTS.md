# AGENTS

This agent is implementing a public GitHub Action. Treat the repository as a reusable product, not a one-off workflow script.

Keep the architecture clean and well structured:

- Preserve clear separation between input/config parsing, capture logic, README mutation, and action entrypoint wiring.
- Prefer small, composable modules with explicit types and predictable data flow.
- Keep the public contract stable across `action.yml`, `README.md`, and runtime behavior.

Design and implementation must be underpinned by GitHub Action best practices:

- Validate inputs early and fail with actionable error messages.
- Keep behavior deterministic on GitHub-hosted runners and avoid hidden environment assumptions.
- Minimize side effects: only write declared repo-relative outputs and do not manage git state unless explicitly required.
- Maintain strong documentation, test coverage for user-visible behavior, and production-ready packaged output in `dist/`.
