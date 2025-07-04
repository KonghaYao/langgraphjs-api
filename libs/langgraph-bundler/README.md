# LangGraph.js Bundler

A comprehensive build tool for LangGraph.js applications that packages your graph configurations into deployable modules and provides a development server.

## Overview

LangGraph Bundler is a unified CLI tool that simplifies the development and deployment process of LangGraph.js applications. It provides both development and build capabilities in a single tool, automatically detecting your runtime environment and optimizing for your target deployment.

## Features

- **Unified CLI**: Single tool with `dev` and `build` commands
- **Multi-Runtime Support**: Automatic detection and support for Bun, Deno, and Node.js
- **Zero Configuration**: Automatically reads your `langgraph.json` file
- **Multiple Graph Support**: Builds all graphs defined in your configuration
- **Hot Reload Development**: File watching and automatic restart in development mode
- **ES Module Output**: Generates optimized ES modules for modern environments
- **Edge Deployment Ready**: Generates Hono server entrypoint for edge environments
- **Database Support**: Configurable database backends (PostgreSQL, SQLite)

## Installation

```bash
npm install -D @langgraph-js/bundler @langgraph-js/api
npm i -D tsx # add tsx when you use nodejs
```

## Quick Start

### 1. Create Configuration

Create a `langgraph.json` file in your project root:

```json
{
  "node_version": "20",
  "dependencies": ["."],
  "graphs": {
    "agent": "./src/agents/my-agent.ts:graph"
  },
  "env": ".env",
  "auth": {
    "path": "./src/auth.ts:auth"
  },
  "dist": "./dist",
  "bundler": {
    "externals": ["some-large-lib"]
  }
}
```

### 2. Development

Start the development server with hot reload:

```bash
npx langgraph-js dev
```

### 3. Build for Production

Build your application for deployment:

```bash
npx langgraph-js build
```

## CLI Commands

### Development Server

```bash
# Start development server (auto-detects runtime)
npx langgraph-js dev

# With custom port (for supported runtimes)
npx langgraph-js dev --port 3000

# Specify working directory
npx langgraph-js dev --cwd ./my-project
```

**Runtime Behavior:**

- **Bun**: Uses `bun run --watch dev-node.js`
- **Deno**: Uses `deno serve -A --unstable-sloppy-imports --env-file --port 8123 --watch dev-edge.js`
- **Node.js**: Uses `tsx watch --env-file=.env dev-node.js`

### Build for Production

```bash
# Build with default settings
npx langgraph-js build

# Specify database type
npx langgraph-js build --db=postgres
npx langgraph-js build --db=sqlite

# Custom working directory
npx langgraph-js build --cwd ./my-project

# Combined options
npx langgraph-js build --cwd ./my-project --db=postgres
```

### Help and Version

```bash
# Show help
npx langgraph-js --help

# Show version
npx langgraph-js --version
```

## Configuration

### langgraph.json Structure

| Field          | Type     | Description                     | Default    |
| -------------- | -------- | ------------------------------- | ---------- |
| `node_version` | string   | Target Node.js version          | -          |
| `dependencies` | string[] | Dependency directories          | `["."]`    |
| `graphs`       | object   | Graph name to file path mapping | `{}`       |
| `env`          | string   | Environment file path           | `".env"`   |
| `auth`         | object   | Authentication configuration    | -          |
| `dist`         | string   | Output directory                | `"./dist"` |
| `bundler`      | object   | Bundler configuration options   | -          |

### Graph Configuration

Define your graphs using the format: `"path/to/file.ts:exportName"`

```json
{
  "graphs": {
    "chatbot": "./src/graphs/chatbot.ts:graph",
    "agent": "./src/graphs/agent.ts:agentGraph",
    "workflow": "./src/workflows/main.ts:mainWorkflow"
  }
}
```

### Authentication Configuration

```json
{
  "auth": {
    "path": "./src/auth.ts:authHandler"
  }
}
```

### Bundler Configuration

Configure build-time external dependencies that should be kept external during bundling:

```json
{
  "bundler": {
    "externals": ["some-external-package", "another-package"]
  }
}
```

The `externals` array specifies packages that should not be bundled with your application code and should remain as external dependencies. This is useful for:

- Large libraries that should be loaded separately
- Platform-specific modules that need to be resolved at runtime
- Dependencies that have special loading requirements

## Output Structure

After building, your `dist` directory will contain:

```
dist/
├── start.js              # Development server
├── dev-node.js          # Node.js development entry
├── dev-edge.js          # Edge runtime development entry
├── entrypoint.js        # Hono server for edge deployment
├── graphs/              # Built graph modules
│   ├── chatbot.js
│   ├── agent.js
│   └── workflow.js
└── auth.js              # Authentication module
```

## Deployment

### Node.js Deployment

```bash
# Start the production server
node dist/start.js
```

### Edge Deployment (Cloudflare Workers, Deno Deploy)

```javascript
// worker.js or main.ts
import entrypoint from './dist/entrypoint.js';

export default entrypoint;
```

### Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
EXPOSE 8000
CMD ["node", "dist/start.js"]
```

## Environment Variables

Create a `.env` file for your application:

```env
# Database configuration
DATABASE_URL=postgresql://user:password@localhost:5432/langgraph

# API Keys
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key

# Server configuration
PORT=8000
NODE_ENV=production
```

## Examples

### Basic Agent

```typescript
// src/agents/simple-agent.ts
import { StateGraph } from '@langgraph-js/api';

interface AgentState {
  messages: string[];
}

const graph = new StateGraph<AgentState>({
  channels: {
    messages: [],
  },
});

// Add nodes and edges...

export { graph };
```

### With Authentication

```typescript
// src/auth.ts
export const auth = async (request: Request) => {
  const token = request.headers.get('Authorization');
  if (!token) {
    throw new Error('Authentication required');
  }
  // Validate token...
  return { userId: 'user123' };
};
```

## Troubleshooting

### Common Issues

1. **Build Fails**: Ensure all graph exports are correctly specified in `langgraph.json`
2. **Dev Server Won't Start**: Check that the runtime environment is properly set up
3. **Module Not Found**: Verify dependency paths in your configuration

### Debug Mode

Set environment variable for verbose logging:

```bash
DEBUG=langgraph:* npx langgraph-js dev
```

## Integration

This tool integrates seamlessly with:

- **LangGraph.js Core**: The main graph framework
- **LangChain.js**: For additional AI capabilities
- **Hono**: For edge deployment
- **Various Databases**: PostgreSQL, SQLite support

## Repository

Find this project on GitHub: [KonghaYao/langgraphjs-api](https://github.com/KonghaYao/langgraphjs-api)

## License

MIT
