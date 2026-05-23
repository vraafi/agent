const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const keyManager = require('./keyManager');
const earningsTracker = require('./earningsTracker');
const telegramNotifier = require('./telegramNotifier');

async function main() {
    console.log("=========================================");
    console.log("🚀 Starting HermesMoneyAgent Orchestrator");
    console.log("=========================================");

    const dataDir = path.join(__dirname, '..', '9router-data');
    const logsDir = path.join(__dirname, '..', 'logs');

    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    // 1. Configure 9router automatically
    console.log("[Orchestrator] Generating 9Router configuration...");
    keyManager.generate9RouterConfig(dataDir);

    // 2. Configure Hermes Agent to use the 9router local proxy
    const hermesConfigPath = path.join(__dirname, '..', 'hermes-agent', 'cli-config.yaml');
    const hermesConfig = `
model:
  default: "google/gemini-1.5-pro"
  provider: "custom"
  base_url: "http://127.0.0.1:8080/v1"
`;
    fs.writeFileSync(hermesConfigPath, hermesConfig.trim());
    console.log("[Orchestrator] Configured Hermes Agent to point to http://127.0.0.1:8080/v1");

    // 3. Start 9Router
    console.log("[Orchestrator] Starting 9Router on port 8080...");
    const routerEnv = Object.assign({}, process.env, {
        PORT: 8080,
        DATA_DIR: dataDir
    });

    const routerProcess = spawn('node', [path.join(__dirname, '..', '9router', 'bin', 'n9router.js')], {
        env: routerEnv,
        stdio: 'pipe'
    });

    routerProcess.stdout.on('data', data => {
        const msg = data.toString();
        // Log startup but ignore verbose HTTP logs to keep console clean
        if (msg.includes('Starting') || msg.includes('ready') || msg.includes('listening')) {
            console.log(`[9Router] ${msg.trim()}`);
        }
    });

    routerProcess.stderr.on('data', data => {
        console.error(`[9Router ERR] ${data.toString().trim()}`);
    });

    // Wait a few seconds for 9router to bind port
    await new Promise(res => setTimeout(res, 5000));

    // 4. Send Initial Telegram Notification
    await telegramNotifier.sendAlert("🚀 HermesMoneyAgent Started! Hunting for microtasks...");

    // 5. Start Hermes Agent
    console.log("\n[Orchestrator] Spawning Hermes Agent...");
    // Hermes uses MCP server defined in hermes-agent/mcp.json to talk to JS modules
    const hermesProcess = spawn(path.join(__dirname, '..', 'hermes-agent', 'venv', 'bin', 'python'), [
        path.join(__dirname, '..', 'hermes-agent', 'hermes'),
        'chat',
        '--query',
        'Use discover_tasks tool to find legitimate microtask opportunities online and use complete_task tool to complete them. Do this until you earn $10 as fast as possible.'
    ], {
        env: Object.assign({}, process.env, { HERMES_TUI: "0" }),
        cwd: path.join(__dirname, '..', 'hermes-agent'),
        stdio: 'pipe'
    });

    const actionLogStream = fs.createWriteStream(path.join(logsDir, 'actions.log'), { flags: 'a' });

    hermesProcess.stdout.on('data', data => {
        const msg = data.toString();
        process.stdout.write(`[Hermes] ${msg}`);
        actionLogStream.write(msg);
    });

    hermesProcess.stderr.on('data', data => {
        const msg = data.toString();
        process.stderr.write(`[Hermes ERR] ${msg}`);
        actionLogStream.write(msg);
    });

    // Loop to simulate the 30-minute telegram updates
    const updateInterval = setInterval(async () => {
        const total = await earningsTracker.getTotalEarnings();
        await telegramNotifier.checkPeriodicUpdate(total);
    }, 60000); // Check every minute if 30 mins have passed

    // Graceful Shutdown Hook
    process.on('SIGINT', async () => {
        console.log("\n[Orchestrator] Received CTRL+C, shutting down gracefully...");
        clearInterval(updateInterval);

        if (routerProcess) routerProcess.kill('SIGTERM');
        if (hermesProcess) hermesProcess.kill('SIGTERM');

        await telegramNotifier.sendAlert("🛑 HermesMoneyAgent stopped gracefully.");
        actionLogStream.close();
        process.exit(0);
    });
}

main().catch(err => {
    console.error("[Orchestrator] Fatal Error:", err);
    process.exit(1);
});
