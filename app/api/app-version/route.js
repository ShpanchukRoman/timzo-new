import { createHash } from 'node:crypto';

export const dynamic = 'force-dynamic';

// The worker checks imported scripts too, so every deploy can offer an update.
export function GET() {
  const release = createHash('sha256')
    .update(process.env.DEPLOY_ID || process.env.COMMIT_REF || 'timzo-local')
    .digest('hex').slice(0, 20);
  return new Response(`self.TIMZO_RELEASE = ${JSON.stringify(release)};`, {
    headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' }
  });
}
