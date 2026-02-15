import { getDb, initDb } from '@/lib/db';
import { NextResponse } from 'next/server';

// Ensure table exists on first call
let initialized = false;
async function ensureInit() {
    if (!initialized) {
        await initDb();
        initialized = true;
    }
}

// GET /api/segments?date=YYYY-MM-DD
// GET /api/segments?week=YYYY-MM-DD (Monday of the week)
export async function GET(request) {
    await ensureInit();
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const week = searchParams.get('week');

    if (date) {
        const result = await db.execute({
            sql: 'SELECT * FROM time_segments WHERE date = ? ORDER BY id ASC',
            args: [date],
        });
        return NextResponse.json({ segments: result.rows });
    }

    if (week) {
        // week param is the Monday; get Mon-Sun
        const days = [];
        const monday = new Date(week + 'T00:00:00');
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(d.getDate() + i);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            days.push(`${y}-${m}-${day}`);
        }
        const placeholders = days.map(() => '?').join(',');
        const result = await db.execute({
            sql: `SELECT * FROM time_segments WHERE date IN (${placeholders}) ORDER BY date ASC, id ASC`,
            args: days,
        });
        return NextResponse.json({ segments: result.rows });
    }

    return NextResponse.json({ error: 'Provide ?date= or ?week= parameter' }, { status: 400 });
}

// POST /api/segments  { date, seg_start, seg_end? }
export async function POST(request) {
    await ensureInit();
    const db = getDb();
    const body = await request.json();
    const { date, seg_start, seg_end } = body;

    if (!date || !seg_start) {
        return NextResponse.json({ error: 'date and seg_start are required' }, { status: 400 });
    }

    const result = await db.execute({
        sql: 'INSERT INTO time_segments (date, seg_start, seg_end) VALUES (?, ?, ?)',
        args: [date, seg_start, seg_end || null],
    });

    return NextResponse.json({ id: Number(result.lastInsertRowid), date, seg_start, seg_end: seg_end || null });
}

// PUT /api/segments  { id, seg_start?, seg_end? }
export async function PUT(request) {
    await ensureInit();
    const db = getDb();
    const body = await request.json();
    const { id, seg_start, seg_end } = body;

    if (!id) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const fields = [];
    const args = [];

    if (seg_start !== undefined) {
        fields.push('seg_start = ?');
        args.push(seg_start);
    }
    if (seg_end !== undefined) {
        fields.push('seg_end = ?');
        args.push(seg_end);
    }

    if (fields.length === 0) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    args.push(id);
    await db.execute({
        sql: `UPDATE time_segments SET ${fields.join(', ')} WHERE id = ?`,
        args,
    });

    return NextResponse.json({ success: true });
}

// DELETE /api/segments?week=YYYY-MM-DD
export async function DELETE(request) {
    await ensureInit();
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const week = searchParams.get('week');

    if (!week) {
        return NextResponse.json({ error: 'Provide ?week= parameter' }, { status: 400 });
    }

    const days = [];
    const monday = new Date(week + 'T00:00:00');
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(d.getDate() + i);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        days.push(`${y}-${m}-${day}`);
    }
    const placeholders = days.map(() => '?').join(',');
    await db.execute({
        sql: `DELETE FROM time_segments WHERE date IN (${placeholders})`,
        args: days,
    });

    return NextResponse.json({ success: true });
}
