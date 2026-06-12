/**
 * GET /api/engine/decisions
 *
 * Returns the most recent AllocationDecision events from on-chain.
 * These are rendered by the frontend DecisionFeed component as plain-language
 * cards linking to the on-chain event per CLAUDE.md rule 4.
 *
 * Query params:
 *   limit  — number of events to return (default 20, max 100)
 *   cursor — pagination cursor (opaque event ID)
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireDeployed } from '@reflux/lib';
import { suiClient, env } from '../../_lib/client.js';
import { ok, validationErr, serverErr, serializeBigInt } from '../../_lib/response.js';

export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = QuerySchema.safeParse(params);
  if (!parsed.success) return validationErr(parsed.error);

  try {
    const deployed = requireDeployed(env);
    const { limit, cursor } = parsed.data;

    const eventType = `${deployed.NEXT_PUBLIC_PACKAGE_ID}::allocator::AllocationDecision`;

    const events = await suiClient.queryEvents({
      query: { MoveEventType: eventType },
      limit,
      cursor: cursor ? { txDigest: cursor, eventSeq: '0' } : undefined,
      order: 'descending',
    });

    const decisions = events.data.map((e) => ({
      id: `${e.id.txDigest}:${e.id.eventSeq}`,
      txDigest: e.id.txDigest,
      timestampMs: e.timestampMs,
      parsedJson: e.parsedJson,
    }));

    return ok(serializeBigInt({
      decisions,
      nextCursor: events.nextCursor?.txDigest,
      hasMore: events.hasNextPage,
    }));
  } catch (e) {
    return serverErr(e);
  }
}
