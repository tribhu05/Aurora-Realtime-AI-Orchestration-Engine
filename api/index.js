import { createAuroraServer } from '../server/server.js';

const { app } = createAuroraServer({ quiet: true });

export default app;
