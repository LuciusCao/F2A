# F2A Project Roadmap

> **Last Updated**: 2026-03-20
> **Current Version**: 0.2.0
> **Target Version**: 1.0.0

---

## Vision

**F2A = Friend-to-Agent P2P Network**

让每个设备都能成为 AI Agent 网络的一个节点，实现去中心化的任务协作。

---

## Current Status (v0.2.0)

- ✅ Core P2P networking with libp2p
- ✅ mDNS local discovery
- ✅ Bootstrap node support
- ✅ CLI tools (init, status, peers, discover, daemon)
- ✅ One-click installation script
- ✅ Basic security hardening

---

## Phase 1: Identity Architecture (v0.3.0) - 4 weeks

**Goal**: Separate Node identity from Agent identity

### Milestones

| Week | Task | Deliverable |
|------|------|-------------|
| W1-2 | Identity model design | Design doc + Protobuf schema |
| W2-3 | Node identity implementation | Ed25519 key generation + storage |
| W3-4 | Agent identity delegation | Delegation chain + signature verification |

### Key Decisions

- **Node Identity**: Persistent, stored in HSM/secure storage
- **Agent Identity**: Delegated by Node, migratable across Nodes
- **Trust Chain**: User → Node → Agent

### Success Metrics

- [ ] Agent can migrate between Nodes
- [ ] Trust chain validation works end-to-end
- [ ] Key rotation mechanism implemented

---

## Phase 2: Network Layer Enhancement (v0.4.0) - 4 weeks

**Goal**: Robust NAT traversal and global discovery

### Milestones

| Week | Task | Deliverable |
|------|------|-------------|
| W1-2 | STUN/TURN implementation | NAT traversal with auto-fallback |
| W2-3 | DHT discovery | Kademlia-based global discovery |
| W3-4 | Public bootstrap nodes | Official bootstrap.f2a.io |

### Key Decisions

- **NAT Traversal**: STUN first → TURN fallback → Error with guidance
- **Discovery Strategy**: mDNS (local) → DHT (global) → Bootstrap (anchor)
- **TURN Service**: Official relay service for difficult NATs

### Success Metrics

- [ ] > 90% NAT traversal success rate
- [ ] DHT discovery works across networks
- [ ] 3+ public bootstrap nodes operational

---

## Phase 3: Agent Framework (v0.5.0) - 4 weeks

**Goal**: Multi-Agent support on single Node

### Milestones

| Week | Task | Deliverable |
|------|------|-------------|
| W1-2 | Agent Registry | Local agent registration + discovery |
| W2-3 | Capability routing | Route tasks by capability tags |
| W3-4 | Health checks | L1-L4 health monitoring |

### Key Decisions

- **Registration**: Declarative with capability tags
- **Routing**: Capability match + reputation + latency
- **Health Check**: Multi-layer (process → port → response → task)

### Success Metrics

- [ ] Multiple agents can run on one Node
- [ ] Tasks routed to correct agent by capability
- [ ] Unhealthy agents auto-removed

---

## Phase 4: Governance Layer (v0.6.0) - 4 weeks

**Goal**: Trust, reputation, and multi-tenancy

### Milestones

| Week | Task | Deliverable |
|------|------|-------------|
| W1-2 | Reputation system | Dynamic reputation scoring |
| W2-3 | Multi-tenancy | Namespace isolation + resource quotas |
| W3-4 | Observability | OpenTelemetry tracing + metrics |

### Key Decisions

- **Reputation**: Based on task success rate + response time + peer feedback
- **Multi-tenancy**: Soft isolation (namespace) + Hard isolation (dedicated Node)
- **Observability**: Structured logs + distributed tracing + metrics dashboard

### Success Metrics

- [ ] Reputation scores accurately reflect agent quality
- [ ] Tenant isolation verified by security audit
- [ ] Full request tracing available

---

## Phase 5: API & SDK (v0.7.0) - 4 weeks

**Goal**: Developer-friendly APIs

### Milestones

| Week | Task | Deliverable |
|------|------|-------------|
| W1-2 | High-Level SDK | sendTask(), onTask(), getStatus() |
| W2-3 | TypeScript SDK | Full type definitions |
| W3-4 | Python SDK | Pythonic API + async support |

### Key Decisions

- **API Layers**: 4 layers (High-Level → Domain → Network → Primitives)
- **Core API**: 5 methods only (keep it simple)
- **Time to First Success**: < 5 minutes

### Success Metrics

- [ ] Developer can send first task in < 5 min
- [ ] 100% API documentation coverage
- [ ] TypeScript + Python SDKs published to npm/PyPI

---

## Phase 6: Production Ready (v1.0.0) - 4 weeks

**Goal**: Security audit + scale testing

### Milestones

| Week | Task | Deliverable |
|------|------|-------------|
| W1-2 | Security audit | External audit + penetration testing |
| W2-3 | Scale testing | 100+ nodes, 1000+ tasks |
| W3-4 | Documentation | Full docs + tutorials + examples |

### Key Decisions

- **Security**: External audit before v1.0
- **Scale**: Target 100+ concurrent nodes
- **Docs**: Tutorial + API reference + Architecture guide

### Success Metrics

- [ ] Zero critical security vulnerabilities
- [ ] 100+ node test network stable for 7 days
- [ ] Complete documentation published

---

## Long-term Vision (v1.0+)

### Agent Marketplace
- Discover and use community agents
- Rate and review agents
- Monetization for agent developers

### Federated Learning
- Agents can learn from each other
- Privacy-preserving knowledge sharing
- Model improvement without data sharing

### Cross-Platform SDKs
- Go, Rust, Java SDKs
- Mobile SDK (iOS/Android)
- Embedded SDK (Raspberry Pi, etc.)

---

## Risk Register

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| NAT traversal failures | High | Medium | Official TURN relay service |
| Reputation cold-start | Medium | Medium | Social proof + whitelist |
| Security vulnerabilities | High | Low | External audit + bug bounty |
| Community adoption | High | Medium | Documentation + examples + incentives |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.

## License

MIT License - see [LICENSE](LICENSE) for details.