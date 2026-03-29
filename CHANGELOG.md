# Changelog

All notable changes to F2A will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-03-18

### Added
- **mDNS Local Discovery**: Automatic peer discovery on local networks without bootstrap nodes
- **Bootstrap Node Public Key Fingerprint Verification**: Enhanced security with fingerprint validation
- **One-click Install Script**: Simplified installation with `curl -fsSL https://raw.githubusercontent.com/LuciusCao/F2A/main/install.sh | bash`
- **Quick Start Documentation**: 5-minute onboarding guide in QUICKSTART.md
- **IReputationManager Interface**: Extracted interface for plugin compatibility

### Security
- Full codebase security audit and fixes
- Hardened token storage with proper file permissions
- Prevented token exposure in systemd service files
- Addressed code review security issues (P1 & P2)

### Fixed
- Resolved code review issues across multiple PRs
- Fixed missing `fi` in install.sh systemd block
- Security and validation improvements in CLI and install script

## [0.1.3] - Previous Release

Initial public release with core P2P networking functionality.