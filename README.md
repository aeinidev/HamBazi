<div align="center">

# 🎮 HamBazi | هم‌بازی

### Multiplayer gaming, built for connection.

**A Persian-first, real-time multiplayer game hub powered by Telegram Mini Apps.**

[![GitHub stars](https://img.shields.io/github/stars/aeinidev/HamBazi?style=flat-square)](https://github.com/aeinidev/HamBazi/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/aeinidev/HamBazi?style=flat-square)](https://github.com/aeinidev/HamBazi/issues)
[![Development status](https://img.shields.io/badge/status-active%20development-7c3aed?style=flat-square)](#project-status)
[![Platform](https://img.shields.io/badge/platform-Telegram%20Mini%20App-26A5E4?style=flat-square)](https://core.telegram.org/bots/webapps)

[Overview](#overview) · [Features](#features) · [Architecture](#architecture) · [Getting started](#getting-started) · [Contributing](#contributing)

</div>

---

## Overview

**HamBazi (هم‌بازی)** is an independently developed multiplayer gaming platform that brings social and strategy games together in a single, mobile-friendly experience inside Telegram.

The project focuses on **Persian-speaking players**, with a right-to-left interface, shared game rooms, and a backend designed for synchronized multiplayer gameplay. Alongside the player experience, HamBazi explores practical engineering challenges around game-state consistency, secure sessions, asynchronous processing, and operational reliability.

> **Project status:** Active development and restricted testing. The public GitHub repository is available for technical exploration; this is **not** an announcement of a public production launch.

## Features

- **Telegram-native experience:** Bot and Mini App components built around Telegram's ecosystem.
- **Persian-first UI:** Right-to-left layouts and a cohesive **Midnight Neon** visual identity.
- **Multiplayer room flows:** Public and private rooms, invite-based access, and player-count-aware sessions.
- **Game-specific logic:** Dedicated engines and interfaces, including ongoing work on **Kahroba**, a gem-collecting strategy game.
- **Game session infrastructure:** Server-side state management and concurrency controls for multiplayer interactions.
- **Player profiles:** Display names, usernames, avatars, and gameplay statistics.
- **Testing and operations:** Automated checks and a container-based development/staging workflow.

Individual features and games may be experimental, disabled, or available only in restricted environments while development continues.

## Technology and architecture

HamBazi is organized as a **pnpm / Turborepo monorepo**, separating user-facing applications, game code, shared packages, and infrastructure.

| Area | Approach |
| --- | --- |
| User experience | Telegram Mini App, Persian RTL web interface |
| Applications | Web, API, Telegram Bot, background worker |
| Game logic | Separately organized game packages and session flows |
| Data and messaging | PostgreSQL and Redis |
| Development | Node.js 24, pnpm 12, Turborepo |
| Infrastructure | Docker Compose and environment-specific configuration |
| Quality | ESLint, Prettier, TypeScript checks, Vitest, build and contract checks |

### Repository organization

```text
apps/               # Web, API, Bot and worker applications
packages/           # Shared modules and domain packages
packages/games/     # Game-specific packages
infra/              # Docker, local infrastructure and operational scripts
tooling/            # Development tools and shared tooling
docs/               # Architecture, design, testing and operational documentation
```

The directory overview is intentionally high-level; consult the source and documentation for current implementation details.

## Getting started

### Prerequisites

- **Node.js 24**
- **pnpm 12.4.1**
- **Docker** with Docker Compose (for local supporting services)
- A suitable local environment configuration; Telegram-connected flows may require Telegram credentials and a reachable callback configuration

### Clone and inspect

```bash
git clone https://github.com/aeinidev/HamBazi.git
cd HamBazi
corepack enable
pnpm install --frozen-lockfile
```

### Available development checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run the full repository validation pipeline with:

```bash
pnpm check
```

The repository also includes local infrastructure helpers (`pnpm infra:env`, `pnpm infra:config`, `pnpm infra:up`, `pnpm infra:down`). **Inspect the scripts and the generated configuration before running them.** A complete, publicly supported one-command setup for all Telegram flows has not yet been documented.

## Project status and roadmap

HamBazi is an evolving engineering project rather than a finished product. Current work focuses on:

- Improving the quality and responsiveness of the game lobby and mobile UI.
- Completing and validating multiplayer game flows, including Kahroba.
- Hardening authentication, room admission, and game-state integrity.
- Expanding end-to-end, device, security, and reliability testing.
- Preparing documentation and contribution processes for a broader developer community.

Milestones are subject to change, and features should not be assumed production-ready unless explicitly released.

## Why this project matters

Online multiplayer experiences are not always designed around **Persian language support**, right-to-left interaction, and lightweight access through an app people already use. HamBazi aims to narrow that gap while documenting reusable engineering patterns for turn-based multiplayer services.

The repository is newly public, so it does **not** claim broad adoption or an established contributor community. Its value today is the ongoing implementation, the engineering lessons it can share, and the opportunity for future collaboration.

## Contributing

Feedback, reproducible bug reports, documentation improvements, and technical discussions are welcome through [GitHub Issues](https://github.com/aeinidev/HamBazi/issues).

Before submitting a substantial pull request, please open an issue to discuss the change. Contribution guidelines, supported local setup instructions, and project governance are being developed.

## Security

Please **do not publish credentials, access tokens, production configuration, personal data, or exploitable vulnerability details** in public issues.

For security concerns, contact the repository maintainer privately through an appropriate channel before disclosing technical details. A formal vulnerability reporting policy is planned.

## License and source availability

The repository is **publicly viewable**, but **a public source repository is not automatically open-source licensed**. As of this README draft, the root `package.json` declares `UNLICENSED` and no root `LICENSE` file was found. Until a license is explicitly selected and published, do not assume you have permission to reuse, modify, or redistribute the code.

The maintainer intends to clarify the licensing and contribution policy as the project evolves.

---

<div align="center">

**Built with care for Persian-speaking gamers and the developers who make multiplayer experiences possible.**

[Explore the source](https://github.com/aeinidev/HamBazi) · [Report an issue](https://github.com/aeinidev/HamBazi/issues)

</div>
