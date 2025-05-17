# LangGraph Bundler

A build tool for LangGraph.js applications that packages your graph configurations into deployable modules.

## Overview

LangGraph Bundler simplifies the process of bundling and deploying LangGraph.js applications. It reads your `langgraph.json` configuration and builds optimized modules for all your defined graphs and authentication handlers.

## Features

- **Zero Configuration**: Automatically reads your `langgraph.json` file
- **Multiple Graph Support**: Builds all graphs defined in your configuration
- **ES Module Output**: Generates optimized ES modules for modern environments
- **Development Server**: Includes a development server for testing
- **Hono Server Support**: Generates a Hono server entrypoint for edge deployment
- **Seamless Integration**: Works with the LangGraph.js ecosystem
- **Multi-Runtime Support**: Supports Bun, Deno, and Node.js environments

## Usage

### Installation

```bash
npm install @langgraph-js/bundler @langgraph-js/api --save-dev
```

### Configuration

Create a `langgraph.json` file in your project root with the following structure:

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
  "dist": "./dist"
}
```

### Building Your Project

Run the bundler:

```bash
npx @langgraph-js/bundler
```

This will:

1. Read your `langgraph.json` configuration
2. Build all defined graphs and authentication handlers
3. Output the bundled files to your specified `dist` directory
4. Generate a development server and Hono server entrypoint

### Configuration Options

- `node_version`: The Node.js version to target
- `dependencies`: Array of dependency directories
- `graphs`: Object mapping graph names to file paths with export names
- `env`: Path to environment file
- `auth`: Authentication configuration
- `dist`: Output directory path (defaults to "./dist")

## Development

### Development Server

You can start the development server using the `langgraph-dev` command:

```bash
npx langgraph-dev
```

The development server automatically detects your runtime environment (Bun or Node.js) and starts the appropriate server configuration.

#### Runtime Behavior

- **Bun**: Uses `bunx --bun langgraph-dev`
- **Node.js**: Uses `npx langgraph-dev`

### Manual Server Start

You can also start the bundled development server manually:

```bash
node dist/start.js
```

## Deployment Options

### Edge Deployment with Hono

The bundler generates an `entrypoint.js` file that can be used to deploy your LangGraph application to edge environments like Cloudflare Workers or Deno Deploy:

```javascript
// Example usage with Cloudflare Workers
import entrypoint from './dist/entrypoint.js';

export default entrypoint;
```

## Integration with LangGraph.js

This bundler is designed to work seamlessly with other LangGraph.js tools and libraries, allowing you to easily deploy your graphs to production environments.

## Repository

Find this project on GitHub: [KonghaYao/langgraphjs-api](https://github.com/KonghaYao/langgraphjs-api)

## License

MIT
