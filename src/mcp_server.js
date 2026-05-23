/**
 * MCP Server bridging the Node.js modules to the Python Hermes Agent
 */
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");

const taskDiscovery = require('./taskDiscovery.js');
const earningsTracker = require('./earningsTracker.js');
const telegramNotifier = require('./telegramNotifier.js');

const server = new Server(
  { name: "money-agent-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "discover_tasks",
      description: "Finds and returns a list of available microtasks from Toloka, Remotasks, and Clickworker filtered by profitability.",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "complete_task",
      description: "Simulates completing a task and logs the earnings. Call this when you decide to do a task.",
      inputSchema: {
        type: "object",
        properties: {
          platform: { type: "string", description: "The platform of the task (e.g. Toloka)" },
          taskId: { type: "string", description: "The ID of the task to complete" },
          payout: { type: "number", description: "The payout of the task in USD" }
        },
        required: ["platform", "taskId", "payout"]
      }
    },
    {
      name: "get_earnings",
      description: "Returns the current total earnings.",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      }
    },
    {
      name: "send_telegram_update",
      description: "Sends a custom message to the user via Telegram.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "The message to send" }
        },
        required: ["message"]
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "discover_tasks") {
    const tasks = await taskDiscovery.discoverTasks();
    return {
      content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }]
    };
  }

  if (request.params.name === "complete_task") {
    const { platform, taskId, payout } = request.params.arguments;
    await earningsTracker.logTask(platform, taskId, payout);
    return {
      content: [{ type: "text", text: `Successfully completed task ${taskId} on ${platform} for $${payout}. Earnings logged.` }]
    };
  }

  if (request.params.name === "get_earnings") {
    const total = await earningsTracker.getTotalEarnings();
    return {
      content: [{ type: "text", text: `Current total earnings: $${total.toFixed(2)}` }]
    };
  }

  if (request.params.name === "send_telegram_update") {
    const { message } = request.params.arguments;
    await telegramNotifier.sendAlert(message);
    return {
      content: [{ type: "text", text: "Message sent successfully." }]
    };
  }

  throw new Error(`Unknown tool: ${request.params.name}`);
});

const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
