/* ========================================
   Time Tracker — Application Logic
   ======================================== */

(() => {
  'use strict';

  // ---- Constants ----
  const STORAGE_KEY = 'timetracker_data';
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const FULL_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // ---- State ----
  let state = {
    status: 'idle', // idle | running | paused | stopped
    currentSegmentStart: null, // ISO timestamp when current segment started
    timerInterval: null,
    selectedDate: todayStr(),
    selectedWeekMonday: getMondayOfWeek(todayStr()),
  };

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);
  const timerDisplay = $('timerDisplay');
  const timerSub = $('timerSub');
  const statusBadge = $('statusBadge');
  const timerCard = document.querySelector('.timer-card');
  const btnLogOn = $('btnLogOn');
  const btnPause = $('btnPause');
  const btnResume = $('btnResume');
  const btnStop = $('btnStop');
  const logEmpty = $('logEmpty');
  const logEntries = $('logEntries');
  const logStartTime = $('logStartTime');
  const logEndTime = $('logEndTime');
  const logEndRow = $('logEndRow');
  const logTotal = $('logTotal');
  const logTitle = $('logTitle');
  const cumulativeBadge = $('cumulativeBadge');
  const breaksContainer = $('breaksContainer');
  const dayPills = $('dayPills');
  const weekLabel = $('weekLabel');
  const weeklyTotal = $('weeklyTotal');
  const daysWorked = $('daysWorked');
  const headerDate = $('headerDate');

  // Modal refs
  const editModal = $('editModal');
  const modalLabel = $('modalLabel');
  const modalTimeInput = $('modalTimeInput');
  const modalSave = $('modalSave');
  const modalCancel = $('modalCancel');
  const modalClose = $('modalClose');

  const confirmModal = $('confirmModal');
  const confirmYes = $('confirmYes');
  const confirmCancel = $('confirmCancel');
  const confirmClose = $('confirmClose');

  let editContext = null; // { date, type, index, subfield }

  // ---- Utility Functions ----

  function todayStr() {
    const d = new Date();
    return isoDate(d);
  }

  function isoDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getMondayOfWeek(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay(); // 0=Sun, 1=Mon, ...
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
    const mStr = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const sStr = sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${mStr} – ${sStr}`;
  }

  // ---- Data Persistence ----

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function getDayData(dateStr) {
    const data = loadData();
    return data[dateStr] || null;
  }

  function setDayData(dateStr, dayData) {
    const data = loadData();
    data[dateStr] = dayData;
    saveData(data);
  }

  function deleteDayData(dateStr) {
    const data = loadData();
    delete data[dateStr];
    saveData(data);
  }

  // ---- Cumulative Calculation ----

  function calcDayMinutes(day) {
    if (!day || !day.segments || day.segments.length === 0) return 0;
    let total = 0;
    for (const seg of day.segments) {
      if (seg.start && seg.end) {
        total += timeToMinutes(seg.end) - timeToMinutes(seg.start);
      }
    }
    return Math.max(total, 0);
  }

  function calcBreaks(day) {
    if (!day || !day.segments || day.segments.length < 2) return [];
    const breaks = [];
    for (let i = 1; i < day.segments.length; i++) {
      const prevEnd = day.segments[i - 1].end;
      const currStart = day.segments[i].start;
      if (prevEnd && currStart) {
        const dur = timeToMinutes(currStart) - timeToMinutes(prevEnd);
        breaks.push({ start: prevEnd, end: currStart, duration: dur });
      }
    }
    return breaks;
  }

  // ---- Timer Engine ----

  function getElapsedSeconds() {
    const today = todayStr();
    const day = getDayData(today);
    let totalSec = 0;

    if (day && day.segments) {
      for (const seg of day.segments) {
        if (seg.start && seg.end) {
          totalSec += (timeToMinutes(seg.end) - timeToMinutes(seg.start)) * 60;
        }
      }
    }

    // Add currently running segment
    if (state.status === 'running' && state.currentSegmentStart) {
      const now = new Date();
      const startParts = state.currentSegmentStart.split(':').map(Number);
      const startSec = startParts[0] * 3600 + startParts[1] * 60 + (startParts[2] || 0);
      const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      totalSec += Math.max(nowSec - startSec, 0);
    }

    return totalSec;
  }

  function formatElapsed(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function startTimerTick() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      const secs = getElapsedSeconds();
      timerDisplay.textContent = formatElapsed(secs);
    }, 1000);
    // immediate tick
    timerDisplay.textContent = formatElapsed(getElapsedSeconds());
  }

  function stopTimerTick() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  // ---- State Transitions ----

  function doLogOn() {
    const today = todayStr();
    let day = getDayData(today);
    const now = nowTimeStr();

    if (!day) {
      day = { startTime: now, endTime: null, segments: [] };
    }

    // Start new segment
    day.segments.push({ start: now, end: null });
    day.startTime = day.startTime || now;
    day.endTime = null;
    setDayData(today, day);

    state.status = 'running';
    state.currentSegmentStart = now + ':' + String(new Date().getSeconds()).padStart(2, '0');

    updateUI();
    startTimerTick();
  }

  function doPause() {
    const today = todayStr();
    const day = getDayData(today);
    if (!day) return;

    const now = nowTimeStr();
    // Close current open segment
    const openSeg = day.segments.find(s => s.start && !s.end);
    if (openSeg) openSeg.end = now;

    setDayData(today, day);
    state.status = 'paused';
    state.currentSegmentStart = null;

    stopTimerTick();
    // show final elapsed
    timerDisplay.textContent = formatElapsed(getElapsedSeconds());
    updateUI();
  }

  function doResume() {
    const today = todayStr();
    let day = getDayData(today);
    if (!day) return;

    const now = nowTimeStr();
    day.segments.push({ start: now, end: null });
    setDayData(today, day);

    state.status = 'running';
    state.currentSegmentStart = now + ':' + String(new Date().getSeconds()).padStart(2, '0');

    updateUI();
    startTimerTick();
  }

  function doStop() {
    const today = todayStr();
    const day = getDayData(today);
    if (!day) return;

    const now = nowTimeStr();
    // Close current open segment
    const openSeg = day.segments.find(s => s.start && !s.end);
    if (openSeg) openSeg.end = now;

    day.endTime = now;
    setDayData(today, day);

    state.status = 'stopped';
    state.currentSegmentStart = null;

    stopTimerTick();
    timerDisplay.textContent = formatElapsed(getElapsedSeconds());
    updateUI();
  }

  // ---- UI Update ----

  function updateUI() {
    updateStatus();
    updateButtons();
    updateDailyLog();
    updateWeekPanel();
    updateHeader();
  }

  function updateStatus() {
    statusBadge.className = 'status-badge ' + state.status;
    const textMap = { idle: 'Idle', running: 'Running', paused: 'Paused', stopped: 'Stopped' };
    statusBadge.querySelector('.status-text').textContent = textMap[state.status];

    if (state.status === 'running') {
      timerCard.classList.add('active');
      timerSub.textContent = 'Timer is running…';
    } else if (state.status === 'paused') {
      timerCard.classList.remove('active');
      timerSub.textContent = 'Timer paused — on break';
    } else if (state.status === 'stopped') {
      timerCard.classList.remove('active');
      timerSub.textContent = 'Day complete';
    } else {
      timerCard.classList.remove('active');
      timerSub.textContent = 'Ready to start';
    }
  }

  function updateButtons() {
    btnLogOn.classList.add('hidden');
    btnPause.classList.add('hidden');
    btnResume.classList.add('hidden');
    btnStop.classList.add('hidden');

    switch (state.status) {
      case 'idle':
        btnLogOn.classList.remove('hidden');
        break;
      case 'running':
        btnPause.classList.remove('hidden');
        btnStop.classList.remove('hidden');
        break;
      case 'paused':
        btnResume.classList.remove('hidden');
        btnStop.classList.remove('hidden');
        break;
      case 'stopped':
        // Can log on again for a new session if needed
        btnLogOn.classList.remove('hidden');
        break;
    }
  }

  function updateDailyLog() {
    const dateStr = state.selectedDate;
    const day = getDayData(dateStr);
    const isToday = dateStr === todayStr();

    logTitle.textContent = isToday ? "Today's Log" : formatDateHeader(dateStr);

    if (!day || !day.segments || day.segments.length === 0) {
      logEmpty.classList.remove('hidden');
      logEntries.classList.add('hidden');
      cumulativeBadge.textContent = '0h 0m';
      return;
    }

    logEmpty.classList.add('hidden');
    logEntries.classList.remove('hidden');

    // Start time
    logStartTime.textContent = day.startTime || '—';
    logStartTime.dataset.field = 'startTime';
    logStartTime.dataset.date = dateStr;

    // End time
    if (day.endTime) {
      logEndRow.classList.remove('hidden');
      logEndTime.textContent = day.endTime;
      logEndTime.dataset.field = 'endTime';
      logEndTime.dataset.date = dateStr;
    } else {
      logEndRow.classList.add('hidden');
    }

    // Breaks
    breaksContainer.innerHTML = '';
    const breaks = calcBreaks(day);
    breaks.forEach((brk, i) => {
      const row = document.createElement('div');
      row.className = 'break-row';
      row.innerHTML = `
        <span class="break-label">Break ${i + 1}</span>
        <span class="break-times">
          <span class="editable" data-date="${dateStr}" data-field="breakStart" data-index="${i}">${brk.start}</span>
          <span>→</span>
          <span class="editable" data-date="${dateStr}" data-field="breakEnd" data-index="${i}">${brk.end}</span>
          <span class="break-duration">${minutesToHM(brk.duration)}</span>
        </span>
      `;
      breaksContainer.appendChild(row);
    });

    // Also show work segments for clarity
    // (segments between breaks are implicit from start/breaks/end)

    // Total
    const totalMins = calcDayMinutes(day);
    logTotal.textContent = minutesToHM(totalMins);
    cumulativeBadge.textContent = minutesToHM(totalMins);
  }

  function updateWeekPanel() {
    const monday = state.selectedWeekMonday;
    weekLabel.textContent = formatWeekRange(monday);

    dayPills.innerHTML = '';
    let weekTotalMins = 0;
    let worked = 0;

    for (let i = 0; i < 7; i++) {
      const dateStr = addDays(monday, i);
      const day = getDayData(dateStr);
      const mins = day ? calcDayMinutes(day) : 0;
      const isToday = dateStr === todayStr();
      const isSelected = dateStr === state.selectedDate;
      const hasData = day && day.segments && day.segments.length > 0;

      if (hasData) {
        weekTotalMins += mins;
        worked++;
      }

      // If today and running, add live elapsed
      if (isToday && state.status === 'running') {
        // We'll just show the saved + running via calcDayMinutes approach
        // but calcDayMinutes only counts closed segments, so let's add running time
        const secs = getElapsedSeconds();
        const liveMins = Math.floor(secs / 60);
        // Subtract the closed-segment minutes to avoid double counting
        const closedMins = day ? calcDayMinutes(day) : 0;
        weekTotalMins += (liveMins - closedMins);
      }

      const pill = document.createElement('div');
      pill.className = 'day-pill' + (isSelected ? ' active' : '') + (isToday ? ' today' : '') + (hasData ? ' has-data' : '');
      pill.innerHTML = `
        <span class="day-pill-name">${FULL_DAY_NAMES[i]}</span>
        <span class="day-pill-hours">${hasData ? minutesToHM(mins) : '—'}</span>
      `;
      pill.addEventListener('click', () => {
        state.selectedDate = dateStr;
        updateDailyLog();
        updateWeekPanel();
      });
      dayPills.appendChild(pill);
    }

    weeklyTotal.textContent = minutesToHM(weekTotalMins);
    daysWorked.textContent = worked;
  }

  function updateHeader() {
    headerDate.textContent = formatDateHeader(todayStr());
  }

  // ---- Editing ----

  function openEditModal(label, currentValue, context) {
    editContext = context;
    modalLabel.textContent = label;
    modalTimeInput.value = currentValue || '';
    editModal.classList.remove('hidden');
    modalTimeInput.focus();
  }

  function closeEditModal() {
    editModal.classList.add('hidden');
    editContext = null;
  }

  function saveEdit() {
    if (!editContext) return;
    const newValue = modalTimeInput.value;
    if (!newValue) { closeEditModal(); return; }

    const { date, field, index } = editContext;
    const day = getDayData(date);
    if (!day) { closeEditModal(); return; }

    if (field === 'startTime') {
      day.startTime = newValue;
      // Also update the first segment start
      if (day.segments.length > 0) {
        day.segments[0].start = newValue;
      }
    } else if (field === 'endTime') {
      day.endTime = newValue;
      // Also update the last segment end
      if (day.segments.length > 0) {
        day.segments[day.segments.length - 1].end = newValue;
      }
    } else if (field === 'breakStart') {
      // breakStart at index i means the end of segment i and start of break
      // The break starts at segments[index].end => we update segments[index].end? No...
      // Break i is the gap between segment[i] end and segment[i+1] start
      // breakStart edits segment[i].end
      // Wait, actually breakStart = segment[i].end (prev segment end)
      // but the user sees it as when the break started.
      // Editing breakStart means changing when segment i ended (which is when break started)
      if (index < day.segments.length) {
        day.segments[index].end = newValue;
      }
    } else if (field === 'breakEnd') {
      // breakEnd at index i = segment[i+1].start
      if (index + 1 < day.segments.length) {
        day.segments[index + 1].start = newValue;
      }
    }

    setDayData(date, day);
    closeEditModal();

    // If editing today and timer is still relevant, recalc
    if (date === todayStr() && (state.status === 'running')) {
      timerDisplay.textContent = formatElapsed(getElapsedSeconds());
    }

    updateUI();
  }

  // ---- Clear Week ----

  function openConfirmModal() {
    confirmModal.classList.remove('hidden');
  }

  function closeConfirmModal() {
    confirmModal.classList.add('hidden');
  }

  function clearWeek() {
    const monday = state.selectedWeekMonday;
    for (let i = 0; i < 7; i++) {
      const dateStr = addDays(monday, i);
      deleteDayData(dateStr);
    }

    // If clearing current week and timer was running, reset state
    const today = todayStr();
    const currentMonday = getMondayOfWeek(today);
    if (monday === currentMonday) {
      stopTimerTick();
      state.status = 'idle';
      state.currentSegmentStart = null;
      timerDisplay.textContent = '00:00:00';
    }

    closeConfirmModal();
    updateUI();
  }

  // ---- Event Listeners ----

  btnLogOn.addEventListener('click', () => {
    // If stopped, treat as starting fresh new session (add to existing day)
    if (state.status === 'stopped') {
      state.status = 'idle'; // reset so doLogOn works normally
    }
    doLogOn();
  });

  btnPause.addEventListener('click', doPause);
  btnResume.addEventListener('click', doResume);
  btnStop.addEventListener('click', doStop);

  // Week navigation
  $('btnPrevWeek').addEventListener('click', () => {
    state.selectedWeekMonday = addDays(state.selectedWeekMonday, -7);
    // Select the Monday of that week
    state.selectedDate = state.selectedWeekMonday;
    updateUI();
  });

  $('btnNextWeek').addEventListener('click', () => {
    state.selectedWeekMonday = addDays(state.selectedWeekMonday, 7);
    state.selectedDate = state.selectedWeekMonday;
    updateUI();
  });

  // Clear week
  $('btnClearWeek').addEventListener('click', openConfirmModal);
  confirmYes.addEventListener('click', clearWeek);
  confirmCancel.addEventListener('click', closeConfirmModal);
  confirmClose.addEventListener('click', closeConfirmModal);

  // Edit modal
  modalSave.addEventListener('click', saveEdit);
  modalCancel.addEventListener('click', closeEditModal);
  modalClose.addEventListener('click', closeEditModal);

  // Handle enter in modal
  modalTimeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') closeEditModal();
  });

  // Close modals on overlay click
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) closeEditModal();
  });
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) closeConfirmModal();
  });

  // Editable time clicks (delegated)
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.editable');
    if (!el) return;

    const field = el.dataset.field;
    const date = el.dataset.date || state.selectedDate;
    const index = el.dataset.index !== undefined ? parseInt(el.dataset.index) : null;

    let label = 'Edit Time';
    if (field === 'startTime') label = 'Edit Start Time';
    else if (field === 'endTime') label = 'Edit End Time';
    else if (field === 'breakStart') label = `Edit Break ${index + 1} Start`;
    else if (field === 'breakEnd') label = `Edit Break ${index + 1} End`;

    openEditModal(label, el.textContent.trim(), { date, field, index });
  });

  // ---- Restore State on Load ----

  function restoreState() {
    const today = todayStr();
    const day = getDayData(today);

    if (day && day.segments && day.segments.length > 0) {
      const lastSeg = day.segments[day.segments.length - 1];

      if (!lastSeg.end) {
        // Was running when page closed — resume
        state.status = 'running';
        state.currentSegmentStart = lastSeg.start + ':00';
        startTimerTick();
      } else if (day.endTime) {
        state.status = 'stopped';
        timerDisplay.textContent = formatElapsed(calcDayMinutes(day) * 60);
      } else {
        // Segments exist, last is closed, but no endTime → was paused
        state.status = 'paused';
        timerDisplay.textContent = formatElapsed(calcDayMinutes(day) * 60);
      }
    }

    state.selectedDate = today;
    state.selectedWeekMonday = getMondayOfWeek(today);
    updateUI();
  }

  // ---- Init ----
  restoreState();

})();
