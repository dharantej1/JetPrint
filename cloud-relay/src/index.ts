import { createRelayServer } from './app.js';

async function main(): Promise<void> {
  const server = createRelayServer();
  const port = await server.start();

  console.log(
    `[JetPrint Cloud Relay] listening on http://localhost:${port} (ws://localhost:${port}/ws)`
  );
  console.log(
    `[JetPrint Cloud Relay] mode=${server.config.devMode ? 'DEV_FALLBACK' : 'RAZORPAY_LIVE'}`
  );

  const shutdown = async () => {
    console.log('\n[JetPrint Cloud Relay] shutting down...');
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
