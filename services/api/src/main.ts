import { buildServer } from './server';

const port = Number(process.env.DARTS180_API_PORT ?? 8787);
const host = '0.0.0.0';

const app = await buildServer();
await app.listen({ port, host });
