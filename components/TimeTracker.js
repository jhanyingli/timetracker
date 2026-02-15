'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

// ---- Constants ----
const FULL_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ---- Utility Functions ----
function todayStr() {
    const d = new Date();
    return isoDate(d);
}

function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMondayOfWeek(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return isoDate(d);
}

function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return isoDate(d);
}

function nowTimeStr() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

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

function formatDateHeader(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatWeekRange(mondayStr) {
    const monday = new Date(mondayStr + 'T00:00:00');
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    return `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function displayTime(time24, use12h) {
    if (!time24 || time24 === '—') return '—';
    if (!use12h) return time24;
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function parseTimeInput(input) {
    if (!input) return null;
    input = input.trim().toUpperCase();
    const match12 = input.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (match12) {
        let h = parseInt(match12[1]);
        const m = parseInt(match12[2]);
        const period = match12[3];
        if (h < 1 || h > 12 || m < 0 || m > 59) return null;
        if (period === 'AM' && h === 12) h = 0;
        else if (period === 'PM' && h !== 12) h += 12;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    const match24 = input.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
        const h = parseInt(match24[1]);
        const m = parseInt(match24[2]);
        if (h < 0 || h > 23 || m < 0 || m > 59) return null;
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    return null;
}

function calcDayMinutes(segments) {
    if (!segments || segments.length === 0) return 0;
    let total = 0;
    for (const seg of segments) {
        if (seg.seg_start && seg.seg_end) {
            total += timeToMinutes(seg.seg_end) - timeToMinutes(seg.seg_start);
        }
    }
    return Math.max(total, 0);
}

function calcBreaks(segments) {
    if (!segments || segments.length < 2) return [];
    const breaks = [];
    for (let i = 1; i < segments.length; i++) {
        const prevEnd = segments[i - 1].seg_end;
        const currStart = segments[i].seg_start;
        if (prevEnd && currStart) {
            breaks.push({ start: prevEnd, end: currStart, duration: timeToMinutes(currStart) - timeToMinutes(prevEnd) });
        }
    }
    return breaks;
}

// ---- API Helpers ----
async function apiGet(params) {
    const sp = new URLSearchParams(params);
    const res = await fetch(`/api/segments?${sp}`);
    const data = await res.json();
    return data.segments || [];
}

async function apiPost(body) {
    const res = await fetch('/api/segments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.json();
}

async function apiPut(body) {
    const res = await fetch('/api/segments', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.json();
}

async function apiDelete(week) {
    const res = await fetch(`/api/segments?week=${week}`, { method: 'DELETE' });
    return res.json();
}

// ---- Component ----
export default function TimeTracker() {
    const [status, setStatus] = useState('idle'); // idle | running | paused | stopped
    const [selectedDate, setSelectedDate] = useState(todayStr());
    const [selectedWeekMonday, setSelectedWeekMonday] = useState(getMondayOfWeek(todayStr()));
    const [use12h, setUse12h] = useState(false);
    const [timerText, setTimerText] = useState('00:00:00');
    const [daySegments, setDaySegments] = useState([]); // segments for selectedDate
    const [weekSegments, setWeekSegments] = useState([]); // segments for the whole week
    const [currentSegStartTime, setCurrentSegStartTime] = useState(null); // "HH:MM:SS"
    const [loading, setLoading] = useState(true);

    // Modal state
    const [editModal, setEditModal] = useState(null); // { label, value, segId, field } or null
    const [editValue, setEditValue] = useState('');
    const [editError, setEditError] = useState(false);
    const [confirmModal, setConfirmModal] = useState(false);

    const intervalRef = useRef(null);
    const editInputRef = useRef(null);

    // ---- Load format preference ----
    useEffect(() => {
        try {
            setUse12h(localStorage.getItem('timetracker_format') === '12h');
        } catch { }
    }, []);

    // ---- Fetch day & week data ----
    const loadDayData = useCallback(async (date) => {
        const segs = await apiGet({ date });
        setDaySegments(segs);
        return segs;
    }, []);

    const loadWeekData = useCallback(async (monday) => {
        const segs = await apiGet({ week: monday });
        setWeekSegments(segs);
        return segs;
    }, []);

    // Initial load
    useEffect(() => {
        async function init() {
            const today = todayStr();
            const monday = getMondayOfWeek(today);
            const [todaySegs] = await Promise.all([
                loadDayData(today),
                loadWeekData(monday),
            ]);
            // Restore state from DB
            if (todaySegs.length > 0) {
                const last = todaySegs[todaySegs.length - 1];
                if (!last.seg_end) {
                    setStatus('running');
                    setCurrentSegStartTime(last.seg_start + ':00');
                } else {
                    // Check if any segment has an end but it looks like the day was "stopped"
                    // We'll consider it stopped if there's data
                    const allClosed = todaySegs.every(s => s.seg_end);
                    setStatus(allClosed ? 'stopped' : 'idle');
                }
            }
            setLoading(false);
        }
        init();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ---- Timer tick ----
    const getElapsedSeconds = useCallback(() => {
        const today = todayStr();
        // Use daySegments only if viewing today
        const segs = selectedDate === today ? daySegments : [];
        let totalSec = 0;
        for (const seg of segs) {
            if (seg.seg_start && seg.seg_end) {
                totalSec += (timeToMinutes(seg.seg_end) - timeToMinutes(seg.seg_start)) * 60;
            }
        }
        if (status === 'running' && currentSegStartTime) {
            const now = new Date();
            const parts = currentSegStartTime.split(':').map(Number);
            const startSec = parts[0] * 3600 + parts[1] * 60 + (parts[2] || 0);
            const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
            totalSec += Math.max(nowSec - startSec, 0);
        }
        return totalSec;
    }, [daySegments, status, currentSegStartTime, selectedDate]);

    function formatElapsed(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    useEffect(() => {
        if (status === 'running') {
            intervalRef.current = setInterval(() => {
                setTimerText(formatElapsed(getElapsedSeconds()));
            }, 1000);
            setTimerText(formatElapsed(getElapsedSeconds()));
        } else {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (status !== 'idle') {
                setTimerText(formatElapsed(getElapsedSeconds()));
            }
        }
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [status, getElapsedSeconds]);

    // ---- Keyboard shortcuts ----
    useEffect(() => {
        function handleKeyDown(e) {
            // Skip if modal is open or user is typing in an input
            if (editModal || confirmModal) return;
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

            const key = e.key.toLowerCase();

            switch (key) {
                case ' ': // Space — Start / Resume (prevent page scroll)
                    e.preventDefault();
                // fallthrough
                case 's': // Start / Resume
                    if (status === 'idle' || status === 'stopped') handleLogOn();
                    else if (status === 'paused') handleResume();
                    break;
                case 'p': // Pause
                    if (status === 'running') handlePause();
                    break;
                case 'x': // Stop
                    if (status === 'running' || status === 'paused') handleStop();
                    break;
                case 't': // Toggle time format
                    toggleFormat();
                    break;
                case 'arrowleft': // Previous week
                    prevWeek();
                    break;
                case 'arrowright': // Next week
                    nextWeek();
                    break;
                default:
                    // Number keys 1-7 for day selection
                    if (key >= '1' && key <= '7') {
                        const dayIndex = parseInt(key) - 1;
                        selectDay(addDays(selectedWeekMonday, dayIndex));
                    }
                    break;
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }); // Re-attach on every render to capture latest state

    // ---- Actions ----
    async function handleLogOn() {
        const today = todayStr();
        const now = nowTimeStr();
        const result = await apiPost({ date: today, seg_start: now });
        setStatus('running');
        setCurrentSegStartTime(now + ':' + String(new Date().getSeconds()).padStart(2, '0'));
        setSelectedDate(today);
        setSelectedWeekMonday(getMondayOfWeek(today));
        await Promise.all([loadDayData(today), loadWeekData(getMondayOfWeek(today))]);
    }

    async function handlePause() {
        const today = todayStr();
        const now = nowTimeStr();
        // Find the open segment (no end) and close it
        const openSeg = daySegments.find(s => !s.seg_end);
        if (openSeg) {
            await apiPut({ id: openSeg.id, seg_end: now });
        }
        setStatus('paused');
        setCurrentSegStartTime(null);
        await Promise.all([loadDayData(today), loadWeekData(selectedWeekMonday)]);
    }

    async function handleResume() {
        const today = todayStr();
        const now = nowTimeStr();
        await apiPost({ date: today, seg_start: now });
        setStatus('running');
        setCurrentSegStartTime(now + ':' + String(new Date().getSeconds()).padStart(2, '0'));
        await Promise.all([loadDayData(today), loadWeekData(selectedWeekMonday)]);
    }

    async function handleStop() {
        const today = todayStr();
        const now = nowTimeStr();
        const openSeg = daySegments.find(s => !s.seg_end);
        if (openSeg) {
            await apiPut({ id: openSeg.id, seg_end: now });
        }
        setStatus('stopped');
        setCurrentSegStartTime(null);
        await Promise.all([loadDayData(today), loadWeekData(selectedWeekMonday)]);
    }

    async function handleClearWeek() {
        await apiDelete(selectedWeekMonday);
        const today = todayStr();
        if (selectedWeekMonday === getMondayOfWeek(today)) {
            setStatus('idle');
            setCurrentSegStartTime(null);
            setTimerText('00:00:00');
        }
        setConfirmModal(false);
        await Promise.all([loadDayData(selectedDate), loadWeekData(selectedWeekMonday)]);
    }

    // ---- Day / Week navigation ----
    async function selectDay(dateStr) {
        setSelectedDate(dateStr);
        await loadDayData(dateStr);
    }

    async function prevWeek() {
        const newMonday = addDays(selectedWeekMonday, -7);
        setSelectedWeekMonday(newMonday);
        setSelectedDate(newMonday);
        await Promise.all([loadDayData(newMonday), loadWeekData(newMonday)]);
    }

    async function nextWeek() {
        const newMonday = addDays(selectedWeekMonday, 7);
        setSelectedWeekMonday(newMonday);
        setSelectedDate(newMonday);
        await Promise.all([loadDayData(newMonday), loadWeekData(newMonday)]);
    }

    // ---- Time format toggle ----
    function toggleFormat() {
        const newVal = !use12h;
        setUse12h(newVal);
        try { localStorage.setItem('timetracker_format', newVal ? '12h' : '24h'); } catch { }
    }

    // ---- Edit modal ----
    function openEdit(label, rawValue, segId, field) {
        setEditModal({ label, segId, field });
        setEditValue(displayTime(rawValue, use12h));
        setEditError(false);
        setTimeout(() => editInputRef.current?.select(), 50);
    }

    async function saveEdit() {
        const parsed = parseTimeInput(editValue);
        if (!parsed) {
            setEditError(true);
            setTimeout(() => setEditError(false), 800);
            return;
        }
        const { segId, field } = editModal;
        await apiPut({ id: segId, [field]: parsed });
        setEditModal(null);
        await Promise.all([loadDayData(selectedDate), loadWeekData(selectedWeekMonday)]);
    }

    // ---- Derived data ----
    const today = todayStr();
    const isToday = selectedDate === today;
    const dayMins = calcDayMinutes(daySegments);
    const breaks = calcBreaks(daySegments);
    const startTime = daySegments.length > 0 ? daySegments[0].seg_start : null;
    const allClosed = daySegments.length > 0 && daySegments.every(s => s.seg_end);
    const endTime = allClosed ? daySegments[daySegments.length - 1].seg_end : null;

    // Week data grouped by day
    const weekByDay = {};
    for (const seg of weekSegments) {
        if (!weekByDay[seg.date]) weekByDay[seg.date] = [];
        weekByDay[seg.date].push(seg);
    }
    let weekTotalMins = 0;
    let daysWorkedCount = 0;
    for (let i = 0; i < 7; i++) {
        const d = addDays(selectedWeekMonday, i);
        const segs = weekByDay[d];
        if (segs && segs.length > 0) {
            weekTotalMins += calcDayMinutes(segs);
            daysWorkedCount++;
        }
    }

    const statusTextMap = { idle: 'Idle', running: 'Running', paused: 'Paused', stopped: 'Stopped' };
    const subTextMap = { idle: 'Ready to start', running: 'Timer is running…', paused: 'Timer paused — on break', stopped: 'Day complete' };

    if (loading) {
        return (
            <div className="app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    <div className="timer-display" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Loading...</div>
                </div>
            </div>
        );
    }

    return (
        <div className="app">
            {/* Header */}
            <header className="app-header">
                <div className="logo">
                    <svg className="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                    </svg>
                    <h1>TimeTracker</h1>
                </div>
                <div className="header-right">
                    <div className={`time-format-toggle ${use12h ? 'is-12h' : ''}`} onClick={toggleFormat} title="Switch time format">
                        <span className={`format-label ${!use12h ? 'active' : ''}`}>24h</span>
                        <div className="toggle-track"><div className="toggle-thumb" /></div>
                        <span className={`format-label ${use12h ? 'active' : ''}`}>12h</span>
                    </div>
                    <div className="header-date">{formatDateHeader(today)}</div>
                </div>
            </header>

            <main className="main-layout">
                {/* Left: Timer + Log */}
                <section className="timer-section">
                    <div className={`card timer-card ${status === 'running' ? 'active' : ''}`}>
                        <div className={`status-badge ${status}`}>
                            <span className="status-dot" />
                            <span className="status-text">{statusTextMap[status]}</span>
                        </div>
                        <div className="timer-display">{timerText}</div>
                        <div className="timer-sub">{subTextMap[status]}</div>
                        <div className="timer-controls">
                            {(status === 'idle' || status === 'stopped') && (
                                <button className="btn btn-primary" onClick={handleLogOn}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                                    Start
                                </button>
                            )}
                            {status === 'running' && (
                                <>
                                    <button className="btn btn-warning" onClick={handlePause}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
                                        Pause
                                    </button>
                                    <button className="btn btn-danger" onClick={handleStop}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>
                                        Stop
                                    </button>
                                </>
                            )}
                            {status === 'paused' && (
                                <>
                                    <button className="btn btn-primary" onClick={handleResume}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                                        Resume
                                    </button>
                                    <button className="btn btn-danger" onClick={handleStop}>
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>
                                        Stop
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Daily Log */}
                    <div className="card log-card">
                        <div className="card-header">
                            <h2>{isToday ? "Today's Log" : formatDateHeader(selectedDate)}</h2>
                            <span className="cumulative-badge">{minutesToHM(dayMins)}</span>
                        </div>
                        <div className="log-content">
                            {daySegments.length === 0 ? (
                                <div className="log-empty">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="empty-icon">
                                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                                    </svg>
                                    <p>No time logged yet</p>
                                </div>
                            ) : (
                                <div>
                                    {/* Start time */}
                                    <div className="log-row log-start">
                                        <span className="log-label">Started</span>
                                        <span className="log-value editable" onClick={() => openEdit('Edit Start Time', startTime, daySegments[0].id, 'seg_start')}>
                                            {displayTime(startTime, use12h)}
                                        </span>
                                    </div>

                                    {/* Breaks */}
                                    {breaks.map((brk, i) => (
                                        <div key={i} className="break-row">
                                            <span className="break-label">Break {i + 1}</span>
                                            <span className="break-times">
                                                <span className="editable" onClick={() => openEdit(`Edit Break ${i + 1} Start`, brk.start, daySegments[i].id, 'seg_end')}>
                                                    {displayTime(brk.start, use12h)}
                                                </span>
                                                <span>→</span>
                                                <span className="editable" onClick={() => openEdit(`Edit Break ${i + 1} End`, brk.end, daySegments[i + 1].id, 'seg_start')}>
                                                    {displayTime(brk.end, use12h)}
                                                </span>
                                                <span className="break-duration">{minutesToHM(brk.duration)}</span>
                                            </span>
                                        </div>
                                    ))}

                                    {/* End time */}
                                    {endTime && (
                                        <div className="log-row log-end">
                                            <span className="log-label">Ended</span>
                                            <span className="log-value editable" onClick={() => openEdit('Edit End Time', endTime, daySegments[daySegments.length - 1].id, 'seg_end')}>
                                                {displayTime(endTime, use12h)}
                                            </span>
                                        </div>
                                    )}

                                    <div className="log-divider" />
                                    <div className="log-row log-total">
                                        <span className="log-label">Total Worked</span>
                                        <span className="log-value">{minutesToHM(dayMins)}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </section>

                {/* Right: Week Panel */}
                <aside className="week-section">
                    <div className="card week-card">
                        <div className="card-header">
                            <h2>Week View</h2>
                            <div className="week-nav">
                                <button className="btn-icon" onClick={prevWeek} title="Previous week">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                                </button>
                                <span className="week-label">{formatWeekRange(selectedWeekMonday)}</span>
                                <button className="btn-icon" onClick={nextWeek} title="Next week">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                                </button>
                            </div>
                        </div>

                        <div className="day-pills">
                            {FULL_DAY_NAMES.map((name, i) => {
                                const dateStr = addDays(selectedWeekMonday, i);
                                const segs = weekByDay[dateStr];
                                const hasData = segs && segs.length > 0;
                                const mins = hasData ? calcDayMinutes(segs) : 0;
                                const isActive = dateStr === selectedDate;
                                const isTodayPill = dateStr === today;
                                return (
                                    <div key={i} className={`day-pill${isActive ? ' active' : ''}${isTodayPill ? ' today' : ''}${hasData ? ' has-data' : ''}`} onClick={() => selectDay(dateStr)}>
                                        <span className="day-pill-name">{name}</span>
                                        <span className="day-pill-hours">{hasData ? minutesToHM(mins) : '—'}</span>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="week-summary">
                            <div className="summary-item">
                                <span className="summary-label">Weekly Total</span>
                                <span className="summary-value">{minutesToHM(weekTotalMins)}</span>
                            </div>
                            <div className="summary-item">
                                <span className="summary-label">Days Worked</span>
                                <span className="summary-value">{daysWorkedCount}</span>
                            </div>
                        </div>

                        <button className="btn btn-outline-danger btn-full" onClick={() => setConfirmModal(true)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                            Clear This Week
                        </button>
                    </div>
                </aside>
            </main>

            {/* Edit Modal */}
            {editModal && (
                <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setEditModal(null); }}>
                    <div className="modal">
                        <div className="modal-header">
                            <h3>Edit Time</h3>
                            <button className="btn-icon" onClick={() => setEditModal(null)}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        </div>
                        <div className="modal-body">
                            <label className="modal-label">{editModal.label}</label>
                            <input
                                ref={editInputRef}
                                type="text"
                                className={`modal-input ${editError ? 'error' : ''}`}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditModal(null); }}
                                placeholder={use12h ? 'h:mm AM/PM' : 'HH:MM'}
                                autoComplete="off"
                            />
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-ghost" onClick={() => setEditModal(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={saveEdit}>Save</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm Modal */}
            {confirmModal && (
                <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setConfirmModal(false); }}>
                    <div className="modal">
                        <div className="modal-header">
                            <h3>Clear Week</h3>
                            <button className="btn-icon" onClick={() => setConfirmModal(false)}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        </div>
                        <div className="modal-body">
                            <p>Are you sure you want to clear all data for this week? This cannot be undone.</p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-ghost" onClick={() => setConfirmModal(false)}>Cancel</button>
                            <button className="btn btn-danger" onClick={handleClearWeek}>Clear Week</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
