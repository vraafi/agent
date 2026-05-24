try {
    require('@modelcontextprotocol/sdk/server/index.js');
    require('dotenv');
    require('sqlite3');
    console.log('WSL Node.js modules are 100% OK!');
} catch (e) {
    console.error('Failed to load modules:', e.message);
    process.exit(1);
}
