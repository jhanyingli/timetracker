'use client';

import { useState, useEffect } from 'react';

function timeToMinutes(t) {
    if (!t) return 0;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function minutesToHM(mins) {
    if (mins < 0) mins = 0;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
}

function formatDecimal(mins) {
    return (mins / 60).toFixed(1) + 'h';
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

export default function Summary() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function load() {
            const res = await fetch('/api/summary');
            const json = await res.json();
            setData(computeStats(json.segments || []));
            setLoading(false);
        }
        load();
    }, []);

    function computeStats(segments) {
        if (segments.length === 0) return null;

        // Group by date → total minutes per day
        const dayMap = {};
        for (const seg of segments) {
            if (!seg.seg_start || !seg.seg_end) continue;
            const mins = timeToMinutes(seg.seg_end) - timeToMinutes(seg.seg_start);
            if (mins <= 0) continue;
            dayMap[seg.date] = (dayMap[seg.date] || 0) + mins;
        }

        const dates = Object.keys(dayMap).sort();
        if (dates.length === 0) return null;

        const totalMins = Object.values(dayMap).reduce((a, b) => a + b, 0);
        const totalDays = dates.length;

        // Average per day worked
        const avgDayMins = Math.round(totalMins / totalDays);

        // Weeks: group by ISO week (Monday-based)
        const weekSet = new Set();
        for (const d of dates) {
            weekSet.add(getISOWeek(d));
        }
        const totalWeeks = Math.max(weekSet.size, 1);
        const avgWeekMins = Math.round(totalMins / totalWeeks);

        // Months: group by YYYY-MM
        const monthMap = {};
        for (const [date, mins] of Object.entries(dayMap)) {
            const key = date.substring(0, 7); // "YYYY-MM"
            if (!monthMap[key]) monthMap[key] = { totalMins: 0, days: 0 };
            monthMap[key].totalMins += mins;
            monthMap[key].days += 1;
        }

        const monthKeys = Object.keys(monthMap).sort();
        const totalMonths = Math.max(monthKeys.length, 1);
        const avgMonthMins = Math.round(totalMins / totalMonths);

        // Monthly breakdown
        const months = monthKeys.map(key => {
            const [y, m] = key.split('-').map(Number);
            const info = monthMap[key];
            return {
                label: `${MONTH_NAMES[m - 1]} ${y}`,
                key,
                totalMins: info.totalMins,
                days: info.days,
                avgPerDay: Math.round(info.totalMins / info.days),
            };
        });

        // Find the month with the most total minutes for the bar chart scale
        const maxMonthMins = Math.max(...months.map(m => m.totalMins), 1);

        return {
            totalMins,
            totalDays,
            avgDayMins,
            avgWeekMins,
            avgMonthMins,
            months,
            maxMonthMins,
            firstDate: dates[0],
            lastDate: dates[dates.length - 1],
        };
    }

    function getISOWeek(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        return d.toISOString().substring(0, 10);
    }

    if (loading) {
        return (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
                <div className="timer-display" style={{ fontSize: '1.5rem' }}>Loading...</div>
            </div>
        );
    }

    if (!data) {
        return (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 40, height: 40, marginBottom: '0.6rem', opacity: 0.4 }}>
                    <path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" />
                </svg>
                <p style={{ fontSize: '0.85rem' }}>No data to summarize yet</p>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>Start tracking time to see your stats!</p>
            </div>
        );
    }

    return (
        <div className="summary-view">
            {/* Overview Cards */}
            <div className="summary-overview">
                <div className="summary-stat-card">
                    <span className="summary-stat-label">Total Tracked</span>
                    <span className="summary-stat-value accent">{minutesToHM(data.totalMins)}</span>
                    <span className="summary-stat-sub">{data.totalDays} days worked</span>
                </div>
                <div className="summary-stat-card">
                    <span className="summary-stat-label">Avg / Day</span>
                    <span className="summary-stat-value">{minutesToHM(data.avgDayMins)}</span>
                    <span className="summary-stat-sub">{formatDecimal(data.avgDayMins)} per work day</span>
                </div>
                <div className="summary-stat-card">
                    <span className="summary-stat-label">Avg / Week</span>
                    <span className="summary-stat-value">{minutesToHM(data.avgWeekMins)}</span>
                    <span className="summary-stat-sub">{formatDecimal(data.avgWeekMins)} per week</span>
                </div>
                <div className="summary-stat-card">
                    <span className="summary-stat-label">Avg / Month</span>
                    <span className="summary-stat-value">{minutesToHM(data.avgMonthMins)}</span>
                    <span className="summary-stat-sub">{formatDecimal(data.avgMonthMins)} per month</span>
                </div>
            </div>

            {/* Monthly Breakdown */}
            <div className="card monthly-card">
                <div className="card-header">
                    <h2>Monthly Breakdown</h2>
                </div>
                <div className="monthly-list">
                    {data.months.slice().reverse().map(month => (
                        <div key={month.key} className="monthly-row">
                            <div className="monthly-info">
                                <span className="monthly-name">{month.label}</span>
                                <span className="monthly-detail">{month.days} days · avg {minutesToHM(month.avgPerDay)}/day</span>
                            </div>
                            <div className="monthly-bar-wrap">
                                <div className="monthly-bar" style={{ width: `${(month.totalMins / data.maxMonthMins) * 100}%` }} />
                            </div>
                            <span className="monthly-total">{minutesToHM(month.totalMins)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
