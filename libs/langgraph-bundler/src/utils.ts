import { createHonoServer } from '@langgraph-js/api/server';

export const filterGraphs = (
  config: Parameters<typeof createHonoServer>[0],
  agentString?: string,
) => {
  if (!agentString) return config;
  const graphs = agentString.split(',');
  // 过滤掉config.graphs中不存在的graph
  const filteredGraphs = Object.fromEntries(
    Object.keys(config.graphs)
      .filter((graph) => graphs.includes(graph))
      .map((graph) => [graph, config.graphs[graph]]),
  );
  return { ...config, graphs: filteredGraphs };
};
