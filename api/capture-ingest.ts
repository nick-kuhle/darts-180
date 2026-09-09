// Keep the existing project working whether Vercel is configured with repository root or apps/web as
// its Root Directory. The implementation is compiled and tested with the web workspace.
export { default } from '../apps/web/api/capture-ingest';
