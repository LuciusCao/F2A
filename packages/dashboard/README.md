# F2A Dashboard

A web-based visualization dashboard for F2A (Friend-to-Agent) network.

## Features

- **Network Topology View**: Visual representation of connected nodes
- **Node List**: Detailed information about each peer
- **Capability Display**: Shows registered capabilities for each agent
- **Real-time Updates**: Auto-refreshes every 5 seconds

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Configuration

### Environment Variables

- `VITE_API_URL`: F2A control server API URL (default: `/api` for proxy)

### Authentication

The dashboard requires a control token to access protected endpoints (`/status`, `/peers`).

1. Get the token from your F2A config:
   ```bash
   cat ~/.f2a/config.json | jq .controlToken
   ```

2. Enter the token in the dashboard UI when prompted

## API Endpoints

The dashboard connects to the F2A control server:

- `GET /health` - Health check (no auth)
- `GET /status` - Node status (requires auth)
- `GET /peers` - Connected peers list (requires auth)

## Integration

### Standalone

Run the dashboard separately with proxy to F2A:

```bash
# Start F2A daemon
f2a start

# Start dashboard with proxy
npm run dev
```

### Embedded

The built dashboard can be served directly from the F2A daemon:

```bash
npm run build
# Copy dist/ to F2A static files directory
```

## Tech Stack

- React 18
- TypeScript
- Tailwind CSS
- Vite