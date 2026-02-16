import { getDb, initDb } from '@/lib/db';
import { NextResponse } from 'next/server';

let initialized = false;
async function ensureInit() {
    if (!initialized) {
        await initDb();
        initialized = true;
    }
}

// GET /api/summary — returns all segments for analytics
export async function GET() {
    await ensureInit();
    const db = getDb();
    const result = await db.execute(
        'SELECT date, seg_start, seg_end FROM time_segments WHERE seg_end IS NOT NULL ORDER BY date ASC, id ASC'
    );
    return NextResponse.json({ segments: result.rows });
}
