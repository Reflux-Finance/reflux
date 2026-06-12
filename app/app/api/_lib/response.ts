import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, data }, { status });
}

export function err(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export function validationErr(e: ZodError): NextResponse {
  return err(e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
}

export function serverErr(e: unknown): NextResponse {
  const msg = e instanceof Error ? e.message : String(e);
  return err(`Internal error: ${msg}`, 500);
}

/** Serialize a value, converting BigInt → string so JSON.stringify doesn't throw. */
export function serializeBigInt<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, val) =>
    typeof val === 'bigint' ? val.toString() : val,
  ));
}
