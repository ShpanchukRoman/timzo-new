function startApp() {
    initApp().catch((error) => {
        console.error('Initialization error');
        showBannerMessage('Не вдалося завантажити графік. Перевірте з’єднання та оновіть сторінку.');
        document.querySelectorAll('#add-employee-btn, #clear-schedule, .day-limit-input').forEach(el => { el.disabled = true; });
    });
}

let scheduleLoaded = false;
let cachedDayTotals = new Array(7).fill(0);
let cachedDayLimits = new Array(7).fill(0);
let currentWeekDates = [];
let currentTimelineDayIndex = null;
let lastEditedDayIndex = null;
let timelineSelectedDate = null;
let isShareView = false;
let shareBannerTimer = null;
let lastGeneratedShareUrl = '';
let lastShareEmployeeCount = 0;
let pendingSaveTimer = null;
let lastLoadedScheduleSnapshot = null;
let deletedEmployeeIds = new Set();
let statsCache = null;
let statsRefreshTimer = null;
let lastStatsWeekValue = '';
let employeeChartRange = 7;
let lastChartEmployeeId = '';
let lastChartRange = 7;

const DAY_NAMES = ['Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота', 'Неділя'];
const MONTH_NAMES = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
async function initApp() {
    setCurrentWeek();
    setupEventListeners();
    setupMobileSchedule();
    setupWeekDateFallback();
    applyCurrentWeekSelection();
    syncShareWeekInput();
    const shareApplied = await loadScheduleFromShareToken();
    const hashApplied = !shareApplied && loadScheduleFromShareHash();

    if (!shareApplied && !hashApplied) {
        await loadSavedData();
    }

    updateWeekDates();
    calculateAllHours();
    syncShareWeekInput();
    await refreshStats();

    if (shareApplied || hashApplied) {
        applyShareViewMode();
    }
}

// Збереження даних
function saveData() {
    if (!scheduleLoaded) return;
    if (isShareView) {
        return;
    }
    if (pendingSaveTimer) {
        clearTimeout(pendingSaveTimer);
    }
    pendingSaveTimer = setTimeout(() => {
        persistSchedule().catch((error) => {
            console.warn('Schedule save failed', error);
            const message = error && error.message
                ? `Не вдалося зберегти: ${error.message}`
                : 'Не вдалося зберегти зміни. Перевірте підключення.';
            showBannerMessage(message);
        });
    }, 300);
}

async function persistSchedule() {
    if (!scheduleLoaded && !isShareView) throw new Error('Дочекайтеся завантаження графіка.');
    if (isShareView) {
        return;
    }
    const weekInput = document.getElementById('week');
    const weekValue = weekInput ? weekInput.value : '';
    if (!weekValue) {
        return;
    }

    const payload = buildScheduleSnapshot();
    payload.week = weekValue;
    payload.deletedEmployees = Array.from(deletedEmployeeIds);

    const response = await fetch('/api/schedule', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        let message = `Save failed: ${response.status}`;
        try {
            const errorData = await response.json();
            if (errorData && errorData.error) {
                message = errorData.error;
                if (errorData.details) {
                    message += ` (${errorData.details})`;
                }
            }
        } catch (error) {
            // Ignore parse errors and keep default message.
        }
        throw new Error(message);
    }

    const data = await response.json();
    lastLoadedScheduleSnapshot = data;

    if (Array.isArray(data.employees)) {
        syncEmployeeIdsFromServer(data.employees);
    }
    deletedEmployeeIds.clear();
    scheduleStatsRefresh();
}

function syncEmployeeIdsFromServer(employees) {
    const rows = Array.from(document.querySelectorAll('.employee-row'));
    employees.forEach((employee) => {
        if (!employee) return;
        let row = null;
        if (employee.clientId) {
            row = rows.find(item => item.dataset.clientId === employee.clientId);
        }
        if (!row && typeof employee.index === 'number') {
            row = rows[employee.index] || null;
        }
        if (!row) return;
        if (employee.id) {
            row.dataset.employeeId = employee.id;
        }
        if (employee.clientId) {
            row.dataset.clientId = employee.clientId;
        }
    });
}

function generateClientId() {
    return `client-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

async function loadSavedData() {
    scheduleLoaded = false;
    document.querySelectorAll('#add-employee-btn, #clear-schedule, #share-trigger, .day-limit-input').forEach(el => { el.disabled = true; });
    if (pendingSaveTimer) { clearTimeout(pendingSaveTimer); pendingSaveTimer = null; }
    const weekInput = document.getElementById('week');
    const weekValue = weekInput ? weekInput.value : ensureWeekValue();
    if (!weekValue) {
        addExampleEmployees();
        return;
    }

    const response = await fetch(`/api/schedule?week=${encodeURIComponent(weekValue)}`, {
        credentials: 'include'
    });
    if (!response.ok) {
        throw new Error('Schedule loading failed');
    }

    const data = await response.json();
    lastLoadedScheduleSnapshot = data;
    scheduleLoaded = true;
    document.querySelectorAll('#add-employee-btn, #clear-schedule, #share-trigger, .day-limit-input').forEach(el => { el.disabled = false; });

    if (weekInput && data.week) {
        weekInput.value = data.week;
    }

    if (data.limits) {
        setLimitsData(data.limits);
    }

    if (data.employees && data.employees.length > 0) {
        renderEmployeesFromSnapshot(data.employees, { skipSave: true });
        deletedEmployeeIds.clear();
        return;
    }

    addExampleEmployees();
}

function renderEmployeesFromSnapshot(employees, options = {}) {
    const container = document.getElementById('employees-container');
    if (!container) return;
    container.innerHTML = '';
    if (!Array.isArray(employees) || employees.length === 0) {
        calculateAllHours();
        return;
    }

    const fragment = document.createDocumentFragment();
    const sortedEmployees = [...employees].sort((a, b) => {
        const aIndex = Number.isFinite(a?.sortIndex) ? a.sortIndex : 0;
        const bIndex = Number.isFinite(b?.sortIndex) ? b.sortIndex : 0;
        return aIndex - bIndex;
    });

    sortedEmployees.forEach((emp, index) => {
        addEmployee(
            emp.name || 'Працівник',
            emp.schedule || [],
            false,
            emp.position || '',
            Object.assign({}, options, {
                container: fragment,
                deferMetrics: true,
                employeeId: emp.id || null,
                clientId: emp.clientId || emp.id || null,
                index
            })
        );
    });
    container.appendChild(fragment);
    calculateAllHours();
    populateEmployeeDetailSelect();
    refreshStatsViews();
    updateMoveButtonsState();
    if (!options.skipSave) {
        saveData();
    }
}

function getEmployeesData() {
    const employees = [];
    document.querySelectorAll('.employee-row').forEach((row, index) => {
        const employeeId = row.dataset.employeeId || '';
        const clientId = row.dataset.clientId || employeeId || '';
        const rawName = row.querySelector('.employee-name').textContent || '';
        const name = rawName.trim() || 'Працівник';
        const rawPosition = row.querySelector('.employee-position') ? row.querySelector('.employee-position').textContent : '';
        const position = rawPosition.trim();
        const schedule = [];
        row.querySelectorAll('.day-cell').forEach(cell => {
            const primaryInput = cell.querySelector('.time-input[data-shift-type="primary"]');
            const secondaryInput = cell.querySelector('.time-input[data-shift-type="secondary"]');
            schedule.push({
                primary: primaryInput ? primaryInput.value : '',
                secondary: secondaryInput ? secondaryInput.value : '',
                locked: cell.classList.contains('is-locked')
            });
        });
        employees.push({
            id: employeeId || null,
            clientId: clientId || null,
            name,
            position,
            schedule,
            sortIndex: index
        });
    });
    return employees;
}

function getLimitsData() {
    const limits = [];
    document.querySelectorAll('.day-limit-input').forEach(input => {
        limits.push(input.value);
    });
    return limits;
}

function setLimitsData(limits) {
    document.querySelectorAll('.day-limit-input').forEach((input, index) => {
        input.value = limits[index] || input.value;
    });
    updateWeeklyLimitTotal();
    selectMobileDay(mobileDayIndex);
}

function clearAllEmployees() {
    document.getElementById('employees-container').innerHTML = '';
}

function setCurrentWeek() {
    const weekInput = document.getElementById('week');
    if (!weekInput) return;
    const ensured = ensureWeekValue();
    if (ensured) {
        localStorage.setItem('workScheduleWeek', ensured);
    }
}

function applyCurrentWeekSelection() {
    const weekInput = document.getElementById('week');
    if (!weekInput) return;
    const currentWeek = getCurrentWeekValue();
    if (!currentWeek) return;
    if (weekInput.value !== currentWeek) {
        weekInput.value = currentWeek;
    }
    localStorage.setItem('workScheduleWeek', currentWeek);
}

function setupWeekDateFallback() {
    const week = document.getElementById('week');
    const date = document.getElementById('week-date-fallback');
    if (!week || !date || week.type === 'week') return;
    week.classList.add('hidden');
    date.classList.remove('hidden');
    const label = document.querySelector('label[for="week"]');
    if (label) label.htmlFor = date.id;
    const today = new Date();
    date.value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    date.addEventListener('change', () => {
        if (!date.value) return;
        const [year, number] = getWeekNumber(new Date(date.value + 'T12:00:00'));
        week.value = `${year}-W${String(number).padStart(2, '0')}`;
        week.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function setupEventListeners() {
    const addBtn = document.getElementById('add-employee-btn');
    if (addBtn) {
        addBtn.addEventListener('click', addNewEmployee);
    }

    const clearBtn = document.getElementById('clear-schedule');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearSchedule);
    }

    const exportPdfBtn = document.getElementById('export-pdf');
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', exportToPDF);
    }

    const exportJpgBtn = document.getElementById('export-jpg');
    if (exportJpgBtn) {
        exportJpgBtn.addEventListener('click', exportToJPG);
    }
    
    const weekInput = document.getElementById('week');
    if (weekInput) {
        weekInput.addEventListener('change', function() {
            updateWeekDates();
            syncShareWeekInput();
            if (this.value) {
                localStorage.setItem('workScheduleWeek', this.value);
            }
            loadSavedData()
                .then(() => refreshStats())
                .catch((error) => {
                    showBannerMessage('Не вдалося завантажити тиждень. Оновіть сторінку перед редагуванням.');
                    document.querySelectorAll('#employees-container input, .day-limit-input, #add-employee-btn, #clear-schedule').forEach(el => { el.disabled = true; });
                });
        });
    }
    
    // Ліміти годин
    document.querySelectorAll('.day-limit-input').forEach(input => {
        input.addEventListener('change', function() {
            calculateUsedHours();
            updateWeeklyLimitTotal();
            saveData();
        });
    });

    const shareTrigger = document.getElementById('share-trigger');
    const sharePanel = document.getElementById('share-inline-panel');
    if (shareTrigger && sharePanel) {
        shareTrigger.addEventListener('click', function() {
            if (isShareView) {
                showBannerMessage('У режимі перегляду не можна відкривати панель поділитися.');
                return;
            }
            const wasHidden = sharePanel.classList.contains('hidden');
            sharePanel.classList.toggle('hidden');
            shareTrigger.setAttribute('aria-expanded', String(wasHidden));
        });
    }

    const shareForm = document.getElementById('share-form');
    if (shareForm) {
        shareForm.addEventListener('submit', handleShareSubmit);
    }

    const timelineToggle = document.getElementById('timeline-toggle');
    if (timelineToggle) {
        timelineToggle.addEventListener('click', toggleTimelineVisibility);
        const timelineContainer = document.querySelector('.timeline-container');
        const expanded = timelineContainer ? !timelineContainer.classList.contains('is-collapsed') : true;
        timelineToggle.setAttribute('aria-expanded', String(expanded));
    }

    const timelineDateInput = document.getElementById('timeline-date');
    if (timelineDateInput) {
        timelineDateInput.addEventListener('change', handleTimelineDateChange);
    }

    const monthPlanSaveBtn = document.getElementById('month-plan-save');
    if (monthPlanSaveBtn) {
        monthPlanSaveBtn.addEventListener('click', handleMonthPlanSave);
    }

    const employeePlanSaveBtn = document.getElementById('employee-plan-save');
    if (employeePlanSaveBtn) {
        employeePlanSaveBtn.addEventListener('click', handleEmployeePlanSave);
    }

    const employeeDetailSelect = document.getElementById('employee-detail-select');
    if (employeeDetailSelect) {
        employeeDetailSelect.addEventListener('change', renderEmployeeDetailStats);
    }

    document.querySelectorAll('.employee-chart-range').forEach(button => {
        button.addEventListener('click', () => {
            const rangeValue = parseInt(button.dataset.range, 10);
            if (!Number.isFinite(rangeValue)) return;
            setEmployeeChartRange(rangeValue);
        });
    });

    initStatsTabs();
}

function addExampleEmployees() {
    const container = document.getElementById('employees-container');
    if (container) container.innerHTML = '<div class="empty-state"><strong>Ваш тиждень починається тут</strong><p>Додайте працівника та заплануйте першу зміну.</p></div>';
}

function syncShareWeekInput() {
    const shareWeekInput = document.getElementById('share-week');
    const weekInput = document.getElementById('week');
    if (shareWeekInput && weekInput) {
        shareWeekInput.value = weekInput.value || '';
    }
}

function getShareTokenFromWindow() {
    if (typeof window === 'undefined') return '';
    return window.__SHARE_TOKEN__ || '';
}

async function loadScheduleFromShareToken() {
    const token = getShareTokenFromWindow();
    if (!token) return false;
    isShareView = true;
    applyShareViewMode();



    const response = await fetch(`/api/share-links/${encodeURIComponent(token)}`);
    if (!response.ok) {
        throw new Error('Invalid share link');
    }

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.employees)) {
        throw new Error('Invalid share payload');
    }
    const snapshot = sanitizeSnapshot({
        limits: payload.limits,
        employees: payload.employees
    });
    console.info('Share link payload', {
        week: payload.week,
        employees: snapshot.employees.length,
        limits: snapshot.limits.length
    });

    const weekInput = document.getElementById('week');
    if (weekInput && payload.week) {
        weekInput.value = payload.week;
        updateWeekDates();
        syncShareWeekInput();
    }

    isShareView = true;
    lastLoadedScheduleSnapshot = Object.assign({ week: payload.week }, snapshot);

    if (snapshot.limits) {
        setLimitsData(snapshot.limits);
    }

    if (snapshot.employees.length === 0) {
        showBannerMessage('Розклад порожній або працівників немає.');
    }
    const hasAnyShift = snapshot.employees.some(employee => {
        return Array.isArray(employee.schedule) && employee.schedule.some(slot => {
            return !!(slot && (slot.primary || slot.secondary));
        });
    });
    if (!hasAnyShift) {
        console.warn('Share link payload has no visible shifts', {
            week: payload.week,
            employees: snapshot.employees.length
        });
    }
    renderEmployeesFromSnapshot(snapshot.employees, { skipSave: true });
    updateWeekDates();
    showBannerMessage(`Розклад відкрито у режимі перегляду. Працівників: ${snapshot.employees.length}`);
    return true;
}

async function handleShareSubmit(event) {
    event.preventDefault();
    if (isShareView) {
        showBannerMessage('У режимі перегляду неможливо створити нове посилання.');
        return;
    }

    try {
        await persistSchedule();
    } catch (error) {
        console.warn('Schedule save before share failed', error);
        showBannerMessage('Не вдалося зберегти розклад. Спробуйте ще раз.');
        return;
    }

    const shareWeekInput = document.getElementById('share-week');
    const weekInput = document.getElementById('week');
    const targetWeek = weekInput ? weekInput.value : '';
    const resultEl = document.getElementById('share-result');

    if (!targetWeek) {
        if (resultEl) {
            resultEl.textContent = 'Оберіть тиждень для генерації посилання.';
            resultEl.classList.remove('hidden');
        }
        showBannerMessage('Оберіть тиждень перед генерацією посилання.');
        return;
    }
    if (shareWeekInput && shareWeekInput.value !== targetWeek) {
        shareWeekInput.value = targetWeek;
    }

    try {
        const response = await fetch('/api/share-links', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ week: targetWeek })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data?.error || 'share-link-error');
        }
        const shareUrl = data.url || `${window.location.origin}/share/${data.token}`;
        lastGeneratedShareUrl = shareUrl;
        lastShareEmployeeCount = typeof data.employeeCount === 'number'
            ? data.employeeCount
            : getEmployeesData().length;
        renderShareResult();
        showBannerMessage('Посилання для перегляду готове.');
    } catch (error) {
        console.warn('Server share link failed', error);
        if (resultEl) {
            resultEl.textContent = 'Не вдалося створити посилання. Спробуйте ще раз.';
            resultEl.classList.remove('hidden');
        }
        showBannerMessage('Не вдалося створити посилання.');
    }
}

function encodeShareData(data) {
    const json = JSON.stringify(data);
    try {
        if (LZ && typeof LZ.compressToEncodedURIComponent === 'function') {
            const compressed = LZ.compressToEncodedURIComponent(json);
            if (compressed && compressed.length < json.length) {
                return compressed;
            }
        }
    } catch (error) {
        console.warn('Compression error', error);
    }
    return encodeURIComponent(json);
}

function decodeShareData(encoded) {
    if (!encoded || typeof encoded !== 'string') {
        throw new Error('invalid-encoded');
    }
    let json = '';
    try {
        if (LZ && typeof LZ.decompressFromEncodedURIComponent === 'function') {
            const decompressed = LZ.decompressFromEncodedURIComponent(encoded);
            if (decompressed && decompressed !== '') {
                json = decompressed;
            }
        }
    } catch (error) {
        console.warn('Decompression error', error);
    }
    if (!json) {
        json = decodeURIComponent(encoded);
    }
    return JSON.parse(json);
}

function buildScheduleSnapshot() {
    const current = {
        limits: getLimitsData(),
        employees: getEmployeesData()
    };

    return sanitizeSnapshot(current);
}

function sanitizeSnapshot(data = {}) {
    return {
        limits: Array.isArray(data.limits)
            ? data.limits.map(value => String(value ?? ''))
            : getLimitsData().map(value => String(value ?? '')),
        employees: Array.isArray(data.employees) ? data.employees.map(sanitizeEmployeeRecord) : []
    };
}

function sanitizeEmployeeRecord(record = {}) {
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : null;
    const clientId = typeof record.clientId === 'string' && record.clientId.trim() ? record.clientId.trim() : null;
    const sortIndex = Number.isFinite(record.sortIndex) ? record.sortIndex : null;
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'Працівник';
    const position = typeof record.position === 'string' ? record.position.trim() : '';
    const scheduleSource = Array.isArray(record.schedule) ? record.schedule : [];

    const normalizedSchedule = Array.from({ length: 7 }, (_, index) => {
        const slot = scheduleSource[index];
        if (!slot || typeof slot !== 'object') {
            return { primary: '', secondary: '', locked: false };
        }
        const primary = typeof slot.primary === 'string' ? slot.primary : (slot.primary != null ? String(slot.primary) : '');
        const secondary = typeof slot.secondary === 'string' ? slot.secondary : (slot.secondary != null ? String(slot.secondary) : '');
        const locked = !!slot.locked;
        return { primary, secondary, locked };
    });

    return { id, clientId, sortIndex, name, position, schedule: normalizedSchedule };
}

function readStoredScheduleData() {
    if (!lastLoadedScheduleSnapshot || typeof lastLoadedScheduleSnapshot !== 'object') {
        return null;
    }
    return {
        limits: Array.isArray(lastLoadedScheduleSnapshot.limits) ? lastLoadedScheduleSnapshot.limits : [],
        employees: Array.isArray(lastLoadedScheduleSnapshot.employees) ? lastLoadedScheduleSnapshot.employees : [],
        week: typeof lastLoadedScheduleSnapshot.week === 'string' ? lastLoadedScheduleSnapshot.week : null
    };
}

function renderShareResult() {
    const resultEl = document.getElementById('share-result');
    if (!resultEl || !lastGeneratedShareUrl) {
        return;
    }

    const employeeCountText = lastShareEmployeeCount > 0
        ? `Працівників у розкладі: ${lastShareEmployeeCount}`
        : 'Працівників у розкладі: дані відсутні';

    const linkHtml = `<a href="${lastGeneratedShareUrl}" target="_blank" rel="noopener">${lastGeneratedShareUrl}</a>`;

    resultEl.innerHTML = [
        '<div class="share-result-content">',
        `<div class="share-result-line"><span class="share-result-label">Посилання:</span><span class="share-result-link">${linkHtml}</span></div>`,
        `<div class="share-result-meta">${employeeCountText}</div>`,
        '<div class="share-result-actions">',
        '<button type="button" class="primary-btn share-copy-link" data-action="copy-link">Скопіювати посилання</button>',
        '<button type="button" class="ghost-btn share-download-qr" data-action="download-qr">Завантажити QR</button>',
        '</div>',
        '</div>'
    ].join('');
    resultEl.classList.remove('hidden');

    const copyBtn = resultEl.querySelector('[data-action="copy-link"]');
    const downloadBtn = resultEl.querySelector('[data-action="download-qr"]');

    if (copyBtn) {
        copyBtn.addEventListener('click', copyShareLink);
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadShareQr);
    }

}

async function downloadShareQr() {
    if (!lastGeneratedShareUrl) {
        showBannerMessage('QR-код недоступний. Згенеруйте посилання ще раз.');
        return;
    }

    const fileName = `timzo-schedule-qr-${Date.now()}.png`;

    const downloadFromDataUrl = (dataUrl) => {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const tryLocalGeneration = () => {
        if (typeof QRious === 'undefined') {
            return null;
        }
        try {
            const qr = new QRious({
                value: lastGeneratedShareUrl,
                size: 320,
                level: 'H'
            });
            return qr.toDataURL('image/png');
        } catch (error) {
            console.warn('QRious generation failed, fallback to remote service', error);
            return null;
        }
    };

    const localDataUrl = tryLocalGeneration();
    if (localDataUrl) {
        downloadFromDataUrl(localDataUrl);
        return;
    }

    const remoteUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(lastGeneratedShareUrl)}&ecc=H`;
    try {
        const response = await fetch(remoteUrl);
        if (!response.ok) {
            throw new Error(`QR server responded with ${response.status}`);
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        downloadFromDataUrl(objectUrl);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
        console.error('Remote QR generation failed', error);
        showBannerMessage('Не вдалося завантажити QR-код. Спробуйте пізніше.');
    }
}

async function copyShareLink() {
    if (!lastGeneratedShareUrl) {
        showBannerMessage('Немає посилання для копіювання.');
        return;
    }

    const attemptClipboard = async () => {
        if (typeof navigator !== 'undefined'
            && navigator.clipboard
            && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(lastGeneratedShareUrl);
            return true;
        }
        return false;
    };

    try {
        const success = await attemptClipboard();
        if (!success) {
            throw new Error('clipboard-unsupported');
        }
        showBannerMessage('Посилання скопійовано.');
    } catch (error) {
        try {
            if (typeof document === 'undefined') {
                throw new Error('copy-failed');
            }
            const tempInput = document.createElement('input');
            tempInput.value = lastGeneratedShareUrl;
            document.body.appendChild(tempInput);
            tempInput.select();
            tempInput.setSelectionRange(0, tempInput.value.length);
            const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
            document.body.removeChild(tempInput);
            if (copied) {
                showBannerMessage('Посилання скопійовано.');
            } else {
                throw new Error('copy-failed');
            }
        } catch (fallbackError) {
            showBannerMessage('Не вдалося скопіювати посилання.');
        }
    }
}

function loadScheduleFromShareHash() {
    const hash = window.location.hash || '';
    if (!hash.startsWith('#share=')) {
        return false;
    }

    const encoded = hash.slice(7);
    if (!encoded) {
        throw new Error('Invalid share link');
    }

    let payload;
    try {
        payload = decodeShareData(encoded);
    } catch (error) {
        console.warn('Не вдалося декодувати розклад зі спільного посилання', error);
        throw new Error('Invalid share link');
    }

    if (!payload || typeof payload !== 'object' || !payload.data || !Array.isArray(payload.data.employees)) {
        throw new Error('Invalid share payload');
    }

    const weekInput = document.getElementById('week');
    if (weekInput && payload.week) {
        weekInput.value = payload.week;
        updateWeekDates();
        syncShareWeekInput();
    }

    const snapshot = sanitizeSnapshot(payload.data);
    lastLoadedScheduleSnapshot = snapshot;

    if (!snapshot.employees || snapshot.employees.length === 0) {
        showBannerMessage('Посилання не містить працівників для відображення.');
        return false;
    }

    isShareView = true;

    if (snapshot.limits) {
        setLimitsData(snapshot.limits);
    }

    renderEmployeesFromSnapshot(snapshot.employees, { skipSave: true });
    updateWeekDates();
    showBannerMessage(`Розклад відкрито у режимі перегляду. Працівників: ${snapshot.employees.length}`);
    return true;
}

function applyShareViewMode() {
    const fallback = document.getElementById('week-date-fallback');
    if (fallback) fallback.disabled = true;
    document.body.classList.add('shared-view');

    document.querySelectorAll('.time-input').forEach(input => {
        input.disabled = true;
    });

    document.querySelectorAll('.day-limit-input').forEach(input => {
        input.disabled = true;
    });

    document.querySelectorAll('.delete-shift-btn').forEach(btn => {
        btn.disabled = true;
    });

    document.querySelectorAll('.edit-employee, .delete-employee').forEach(btn => {
        btn.disabled = true;
    });

    const addBtn = document.getElementById('add-employee-btn');
    if (addBtn) {
        addBtn.disabled = true;
    }

    const shareForm = document.getElementById('share-form');
    if (shareForm) {
        Array.from(shareForm.elements).forEach(element => {
            if (element.id === 'export-pdf' || element.id === 'export-jpg') return;
            if (element.id === 'share-week' || element.type === 'submit') {
                element.disabled = false;
            } else if (element.type === 'button') {
                element.disabled = false;
            } else {
                element.disabled = true;
            }
        });
    }

    const shareTrigger = document.getElementById('share-trigger');
    if (shareTrigger) {
        shareTrigger.disabled = false;
    }

    document.querySelectorAll('#month-plan-total-input, #month-plan-save, #employee-plan-input, #employee-plan-save, #employee-detail-select').forEach(element => {
        element.disabled = true;
    });

    const clearBtn = document.getElementById('clear-schedule');
    if (clearBtn) {
        clearBtn.disabled = false;
    }
}

function exitShareViewMode() {
    if (!isShareView) return;
    isShareView = false;
    document.body.classList.remove('shared-view');

    document.querySelectorAll('.time-input').forEach(input => {
        input.disabled = false;
    });

    document.querySelectorAll('.day-limit-input').forEach(input => {
        input.disabled = false;
    });

    document.querySelectorAll('.delete-shift-btn').forEach(btn => {
        btn.disabled = false;
    });

    document.querySelectorAll('.edit-employee, .delete-employee').forEach(btn => {
        btn.disabled = false;
    });

    const addBtn = document.getElementById('add-employee-btn');
    if (addBtn) {
        addBtn.disabled = false;
    }

    const clearBtn = document.getElementById('clear-schedule');
    if (clearBtn) {
        clearBtn.disabled = false;
    }

    const shareTrigger = document.getElementById('share-trigger');
    if (shareTrigger) {
        shareTrigger.disabled = false;
    }

    const shareForm = document.getElementById('share-form');
    if (shareForm) {
        Array.from(shareForm.elements).forEach(element => {
            element.disabled = false;
        });
    }

    document.querySelectorAll('#month-plan-total-input, #month-plan-save, #employee-plan-input, #employee-plan-save, #employee-detail-select').forEach(element => {
        element.disabled = false;
    });
}

function showBannerMessage(message) {
    const banner = document.getElementById('share-banner');
    if (!banner || !message) return;
    banner.textContent = message;
    banner.classList.remove('hidden');
    if (shareBannerTimer) {
        clearTimeout(shareBannerTimer);
    }
    shareBannerTimer = setTimeout(() => {
        banner.classList.add('hidden');
    }, 4000);
}

// Функції для роботи з тижнями
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return [d.getUTCFullYear(), weekNo];
}

let mobileDayIndex = (new Date().getDay() + 6) % 7;
function selectMobileDay(index) {
    mobileDayIndex = Math.max(0, Math.min(6, index));
    const section = document.getElementById('schedule-section');
    if (!section) return;
    section.querySelectorAll('.employee-row .day-cell').forEach(cell => {
        cell.classList.toggle('mobile-selected-day', Number(cell.dataset.dayIndex) === mobileDayIndex);
    });
    section.querySelectorAll('.limits-row .day-cell, .used-hours-row .day-cell').forEach(cell => {
        cell.classList.toggle('mobile-selected-day', Number(cell.dataset.day) === mobileDayIndex);
    });
    const tabs = document.querySelectorAll('#mobile-day-tabs button');
    tabs.forEach((tab, i) => {
        tab.setAttribute('aria-selected', String(i === mobileDayIndex));
        tab.tabIndex = i === mobileDayIndex ? 0 : -1;
        const date = currentWeekDates[i];
        tab.querySelector('span').textContent = date ? date.getDate() : '';
        tab.setAttribute('aria-label', date ? date.toLocaleDateString('uk-UA', {weekday:'long', day:'numeric', month:'long'}) : DAY_NAMES[i]);
    });
    const date = currentWeekDates[mobileDayIndex];
    if (date && matchMedia('(max-width: 767px)').matches) {
        setTimelineSelectedDate(date);
        updateTimeline(mobileDayIndex);
    }
    document.getElementById('mobile-day-title').textContent = date ? date.toLocaleDateString('uk-UA', {weekday:'long', day:'numeric', month:'long'}) : DAY_NAMES[mobileDayIndex];
    document.getElementById('mobile-day-prev').disabled = mobileDayIndex === 0;
    document.getElementById('mobile-day-next').disabled = mobileDayIndex === 6;
}
function setupMobileSchedule() {
    const tabs = document.getElementById('mobile-day-tabs');
    if (!tabs) return;
    tabs.addEventListener('click', event => {
        const button = event.target.closest('[data-mobile-day]');
        if (button) selectMobileDay(Number(button.dataset.mobileDay));
    });
    tabs.addEventListener('keydown', event => {
        let next = mobileDayIndex;
        if (event.key === 'ArrowRight') next++;
        else if (event.key === 'ArrowLeft') next--;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = 6;
        else return;
        event.preventDefault();
        selectMobileDay(next);
        tabs.children[mobileDayIndex].focus();
    });
    document.getElementById('mobile-day-prev').onclick = () => selectMobileDay(mobileDayIndex - 1);
    document.getElementById('mobile-day-next').onclick = () => selectMobileDay(mobileDayIndex + 1);
    const region = document.querySelector('.schedule-scroll');
    let start = null;
    region.addEventListener('touchstart', event => {
        start = !event.target.closest('input,button,select,a') && event.touches.length === 1 ? {x:event.touches[0].clientX, y:event.touches[0].clientY} : null;
    }, {passive:true});
    region.addEventListener('touchend', event => {
        if (!start || !event.changedTouches.length) return;
        const dx = event.changedTouches[0].clientX - start.x;
        const dy = event.changedTouches[0].clientY - start.y;
        start = null;
        if (matchMedia('(max-width: 767px)').matches && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) selectMobileDay(mobileDayIndex + (dx < 0 ? 1 : -1));
    }, {passive:true});
    region.addEventListener('touchcancel', () => { start = null; }, {passive:true});
    selectMobileDay(mobileDayIndex);
}
function labelMobileStats(row) {
    if (!row.matches('.employee-stats-row, .employee-plan-row')) return;
    const labels = row.classList.contains('employee-stats-row')
        ? ['Працівник','Посада','Робочі / вихідні дні','Години','Середні години за день']
        : row.classList.contains('compact') ? ['Працівник','Посада','Усього годин']
        : ['Працівник','Посада','Години за місяць','План годин','Виконання за місяць','За тиждень від плану','Залишок годин'];
    Array.from(row.children).forEach((cell,i) => { cell.dataset.label = labels[i]; });
}

function updateWeekDates() {
    const weekInput = document.getElementById('week');
    const weekValue = ensureWeekValue();
    if (!weekInput || !weekValue) return;
    const parts = weekValue.split('-W');
    if (parts.length !== 2) return;
    const year = Number(parts[0]);
    const week = Number(parts[1]);
    if (!Number.isInteger(year) || !Number.isInteger(week)) return;
    
    const date = new Date(year, 0, 1);
    const dayNum = date.getDay();
    const dayDiff = (dayNum <= 4) ? 1 - dayNum : 8 - dayNum;
    date.setDate(date.getDate() + dayDiff + (week - 1) * 7);
    
    const dayCells = document.querySelectorAll('.table-header .day-cell');
    currentWeekDates = [];
    
    for (let i = 0; i < 7; i++) {
        const currentDate = new Date(date);
        currentDate.setDate(date.getDate() + i);
        currentWeekDates.push(new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()));
        const day = currentDate.getDate();
        const month = MONTH_NAMES[currentDate.getMonth()];
        if (!dayCells[i]) continue;
        dayCells[i].innerHTML = `<div class="day-name">${DAY_NAMES[i]}</div><div class="day-date">${day} ${month}</div>`;
        dayCells[i].dataset.dayName = DAY_NAMES[i];
        dayCells[i].dataset.dateLabel = `${day} ${month}`;
        dayCells[i].dataset.fullLabel = `${DAY_NAMES[i]} ${day} ${month}`;
    }

    if (currentWeekDates.length === 7) {
        const preferredIndex = getTodayWeekdayIndex();
        const clampedIndex = Math.min(Math.max(preferredIndex, 0), currentWeekDates.length - 1);
        lastEditedDayIndex = null;
        currentTimelineDayIndex = clampedIndex;
        setTimelineSelectedDate(currentWeekDates[clampedIndex]);
    } else {
        currentTimelineDayIndex = -1;
        setTimelineSelectedDate(new Date());
    }

    updateTimeline();
    syncShareWeekInput();
    selectMobileDay(mobileDayIndex);
}


// Функції для роботи з працівниками
function addNewEmployee() {
    if (isShareView) {
        showBannerMessage('У режимі перегляду не можна додавати працівників.');
        return;
    }
    const name = prompt('Введіть ім\'я працівника:');
    if (!name) return;
    const position = prompt('Введіть посаду працівника:') || '';
    const emptySchedule = Array.from({ length: 7 }, () => ({ primary: '', secondary: '', locked: false }));
    addEmployee(name, emptySchedule, true, position);
}

function addEmployee(name, schedule, shouldSave = true, position = '', options = {}) {
    const target = options.container || document.getElementById('employees-container');
    if (!target) return null;
    const employeeRow = document.createElement('div');
    employeeRow.className = 'employee-row';
    if (options.employeeId) {
        employeeRow.dataset.employeeId = options.employeeId;
    }
    const clientId = options.clientId || (!options.employeeId ? generateClientId() : '');
    if (clientId) {
        employeeRow.dataset.clientId = clientId;
    }
    
    const labelCell = createNameCell(name, position);
    employeeRow.appendChild(labelCell);
    
    const normalizedSchedule = Array.from({ length: 7 }, (_, index) => normalizeScheduleValue(schedule ? schedule[index] : undefined));
    for (let i = 0; i < 7; i++) {
        const dayCell = createDayCell(normalizedSchedule[i]);
        dayCell.dataset.dayIndex = i;
        employeeRow.appendChild(dayCell);
    }
    
    const totalCell = createTotalCell();
    employeeRow.appendChild(totalCell);
    
    target.querySelectorAll?.('.empty-state').forEach(el => el.remove());
    target.appendChild(employeeRow);
    
    if (!options.deferMetrics) {
        calculateAllHours();
    }

    populateEmployeeDetailSelect();
    renderEmployeeDetailStats();

    updateMoveButtonsState();
    
    if (shouldSave && !options.skipSave) {
        saveData();
    }

    return employeeRow;
}

function createNameCell(name, position = '') {
    const labelCell = document.createElement('div');
    labelCell.className = 'label-cell';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'employee-name';
    nameSpan.textContent = name;
    nameSpan.title = name;

    let positionSpan = null;
    if (position && position.trim() !== '') {
        positionSpan = document.createElement('span');
        positionSpan.className = 'employee-position';
        positionSpan.textContent = position;
        positionSpan.title = position;
    }

    const infoWrapper = document.createElement('div');
    infoWrapper.className = 'employee-info';
    infoWrapper.appendChild(nameSpan);
    if (positionSpan) {
        infoWrapper.appendChild(positionSpan);
    }

    const actionsWrapper = document.createElement('div');
    actionsWrapper.className = 'employee-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'edit-employee';
    editBtn.innerHTML = '<span aria-hidden="true">✎</span>';
    editBtn.title = 'Редагувати працівника';
    editBtn.setAttribute('aria-label', 'Редагувати працівника');
    editBtn.addEventListener('click', function() {
        if (isShareView) {
            showBannerMessage('У режимі перегляду не можна редагувати працівника.');
            return;
        }
        const row = this.closest('.employee-row');
        if (!row) return;

        const currentName = nameSpan.textContent;
        const currentPosition = positionSpan ? positionSpan.textContent : '';

        const newNameInput = prompt('Оновити ім\'я працівника:', currentName);
        if (newNameInput === null) return;
        const trimmedName = newNameInput.trim();
        if (trimmedName !== '') {
            nameSpan.textContent = trimmedName;
            nameSpan.title = trimmedName;
        }

        const newPositionInput = prompt('Оновити посаду працівника:', currentPosition);
        if (newPositionInput === null) {
            saveData();
            updateWeeklyStats();
            return;
        }

        const trimmedPosition = newPositionInput.trim();
        if (trimmedPosition === '') {
            if (positionSpan && positionSpan.parentElement) {
                positionSpan.remove();
                positionSpan = null;
            }
        } else {
            if (!positionSpan) {
                positionSpan = document.createElement('span');
                positionSpan.className = 'employee-position';
                infoWrapper.appendChild(positionSpan);
            }
            positionSpan.textContent = trimmedPosition;
            positionSpan.title = trimmedPosition;
        }

        populateEmployeeDetailSelect();
        updateWeeklyStats();
        updateTimeline();
        saveData();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-employee';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', function() {
        if (isShareView) {
            showBannerMessage('У режимі перегляду не можна видаляти працівників.');
            return;
        }
        const row = this.closest('.employee-row');
        const employeeId = row ? row.dataset.employeeId : '';
        if (employeeId) {
            deletedEmployeeIds.add(employeeId);
        }
        if (row) {
            row.remove();
        }
        calculateAllHours();
        populateEmployeeDetailSelect();
        refreshStatsViews();
        updateMoveButtonsState();
        saveData();
    });

    const moveUpBtn = document.createElement('button');
    moveUpBtn.type = 'button';
    moveUpBtn.className = 'move-employee move-employee-up';
    moveUpBtn.textContent = '↑';
    moveUpBtn.title = 'Перемістити вгору';
    moveUpBtn.setAttribute('aria-label', 'Перемістити працівника вгору');
    moveUpBtn.addEventListener('click', function() {
        if (isShareView) {
            showBannerMessage('У режимі перегляду переміщення недоступне.');
            return;
        }
        const row = this.closest('.employee-row');
        moveEmployeeRow(row, -1);
    });

    const moveDownBtn = document.createElement('button');
    moveDownBtn.type = 'button';
    moveDownBtn.className = 'move-employee move-employee-down';
    moveDownBtn.textContent = '↓';
    moveDownBtn.title = 'Перемістити вниз';
    moveDownBtn.setAttribute('aria-label', 'Перемістити працівника вниз');
    moveDownBtn.addEventListener('click', function() {
        if (isShareView) {
            showBannerMessage('У режимі перегляду переміщення недоступне.');
            return;
        }
        const row = this.closest('.employee-row');
        moveEmployeeRow(row, 1);
    });

    labelCell.appendChild(infoWrapper);
    actionsWrapper.appendChild(editBtn);
    actionsWrapper.appendChild(moveUpBtn);
    actionsWrapper.appendChild(moveDownBtn);
    actionsWrapper.appendChild(deleteBtn);
    labelCell.appendChild(actionsWrapper);

    return labelCell;
}

function moveEmployeeRow(row, direction) {
    if (!row) return;
    const container = document.getElementById('employees-container');
    if (!container) return;
    const rows = Array.from(container.querySelectorAll('.employee-row'));
    const index = rows.indexOf(row);
    if (index === -1) return;
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= rows.length) return;

    const referenceNode = direction > 0 ? rows[newIndex].nextSibling : rows[newIndex];
    container.insertBefore(row, referenceNode);
    updateMoveButtonsState();
    calculateAllHours();
    populateEmployeeDetailSelect();
    renderEmployeeDetailStats();
    saveData();
}

function updateMoveButtonsState() {
    const rows = Array.from(document.querySelectorAll('.employee-row'));
    rows.forEach((row, index) => {
        const upBtn = row.querySelector('.move-employee-up');
        const downBtn = row.querySelector('.move-employee-down');
        if (upBtn) {
            upBtn.disabled = index === 0;
        }
        if (downBtn) {
            downBtn.disabled = index === rows.length - 1;
        }
    });
}

function normalizeScheduleValue(scheduleValue) {
    if (!scheduleValue) {
        return { primary: '', secondary: '', locked: false };
    }

    if (typeof scheduleValue === 'string') {
        return { primary: scheduleValue, secondary: '', locked: false };
    }

    return {
        primary: scheduleValue.primary || '',
        secondary: scheduleValue.secondary || '',
        locked: !!scheduleValue.locked
    };
}

function createShiftInput(type, value) {
    const wrapper = document.createElement('div');
    wrapper.className = `shift-input ${type}-shift`;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'time-input';
    input.dataset.shiftType = type;
    input.setAttribute('aria-label', type === 'primary' ? 'Основна зміна, наприклад 09:00 - 17:00' : 'Друга зміна');
    input.placeholder = type === 'primary' ? 'вихідний' : 'друга зміна';
    input.value = value || '';

    setupShiftInputBehavior(input, type);

    wrapper.appendChild(input);

    let deleteBtn = null;
    if (type === 'secondary') {
        deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'delete-shift-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Видалити другу зміну';
        deleteBtn.addEventListener('click', function(event) {
            event.stopPropagation();
            if (isShareView) {
                showBannerMessage('У режимі перегляду зміни недоступні.');
                return;
            }
            if (input.value.trim() !== '') {
                input.value = '';
                input.dispatchEvent(new Event('change'));
            }
        });
        wrapper.appendChild(deleteBtn);
    }

    updateShiftInputPlaceholders(input);
    updateDeleteButtonVisibility(deleteBtn, input.value);

    input.addEventListener('input', function() {
        updateDeleteButtonVisibility(deleteBtn, input.value);
    });

    return { container: wrapper, input, deleteBtn };
}

function setupShiftInputBehavior(input, type) {
    const defaultPlaceholder = type === 'primary' ? 'вихідний' : 'друга зміна';
    const activePlaceholder = '8 - 21';

    if (input.value.trim() === '') {
        input.placeholder = defaultPlaceholder;
    }

    input.addEventListener('focus', function() {
        if (this.value === '') {
            this.placeholder = activePlaceholder;
        }
    });

    input.addEventListener('blur', function() {
        if (this.value === '') {
            this.placeholder = defaultPlaceholder;
        }
    });

    input.addEventListener('change', function() {
        if (isShareView) {
            updateDeleteButtonVisibility(deleteBtn, input.value);
            return;
        }
        if (validateTimeInput(this, { defaultPlaceholder })) {
            noteEditedDayFromInput(this);
            calculateAllHours();
            saveData();
        }
        if (this.value === '') {
            this.placeholder = defaultPlaceholder;
        }
    });
}

function updateShiftInputPlaceholders(input) {
    if (input.value.trim() === '') {
        input.placeholder = input.dataset.shiftType === 'primary' ? 'вихідний' : 'друга зміна';
    }
}

function updateDeleteButtonVisibility(button, value) {
    if (!button) return;
    button.style.display = value && value.trim() !== '' ? 'block' : 'none';
}

function createDayCell(scheduleValue) {
    const { primary, secondary, locked } = normalizeScheduleValue(scheduleValue);
    const dayCell = document.createElement('div');
    dayCell.className = 'day-cell';

    const primaryShift = createShiftInput('primary', primary);
    dayCell.appendChild(primaryShift.container);

    const secondaryContainer = document.createElement('div');
    secondaryContainer.className = 'secondary-shift-container';

    const secondaryShift = createShiftInput('secondary', secondary);
    secondaryContainer.appendChild(secondaryShift.container);
    dayCell.appendChild(secondaryContainer);

    const dayOffLabel = document.createElement('div');
    dayOffLabel.className = 'day-off-label';
    dayOffLabel.textContent = 'вихідний';
    dayCell.appendChild(dayOffLabel);

    if (!secondary) {
        collapseSecondaryShift(secondaryContainer);
    } else {
        expandSecondaryShift(secondaryContainer);
    }

    setupSecondaryShiftInteractions({
        dayCell,
        primaryInput: primaryShift.input,
        secondaryContainer,
        secondaryInput: secondaryShift.input
    });

    setupLockInteractions({
        dayCell,
        primaryInput: primaryShift.input,
        secondaryInput: secondaryShift.input,
        secondaryContainer,
        dayOffLabel
    });

    setDayLockState(dayCell, {
        primaryInput: primaryShift.input,
        secondaryInput: secondaryShift.input,
        secondaryContainer,
        dayOffLabel
    }, locked, { skipSave: true, skipRecalculate: true, skipTimeline: true });

    return dayCell;
}

function setupSecondaryShiftInteractions({ dayCell, primaryInput, secondaryContainer, secondaryInput }) {
    dayCell.addEventListener('mouseenter', function() {
        if (dayCell.classList.contains('is-locked')) return;
        if (primaryInput.value.trim() !== '' && secondaryContainer.classList.contains('is-collapsed')) {
            secondaryContainer.classList.add('is-preview');
        }
    });

    dayCell.addEventListener('mouseleave', function() {
        if (dayCell.classList.contains('is-locked')) return;
        secondaryContainer.classList.remove('is-preview');
    });

    secondaryContainer.addEventListener('click', function(event) {
        if (dayCell.classList.contains('is-locked')) return;
        if (secondaryContainer.classList.contains('is-collapsed')) {
            event.stopPropagation();
            expandSecondaryShift(secondaryContainer);
            secondaryInput.focus();
        }
    });

    secondaryInput.addEventListener('blur', function() {
        if (dayCell.classList.contains('is-locked')) return;
        if (this.value.trim() === '') {
            collapseSecondaryShift(secondaryContainer);
        }
    });

    secondaryInput.addEventListener('change', function() {
        if (dayCell.classList.contains('is-locked')) return;
        if (this.value.trim() === '') {
            collapseSecondaryShift(secondaryContainer);
        } else {
            expandSecondaryShift(secondaryContainer);
        }
    });
}

function collapseSecondaryShift(container) {
    container.classList.add('is-collapsed');
    container.classList.remove('is-preview');
}

function expandSecondaryShift(container) {
    container.classList.remove('is-collapsed');
    container.classList.remove('is-preview');
}

function setupLockInteractions({ dayCell, primaryInput, secondaryInput, secondaryContainer, dayOffLabel }) {
    dayCell.addEventListener('contextmenu', function(event) {
        event.preventDefault();
        const shouldLock = !dayCell.classList.contains('is-locked');
        setDayLockState(dayCell, {
            primaryInput,
            secondaryInput,
            secondaryContainer,
            dayOffLabel
        }, shouldLock);
    });
}

function setDayLockState(dayCell, config, locked, options = {}) {
    const dayIndex = parseInt(dayCell.dataset.dayIndex || '-1', 10);
    if (!Number.isNaN(dayIndex) && dayIndex >= 0 && dayIndex <= 6) {
        lastEditedDayIndex = dayIndex;
        currentTimelineDayIndex = dayIndex;
        if (!options.skipTimeline && currentWeekDates[dayIndex]) {
            setTimelineSelectedDate(currentWeekDates[dayIndex]);
        }
    }

    dayCell.classList.toggle('is-locked', locked);
    dayCell.dataset.locked = locked ? 'true' : 'false';

    if (config.dayOffLabel) {
        config.dayOffLabel.style.display = locked ? 'block' : 'none';
    }

    if (config.primaryInput) {
        config.primaryInput.disabled = locked;
    }
    if (config.secondaryInput) {
        config.secondaryInput.disabled = locked;
    }

    if (locked) {
        if (config.primaryInput) {
            config.primaryInput.value = '';
            updateShiftInputPlaceholders(config.primaryInput);
        }
        if (config.secondaryInput) {
            config.secondaryInput.value = '';
            updateShiftInputPlaceholders(config.secondaryInput);
            const deleteBtn = config.secondaryInput.parentElement.querySelector('.delete-shift-btn');
            updateDeleteButtonVisibility(deleteBtn, config.secondaryInput.value);
        }
        if (config.secondaryContainer) {
            collapseSecondaryShift(config.secondaryContainer);
        }
    } else {
        if (config.primaryInput) {
            updateShiftInputPlaceholders(config.primaryInput);
        }
        if (config.secondaryInput) {
            updateShiftInputPlaceholders(config.secondaryInput);
            const deleteBtn = config.secondaryInput.parentElement.querySelector('.delete-shift-btn');
            updateDeleteButtonVisibility(deleteBtn, config.secondaryInput.value);
        }
    }

    if (config.secondaryContainer) {
        config.secondaryContainer.classList.remove('is-preview');
    }

    if (!options.skipRecalculate) {
        calculateAllHours();
    } else if (!options.skipTimeline) {
        updateTimeline();
    }

    if (!options.skipSave) {
        saveData();
    }
}

function getDailyHoursFromCell(cell) {
    if (cell.classList.contains('is-locked')) {
        return { rawTotal: 0, adjustedTotal: 0 };
    }

    const primaryInput = cell.querySelector('.time-input[data-shift-type="primary"]');
    const secondaryInput = cell.querySelector('.time-input[data-shift-type="secondary"]');
    const durations = [];

    [primaryInput, secondaryInput].forEach(input => {
        const duration = parseShiftDuration(input ? input.value : '');
        if (duration !== null) {
            durations.push(duration);
        }
    });

    const rawTotal = durations.reduce((sum, hours) => sum + hours, 0);
    const adjustedTotal = rawTotal >= 5.75 ? Math.max(rawTotal - 1, 0) : rawTotal;

    return { rawTotal, adjustedTotal };
}

function parseShiftDuration(value) {
    if (!value) return null;
    const trimmed = value.trim();
    if (trimmed === '') return null;

    const parts = trimmed.split('-');
    if (parts.length !== 2) return null;

    const startTime = parseTimeString(parts[0]);
    const endTime = parseTimeString(parts[1]);

    if (!startTime || !endTime) {
        return null;
    }

    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);

    let minutes = endMinutes - startMinutes;
    if (minutes <= 0) minutes += 24 * 60;

    return minutes / 60;
}

function parseTimeString(value) {
    const trimmed = value.trim();
    if (trimmed === '') return null;

    const pattern = /^(\d{1,2})(?::(\d{2}))?$/;
    const match = trimmed.match(pattern);
    if (!match) return null;

    const hour = parseInt(match[1], 10);
    const minute = match[2] ? parseInt(match[2], 10) : 0;

    if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 0 || hour > 23) {
        return null;
    }

    if (minute !== 0 && minute !== 30) {
        return null;
    }

    return { hour, minute };
}

function formatTimeDisplay(time) {
    const hour = String(time.hour).padStart(2, '0');
    const minute = String(time.minute).padStart(2, '0');
    return `${hour}:${minute}`;
}

function timeToMinutes(time) {
    return time.hour * 60 + time.minute;
}

function formatHoursValue(value) {
    if (!value || Number.isNaN(value)) {
        return '0';
    }

    const rounded = Math.round(value * 4) / 4; // до 15 хвилин, на випадок комбінованих змін
    const fixed = rounded.toFixed(2);

    if (fixed.endsWith('.00')) {
        return fixed.slice(0, -3);
    }

    if (fixed.endsWith('0')) {
        return fixed.slice(0, -1);
    }

    return fixed;
}

function createTotalCell() {
    const totalCell = document.createElement('div');
    totalCell.className = 'total-cell';
    totalCell.textContent = '0';
    return totalCell;
}

function clearSchedule() {
    if (isShareView) {
        if (!confirm('Створити новий графік для редагування?')) {
            return;
        }
        exitShareViewMode();
        clearAllEmployees();
        document.querySelectorAll('.day-limit-input').forEach(input => {
            input.value = input.defaultValue || input.value;
        });
        saveData();
        updateWeekDates();
        calculateAllHours();
        showBannerMessage('Створено новий порожній графік для редагування.');
        return;
    }
    if (!confirm('Ви впевнені, що хочете очистити графік всіх працівників?')) {
        return;
    }
    document.querySelectorAll('.employee-row .time-input').forEach(input => {
        input.value = '';
        input.placeholder = 'вихідний';
        input.dispatchEvent(new Event('change'));
    });
    saveData();
}

// Валідація та розрахунки
function validateTimeInput(input, options = {}) {
    const defaultPlaceholder = options.defaultPlaceholder || 'вихідний';
    const value = input.value.trim();
    if (value === '') return true;

    const parts = value.split('-');
    if (parts.length !== 2) {
        alert('Невірний формат часу. Використовуйте "8 - 21" або "8:30 - 14:30"');
        input.value = '';
        input.placeholder = defaultPlaceholder;
        return false;
    }

    const startTime = parseTimeString(parts[0]);
    const endTime = parseTimeString(parts[1]);

    if (!startTime || !endTime) {
        alert('Невірний формат часу. Використовуйте тільки години та хвилини :00 або :30 у діапазоні 0-23.');
        input.value = '';
        input.placeholder = defaultPlaceholder;
        return false;
    }

    if (timeToMinutes(startTime) === timeToMinutes(endTime)) {
        alert('Початковий та кінцевий час не можуть співпадати.');
        input.value = '';
        input.placeholder = defaultPlaceholder;
        return false;
    }

    input.value = `${formatTimeDisplay(startTime)} - ${formatTimeDisplay(endTime)}`;
    return true;
}

function calculateAllHours() {
    calculateEmployeeHours();
    calculateUsedHours();
    updateWeeklyLimitTotal();
    selectMobileDay(mobileDayIndex);
}

function calculateEmployeeHours() {
    document.querySelectorAll('.employee-row').forEach(row => {
        let weeklyTotal = 0;
        let workingDays = 0;

        row.querySelectorAll('.day-cell').forEach(cell => {
            const { adjustedTotal } = getDailyHoursFromCell(cell);
            weeklyTotal += adjustedTotal;
            if (!cell.classList.contains('is-locked') && adjustedTotal > 0) {
                workingDays += 1;
            }
        });

        const offDays = Math.max(0, 7 - workingDays);

        row.dataset.totalHours = weeklyTotal;
        row.dataset.workingDays = workingDays;
        row.dataset.offDays = offDays;
        row.querySelector('.total-cell').textContent = formatHoursValue(weeklyTotal);
    });
}

function calculateUsedHours() {
    const dayTotals = [0, 0, 0, 0, 0, 0, 0];
    const dayLimitInputs = document.querySelectorAll('.day-limit-input');
    const dayLimits = Array.from(dayLimitInputs).map(input => parseInt(input.value) || 0);
    const dayNames = DAY_NAMES;
    const dateCells = document.querySelectorAll('.table-header .day-cell');
    
    // Розраховуємо суму годин по дням
    document.querySelectorAll('.employee-row').forEach(row => {
        row.querySelectorAll('.day-cell').forEach((cell, index) => {
            const { adjustedTotal } = getDailyHoursFromCell(cell);
            dayTotals[index] += adjustedTotal;
        });
    });

    cachedDayTotals = dayTotals.slice();
    cachedDayLimits = dayLimits.slice();

    // Оновлюємо рядок з використаними годинами
    updateUsedHoursRow(dayTotals, dayLimits, dayNames, dateCells);

    updateWeeklyStats();
    updateTimeline();
}

function updateWeeklyLimitTotal() {
    const totalCell = document.getElementById('week-limit-total');
    if (!totalCell) return;
    const sum = Array.from(document.querySelectorAll('.day-limit-input')).reduce((acc, input) => {
        const val = parseFloat(input.value);
        return acc + (Number.isNaN(val) ? 0 : val);
    }, 0);
    totalCell.textContent = formatHoursValue(sum);
}

function updateUsedHoursRow(dayTotals, dayLimits, dayNames, dateCells) {
    const usedHoursRow = document.querySelector('.used-hours-row');
    const dayCells = usedHoursRow.querySelectorAll('.day-cell');
    let weekTotal = 0;
    let notificationMessages = [];
    
    dayTotals.forEach((total, index) => {
        dayCells[index].textContent = formatHoursValue(total);
        weekTotal += total;

        // Перевіряємо перевищення ліміту
        if (total > dayLimits[index]) {
            const headerCell = dateCells[index];
            const headerDayName = headerCell ? (headerCell.dataset.dayName || dayNames[index]) : dayNames[index];
            const headerDateLabel = headerCell ? (headerCell.dataset.dateLabel || headerCell.textContent) : '';
            dayCells[index].classList.add('limit-exceeded');
            notificationMessages.push(
                `Переліміт на ${headerDayName} (${headerDateLabel}) на ${formatHoursValue(total - dayLimits[index])} год.`
            );
        } else {
            dayCells[index].classList.remove('limit-exceeded');
        }
    });

    usedHoursRow.querySelector('.total-cell').textContent = formatHoursValue(weekTotal);

    // Показуємо сповіщення про перевищення лімітів
    if (notificationMessages.length > 0) {
        showNotification(notificationMessages.join('\n'));
    } else {
        hideNotification();
    }
}

function updateWeeklyStats() {
    const statsBody = document.getElementById('employee-stats-body');
    if (!statsBody) return;

    statsBody.innerHTML = '';

    const rows = Array.from(document.querySelectorAll('.employee-row'));
    let totalHoursAll = 0;

    rows.forEach(row => {
        const name = row.querySelector('.employee-name') ? row.querySelector('.employee-name').textContent : '';
        const position = row.querySelector('.employee-position') ? row.querySelector('.employee-position').textContent : '';
        const totalHours = parseFloat(row.dataset.totalHours || '0');
        const workingDays = parseInt(row.dataset.workingDays || '0', 10);
        const offDays = parseInt(row.dataset.offDays || (7 - workingDays), 10);
        const averageHours = workingDays > 0 ? totalHours / workingDays : 0;

        totalHoursAll += totalHours;
        const rowEl = document.createElement('div');
        rowEl.className = 'employee-stats-row';

        const nameCell = document.createElement('span');
        nameCell.className = 'employee-name-cell';
        nameCell.textContent = name;

        const positionCell = document.createElement('span');
        positionCell.textContent = position || '—';

        const daysCell = document.createElement('span');
        daysCell.textContent = `${workingDays} / ${Math.max(0, offDays)}`;

        const hoursCell = document.createElement('span');
        hoursCell.textContent = formatHoursValue(totalHours);

        const averageCell = document.createElement('span');
        averageCell.textContent = formatHoursValue(averageHours);

        rowEl.appendChild(nameCell);
        rowEl.appendChild(positionCell);
        rowEl.appendChild(daysCell);
        rowEl.appendChild(hoursCell);
        rowEl.appendChild(averageCell);

        labelMobileStats(rowEl);
        statsBody.appendChild(rowEl);
    });

    if (rows.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'employee-stats-empty';
        emptyState.textContent = 'Додайте працівників, щоб побачити статистику тижня';
        statsBody.appendChild(emptyState);
    }

    const totalWeekHoursEl = document.getElementById('total-week-hours');
    if (totalWeekHoursEl) {
        totalWeekHoursEl.textContent = formatHoursValue(totalHoursAll);
    }

    const avgWeekHoursEl = document.getElementById('average-week-hours');
    if (avgWeekHoursEl) {
        const averagePerEmployee = rows.length > 0 ? totalHoursAll / rows.length : 0;
        avgWeekHoursEl.textContent = formatHoursValue(averagePerEmployee);
    }

    const limitUsagePercentEl = document.getElementById('limit-usage-percent');
    const limitUsageBar = document.getElementById('limit-usage-bar');
    const totalLimit = cachedDayLimits.reduce((sum, value) => sum + value, 0);
    const totalUsed = cachedDayTotals.reduce((sum, value) => sum + value, 0);
    const percentValue = totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;
    const percentDisplay = percentValue % 1 === 0 ? percentValue.toFixed(0) : percentValue.toFixed(1);

    if (limitUsagePercentEl) {
        limitUsagePercentEl.textContent = `${percentDisplay}%`;
    }

    if (limitUsageBar) {
        const clamped = Math.max(0, Math.min(100, percentValue));
        limitUsageBar.style.width = `${clamped}%`;
        limitUsageBar.style.background = getUsageGradient(percentValue);
    }

    renderMonthStats();
    renderAllStats();
    renderEmployeeDetailStats();
}

function scheduleStatsRefresh() {
    if (isShareView) {
        return;
    }
    if (statsRefreshTimer) {
        clearTimeout(statsRefreshTimer);
    }
    statsRefreshTimer = setTimeout(() => {
        refreshStats().catch((error) => {
            console.warn('Stats refresh failed', error);
        });
    }, 500);
}

async function refreshStats() {
    if (isShareView) {
        statsCache = null;
        refreshStatsViews();
        return;
    }

    const weekValue = ensureWeekValue();
    if (!weekValue) {
        return;
    }

    try {
        const response = await fetch(`/api/stats?week=${encodeURIComponent(weekValue)}`, {
            credentials: 'include'
        });
        if (!response.ok) {
            let message = `Stats fetch failed: ${response.status}`;
            try {
                const errorData = await response.json();
                if (errorData?.error) {
                    message = errorData.error;
                }
            } catch (error) {
                // Ignore parse errors.
            }
            throw new Error(message);
        }

        statsCache = await response.json();
        lastStatsWeekValue = weekValue;
        refreshStatsViews();
        populateEmployeeDetailSelect();
        renderEmployeeDetailStats();
        updatePlanInputs();
    } catch (error) {
        console.warn('Failed to load stats', error);
        statsCache = null;
        refreshStatsViews();
        showBannerMessage('Не вдалося завантажити статистику.');
    }
}

function refreshStatsViews() {
    renderMonthStats();
    renderAllStats();
    renderEmployeeDetailStats();
}

function getEmployeeRowSnapshots() {
    return Array.from(document.querySelectorAll('.employee-row')).map((row) => {
        const nameEl = row.querySelector('.employee-name');
        const positionEl = row.querySelector('.employee-position');
        return {
            id: row.dataset.employeeId || '',
            clientId: row.dataset.clientId || '',
            name: nameEl ? nameEl.textContent.trim() : 'Працівник',
            position: positionEl ? positionEl.textContent.trim() : '',
            weekHours: parseFloat(row.dataset.totalHours || '0') || 0
        };
    });
}

function getEmployeeKey(employee) {
    if (employee.id) {
        return `id:${employee.id}`;
    }
    if (employee.clientId) {
        return `client:${employee.clientId}`;
    }
    return '';
}

function getEmployeeIdFromKey(value) {
    if (!value || typeof value !== 'string') {
        return '';
    }
    if (value.startsWith('id:')) {
        return value.slice(3);
    }
    return '';
}

function getStatsEmployeeMap() {
    const map = new Map();
    if (statsCache?.month?.employees) {
        statsCache.month.employees.forEach((employee) => {
            map.set(employee.id, {
                monthHours: normalizeNumberValue(employee.monthHours),
                planHours: normalizeNumberValue(employee.planHours),
                name: employee.name || '',
                position: employee.position || ''
            });
        });
    }
    if (statsCache?.all?.employees) {
        statsCache.all.employees.forEach((employee) => {
            const current = map.get(employee.id) || {};
            map.set(employee.id, {
                ...current,
                allHours: normalizeNumberValue(employee.hours),
                name: current.name || employee.name || '',
                position: current.position || employee.position || ''
            });
        });
    }
    return map;
}

function formatPercentValue(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return '0%';
    }
    const rounded = value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
    return `${rounded}%`;
}

function setInputValueIfIdle(input, value) {
    if (!input) return;
    if (document.activeElement === input) return;
    input.value = value;
}

function updatePlanInputs() {
    const monthPlanInput = document.getElementById('month-plan-total-input');
    if (monthPlanInput) {
        const monthPlanValue = statsCache?.month ? normalizeNumberValue(statsCache.month.planTotalHours) : 0;
        setInputValueIfIdle(monthPlanInput, formatHoursValue(monthPlanValue));
    }
    renderEmployeeDetailStats();
}

function renderMonthStats() {
    const totalEl = document.getElementById('total-month-hours');
    const planTotalEl = document.getElementById('month-plan-total');
    const percentEl = document.getElementById('month-plan-percent');
    const remainingEl = document.getElementById('month-plan-remaining');
    const barEl = document.getElementById('month-plan-bar');
    const body = document.getElementById('employee-plan-body');
    if (!totalEl || !body) return;

    if (!statsCache?.month) {
        totalEl.textContent = '0';
        if (planTotalEl) planTotalEl.textContent = '0';
        if (percentEl) percentEl.textContent = '0%';
        if (remainingEl) remainingEl.textContent = '0';
        if (barEl) barEl.style.width = '0%';
        body.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'employee-stats-empty';
        empty.textContent = 'Статистика місяця недоступна.';
        body.appendChild(empty);
        return;
    }

    const monthStats = statsCache.month;
    const monthTotal = normalizeNumberValue(monthStats.totalHours);
    const planTotal = normalizeNumberValue(monthStats.planTotalHours);
    const percentValue = planTotal > 0 ? (monthTotal / planTotal) * 100 : 0;
    const remaining = Math.max(planTotal - monthTotal, 0);

    totalEl.textContent = formatHoursValue(monthTotal);
    if (planTotalEl) planTotalEl.textContent = formatHoursValue(planTotal);
    if (percentEl) percentEl.textContent = formatPercentValue(percentValue);
    if (remainingEl) remainingEl.textContent = formatHoursValue(remaining);
    if (barEl) {
        const clamped = Math.max(0, Math.min(100, percentValue));
        barEl.style.width = `${clamped}%`;
        barEl.style.background = getUsageGradient(percentValue);
    }

    body.innerHTML = '';
    const employees = getEmployeeRowSnapshots();
    if (employees.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'employee-stats-empty';
        empty.textContent = 'Додайте працівників, щоб побачити статистику місяця.';
        body.appendChild(empty);
        return;
    }

    const statsMap = getStatsEmployeeMap();

    employees.forEach((employee) => {
        const stats = employee.id ? statsMap.get(employee.id) : null;
        const monthHours = stats ? normalizeNumberValue(stats.monthHours) : 0;
        const planHours = stats ? normalizeNumberValue(stats.planHours) : 0;
        const weekHours = normalizeNumberValue(employee.weekHours);
        const monthPercent = planHours > 0 ? (monthHours / planHours) * 100 : 0;
        const weekPercent = planHours > 0 ? (weekHours / planHours) * 100 : 0;
        const remainingHours = Math.max(planHours - monthHours, 0);

        const rowEl = document.createElement('div');
        rowEl.className = 'employee-plan-row';

        const nameCell = document.createElement('span');
        nameCell.textContent = employee.name;

        const positionCell = document.createElement('span');
        positionCell.textContent = employee.position || '—';

        const monthHoursCell = document.createElement('span');
        monthHoursCell.textContent = formatHoursValue(monthHours);

        const planHoursCell = document.createElement('span');
        planHoursCell.textContent = formatHoursValue(planHours);

        const monthPercentCell = document.createElement('span');
        monthPercentCell.textContent = formatPercentValue(monthPercent);

        const weekPercentCell = document.createElement('span');
        weekPercentCell.textContent = formatPercentValue(weekPercent);

        const remainingCell = document.createElement('span');
        remainingCell.textContent = formatHoursValue(remainingHours);

        rowEl.appendChild(nameCell);
        rowEl.appendChild(positionCell);
        rowEl.appendChild(monthHoursCell);
        rowEl.appendChild(planHoursCell);
        rowEl.appendChild(monthPercentCell);
        rowEl.appendChild(weekPercentCell);
        rowEl.appendChild(remainingCell);

        labelMobileStats(rowEl);
        body.appendChild(rowEl);
    });
}

function renderAllStats() {
    const totalEl = document.getElementById('total-all-hours');
    const averageEl = document.getElementById('average-all-hours');
    const body = document.getElementById('employee-all-body');
    if (!totalEl || !body) return;

    if (!statsCache?.all) {
        totalEl.textContent = '0';
        if (averageEl) averageEl.textContent = '0';
        body.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'employee-stats-empty';
        empty.textContent = 'Статистика за весь час недоступна.';
        body.appendChild(empty);
        return;
    }

    const allStats = statsCache.all;
    const allTotal = normalizeNumberValue(allStats.totalHours);
    const avgTotal = normalizeNumberValue(allStats.averageHours);

    totalEl.textContent = formatHoursValue(allTotal);
    if (averageEl) averageEl.textContent = formatHoursValue(avgTotal);

    body.innerHTML = '';
    const employees = getEmployeeRowSnapshots();
    if (employees.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'employee-stats-empty';
        empty.textContent = 'Додайте працівників, щоб побачити статистику.';
        body.appendChild(empty);
        return;
    }

    const statsMap = getStatsEmployeeMap();
    employees.forEach((employee) => {
        const stats = employee.id ? statsMap.get(employee.id) : null;
        const allHours = stats ? normalizeNumberValue(stats.allHours) : 0;

        const rowEl = document.createElement('div');
        rowEl.className = 'employee-plan-row compact';

        const nameCell = document.createElement('span');
        nameCell.textContent = employee.name;

        const positionCell = document.createElement('span');
        positionCell.textContent = employee.position || '—';

        const hoursCell = document.createElement('span');
        hoursCell.textContent = formatHoursValue(allHours);

        rowEl.appendChild(nameCell);
        rowEl.appendChild(positionCell);
        rowEl.appendChild(hoursCell);
        labelMobileStats(rowEl);
        body.appendChild(rowEl);
    });
}

function populateEmployeeDetailSelect() {
    const select = document.getElementById('employee-detail-select');
    if (!select) return;
    const employees = getEmployeeRowSnapshots();
    const previousValue = select.value;

    select.innerHTML = '';

    if (employees.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Немає працівників';
        select.appendChild(option);
        select.disabled = true;
        return;
    }

    employees.forEach((employee) => {
        const option = document.createElement('option');
        option.value = getEmployeeKey(employee);
        option.textContent = employee.position ? `${employee.name} — ${employee.position}` : employee.name;
        select.appendChild(option);
    });

    if (previousValue && Array.from(select.options).some(option => option.value === previousValue)) {
        select.value = previousValue;
    } else {
        select.selectedIndex = 0;
    }
    select.disabled = isShareView;
    lastChartEmployeeId = '';
}

function renderEmployeeDetailStats() {
    const select = document.getElementById('employee-detail-select');
    const weekEl = document.getElementById('employee-week-hours');
    const monthEl = document.getElementById('employee-month-hours');
    const allEl = document.getElementById('employee-all-hours');
    const planEl = document.getElementById('employee-plan-hours');
    const percentEl = document.getElementById('employee-plan-percent');
    const remainingEl = document.getElementById('employee-plan-remaining');
    const planInput = document.getElementById('employee-plan-input');
    const planSaveBtn = document.getElementById('employee-plan-save');
    if (!select || !weekEl || !monthEl || !allEl || !planEl || !percentEl || !remainingEl) return;

    const employees = getEmployeeRowSnapshots();
    if (employees.length === 0) {
        select.disabled = true;
        weekEl.textContent = '0';
        monthEl.textContent = '0';
        allEl.textContent = '0';
        planEl.textContent = '0';
        percentEl.textContent = '0%';
        remainingEl.textContent = '0';
        if (planInput) {
            planInput.value = '';
            planInput.disabled = true;
        }
        if (planSaveBtn) {
            planSaveBtn.disabled = true;
        }
        return;
    }

    select.disabled = isShareView;
    let selected = employees.find(employee => getEmployeeKey(employee) === select.value);
    if (!selected) {
        selected = employees[0];
        select.value = getEmployeeKey(selected);
    }

    const statsMap = getStatsEmployeeMap();
    const stats = selected.id ? statsMap.get(selected.id) : null;
    const weekHours = normalizeNumberValue(selected.weekHours);
    const monthHours = stats ? normalizeNumberValue(stats.monthHours) : 0;
    const allHours = stats ? normalizeNumberValue(stats.allHours) : 0;
    const planHours = stats ? normalizeNumberValue(stats.planHours) : 0;
    const percentValue = planHours > 0 ? (monthHours / planHours) * 100 : 0;
    const remainingHours = Math.max(planHours - monthHours, 0);

    weekEl.textContent = formatHoursValue(weekHours);
    monthEl.textContent = formatHoursValue(monthHours);
    allEl.textContent = formatHoursValue(allHours);
    planEl.textContent = formatHoursValue(planHours);
    percentEl.textContent = formatPercentValue(percentValue);
    remainingEl.textContent = formatHoursValue(remainingHours);

    if (planInput) {
        setInputValueIfIdle(planInput, formatHoursValue(planHours));
    }

    const canEdit = !isShareView && !!selected.id;
    if (planInput) {
        planInput.disabled = !canEdit;
    }
    if (planSaveBtn) {
        planSaveBtn.disabled = !canEdit;
    }

    loadEmployeeChart();
}

function setEmployeeChartRange(rangeValue) {
    if (![7, 14, 30].includes(rangeValue)) {
        return;
    }
    employeeChartRange = rangeValue;
    updateEmployeeChartRangeButtons();
    loadEmployeeChart();
}

function updateEmployeeChartRangeButtons() {
    document.querySelectorAll('.employee-chart-range').forEach((button) => {
        const rangeValue = parseInt(button.dataset.range, 10);
        button.classList.toggle('active', rangeValue === employeeChartRange);
    });
}

async function loadEmployeeChart() {
    const container = document.getElementById('employee-chart-bars');
    const select = document.getElementById('employee-detail-select');
    if (!container || !select) return;

    if (isShareView) {
        container.innerHTML = '<div class="employee-stats-empty">Графік недоступний у режимі перегляду.</div>';
        return;
    }

    const employeeId = getEmployeeIdFromKey(select.value);
    if (!employeeId) {
        container.innerHTML = '<div class="employee-stats-empty">Оберіть працівника, щоб побачити графік.</div>';
        return;
    }

    if (employeeId === lastChartEmployeeId && employeeChartRange === lastChartRange) {
        return;
    }

    lastChartEmployeeId = employeeId;
    lastChartRange = employeeChartRange;

    container.innerHTML = '<div class="employee-stats-empty">Завантаження...</div>';

    try {
        const response = await fetch(`/api/stats/employee?employeeId=${encodeURIComponent(employeeId)}&days=${employeeChartRange}`, {
            credentials: 'include'
        });
        if (!response.ok) {
            let message = `Chart load failed: ${response.status}`;
            try {
                const errorData = await response.json();
                if (errorData?.error) {
                    message = errorData.error;
                }
            } catch (error) {
                // Ignore parse errors.
            }
            throw new Error(message);
        }
        const data = await response.json();
        renderEmployeeChart(data?.days || []);
    } catch (error) {
        console.warn('Employee chart failed', error);
        container.innerHTML = '<div class="employee-stats-empty">Не вдалося завантажити графік.</div>';
    }
}

function renderEmployeeChart(days) {
    const container = document.getElementById('employee-chart-bars');
    if (!container) return;
    if (!Array.isArray(days) || days.length === 0) {
        container.innerHTML = '<div class="employee-stats-empty">Немає даних для графіка.</div>';
        return;
    }

    const maxHours = Math.max(...days.map(day => normalizeNumberValue(day.hours)), 1);
    const maxBarHeight = 120;
    const fragment = document.createDocumentFragment();

    days.forEach((day, index) => {
        const dateObj = new Date(`${day.date}T00:00:00`);
        const dayLabel = Number.isNaN(dateObj.getTime())
            ? String(index + 1)
            : String(dateObj.getDate());
        const monthLabel = Number.isNaN(dateObj.getTime())
            ? ''
            : `${String(dateObj.getDate()).padStart(2, '0')}.${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
        const hoursValue = normalizeNumberValue(day.hours);
        const heightPx = Math.max((hoursValue / maxHours) * maxBarHeight, hoursValue > 0 ? 6 : 2);

        const bar = document.createElement('div');
        bar.className = 'employee-chart-bar';
        bar.title = `${monthLabel || dayLabel}: ${formatHoursValue(hoursValue)} год`;

        const valueEl = document.createElement('span');
        valueEl.className = 'employee-chart-value';
        valueEl.textContent = formatHoursValue(hoursValue);

        const column = document.createElement('div');
        column.className = 'employee-chart-column';
        column.style.height = `${heightPx}px`;

        const label = document.createElement('span');
        label.className = 'employee-chart-label';
        label.textContent = dayLabel;

        bar.appendChild(valueEl);
        bar.appendChild(column);
        bar.appendChild(label);
        fragment.appendChild(bar);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
}

async function handleMonthPlanSave() {
    if (isShareView) {
        showBannerMessage('У режимі перегляду плани недоступні.');
        return;
    }
    const input = document.getElementById('month-plan-total-input');
    if (!input) return;
    const planValue = normalizeNumberValue(input.value);
    input.value = formatHoursValue(planValue);
    await savePlanSettings({ orgPlanHours: planValue });
}

async function handleEmployeePlanSave() {
    if (isShareView) {
        showBannerMessage('У режимі перегляду плани недоступні.');
        return;
    }
    const select = document.getElementById('employee-detail-select');
    const input = document.getElementById('employee-plan-input');
    if (!select || !input) return;

    const employeeId = getEmployeeIdFromKey(select.value);
    if (!employeeId) {
        showBannerMessage('Оберіть працівника зі списку.');
        return;
    }
    const planValue = normalizeNumberValue(input.value);
    input.value = formatHoursValue(planValue);
    await savePlanSettings({ employeeId, employeePlanHours: planValue });
}

async function savePlanSettings(payload) {
    try {
        const response = await fetch('/api/stats', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            let message = `Plan save failed: ${response.status}`;
            try {
                const errorData = await response.json();
                if (errorData?.error) {
                    message = errorData.error;
                }
            } catch (error) {
                // Ignore parse errors.
            }
            throw new Error(message);
        }
        await refreshStats();
        showBannerMessage('План оновлено.');
    } catch (error) {
        console.warn('Plan save failed', error);
        showBannerMessage('Не вдалося зберегти план.');
    }
}

function normalizeNumberValue(value) {
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return parsed;
}

function getUsageGradient(percent) {
    if (percent <= 104) {
        return 'linear-gradient(90deg, #4CAF50, #81C784)';
    }
    if (percent <= 110) {
        return 'linear-gradient(90deg, #FBC02D, #FFEB3B)';
    }
    return 'linear-gradient(90deg, #E53935, #FF7043)';
}

function initStatsTabs() {
    const tabs = document.querySelectorAll('.stats-tab');
    const panels = document.querySelectorAll('.stats-panel');
    if (tabs.length === 0) return;

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.stats;

            tabs.forEach(btn => btn.classList.toggle('active', btn === tab));
            panels.forEach(panel => {
                panel.classList.toggle('active', panel.dataset.stats === target);
            });

            if (target === 'month' || target === 'all' || target === 'employee') {
                const weekValue = ensureWeekValue();
                if (!statsCache || (weekValue && lastStatsWeekValue !== weekValue)) {
                    refreshStats().catch((error) => {
                        console.warn('Stats refresh failed', error);
                    });
                } else {
                    refreshStatsViews();
                }
            }
        });
    });
}

function renderTimelineScale(range) {
    const scale = document.getElementById('timeline-scale');
    if (!scale) return;

    scale.innerHTML = '';

    const start = Math.max(0, Math.min(range?.startMinutes ?? 0, 24 * 60));
    let end = Math.min(24 * 60, Math.max(range?.endMinutes ?? 24 * 60, start + 60));
    if (end <= start) {
        end = Math.min(24 * 60, start + 60);
    }

    const duration = Math.max(end - start, 60);
    const startHour = Math.floor(start / 60);
    const endHour = Math.ceil(end / 60);

    for (let hour = startHour; hour <= endHour; hour++) {
        const mark = document.createElement('div');
        const minutes = hour * 60;
        const percent = ((minutes - start) / duration) * 100;
        if (percent < -5 || percent > 105) continue;
        const clamped = Math.min(Math.max(percent, 0), 100);
        mark.className = 'scale-mark';
        mark.style.left = `${clamped}%`;
        if (clamped < 1) {
            mark.style.transform = 'translateX(0)';
        } else if (clamped > 99) {
            mark.style.transform = 'translateX(-100%)';
        }
        mark.textContent = `${hour.toString().padStart(2, '0')}:00`;
        scale.appendChild(mark);
    }
}

function updateTimeline(forceIndex = null, forceDate = null) {
    const body = document.getElementById('timeline-body');
    const labelEl = document.getElementById('timeline-day-label');
    if (!body || !labelEl) return;

    if (forceDate instanceof Date && !Number.isNaN(forceDate)) {
        setTimelineSelectedDate(forceDate);
    }

    if (typeof forceIndex === 'number' && !Number.isNaN(forceIndex)) {
        currentTimelineDayIndex = forceIndex;
        lastEditedDayIndex = forceIndex;
        if (currentWeekDates[forceIndex]) {
            setTimelineSelectedDate(currentWeekDates[forceIndex]);
        }
    }

    let selectedDate = timelineSelectedDate;

    if (!selectedDate && currentWeekDates.length === 7) {
        const defaultIndex = getDefaultTimelineDayIndex();
        if (!Number.isNaN(defaultIndex) && currentWeekDates[defaultIndex]) {
            setTimelineSelectedDate(currentWeekDates[defaultIndex]);
            currentTimelineDayIndex = defaultIndex;
            lastEditedDayIndex = null;
            selectedDate = timelineSelectedDate;
        }
    }

    let dayIndex = -1;
    if (selectedDate && currentWeekDates.length === 7) {
        dayIndex = currentWeekDates.findIndex(d => isSameDay(d, selectedDate));
    }

    const dateInput = document.getElementById('timeline-date');
    syncTimelineDateInput(selectedDate);

    const isDateInWeek = dayIndex !== -1;
    if (isDateInWeek) {
        currentTimelineDayIndex = dayIndex;
        lastEditedDayIndex = dayIndex;
    }

    let displayDate = selectedDate;
    if (!displayDate && isDateInWeek && currentWeekDates[dayIndex]) {
        displayDate = currentWeekDates[dayIndex];
    }

    body.innerHTML = '';

    if (!displayDate) {
        renderTimelineScale({ startMinutes: 0, endMinutes: 24 * 60 });
        labelEl.textContent = 'Дата не вибрана';
        const empty = document.createElement('div');
        empty.className = 'timeline-empty';
        empty.textContent = 'Оберіть дату, щоб побачити таймлайн.';
        body.appendChild(empty);
        return;
    }

    const dayName = getDayNameFromDate(displayDate);
    const dateLabel = formatDisplayDate(displayDate);
    labelEl.textContent = isDateInWeek
        ? `${dateLabel} · ${dayName}`
        : `${dateLabel} · ${dayName} (поза поточним тижнем)`;

    if (!isDateInWeek) {
        renderTimelineScale({ startMinutes: 0, endMinutes: 24 * 60 });
        const info = document.createElement('div');
        info.className = 'timeline-empty';
        info.textContent = 'Дата не входить до поточного тижня. Оновіть тиждень або виберіть іншу дату.';
        body.appendChild(info);
        return;
    }

    const rows = Array.from(document.querySelectorAll('.employee-row'));
    const segmentsByEmployee = [];
    let minStart = Infinity;
    let maxEnd = -Infinity;

    rows.forEach(row => {
        const dayCells = row.querySelectorAll('.day-cell');
        const cell = dayCells[dayIndex];
        if (!cell || cell.classList.contains('is-locked')) return;

        const segments = extractShiftsFromCell(cell);
        if (segments.length === 0) return;

        segments.forEach(segment => {
            minStart = Math.min(minStart, segment.startMinutes);
            maxEnd = Math.max(maxEnd, segment.endMinutes);
        });

        segmentsByEmployee.push({ row, segments });
    });

    if (segmentsByEmployee.length === 0) {
        renderTimelineScale({ startMinutes: 0, endMinutes: 24 * 60 });
        const empty = document.createElement('div');
        empty.className = 'timeline-empty';
        empty.textContent = 'Немає запланованих змін на цей день';
        body.appendChild(empty);
        return;
    }

    let startRange = Math.max(0, Math.floor(minStart / 60) * 60 - 60);
    let endRange = Math.min(24 * 60, Math.ceil(maxEnd / 60) * 60 + 60);
    if (endRange <= startRange) {
        endRange = Math.min(24 * 60, startRange + 60);
    }
    const rangeDuration = Math.max(endRange - startRange, 60);

    renderTimelineScale({ startMinutes: startRange, endMinutes: endRange });

    segmentsByEmployee.forEach(({ row, segments }) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'timeline-row';

        const employeeInfo = document.createElement('div');
        employeeInfo.className = 'timeline-employee';
        const name = row.querySelector('.employee-name') ? row.querySelector('.employee-name').textContent : '';
        const position = row.querySelector('.employee-position') ? row.querySelector('.employee-position').textContent : '';
        const timelineName = document.createElement('div');
        timelineName.className = 'name';
        timelineName.textContent = name;
        employeeInfo.appendChild(timelineName);
        if (position) {
            const timelinePosition = document.createElement('div');
            timelinePosition.className = 'position';
            timelinePosition.textContent = position;
            employeeInfo.appendChild(timelinePosition);
        }

        const track = document.createElement('div');
        track.className = 'timeline-track';

        segments.forEach(segment => {
            const adjustedStart = Math.max(segment.startMinutes, startRange);
            const adjustedEnd = Math.min(segment.endMinutes, endRange);
            if (adjustedEnd <= adjustedStart) return;

            const startPercent = ((adjustedStart - startRange) / rangeDuration) * 100;
            const widthPercent = Math.max(((adjustedEnd - adjustedStart) / rangeDuration) * 100, 1.5);

            const segEl = document.createElement('div');
            segEl.className = `timeline-segment ${segment.type}`;
            const leftPercent = Math.min(Math.max(startPercent, 0), 100);
            const maxWidth = Math.max(0, 100 - leftPercent);
            const finalWidth = Math.min(widthPercent, maxWidth);
            if (finalWidth <= 0) return;
            segEl.style.left = `${leftPercent}%`;
            segEl.style.width = `${finalWidth}%`;
            segEl.textContent = segment.label;
            track.appendChild(segEl);
        });

        rowEl.appendChild(employeeInfo);
        rowEl.appendChild(track);
        labelMobileStats(rowEl);
        body.appendChild(rowEl);
    });
}

function noteEditedDayFromInput(input) {
    const dayCell = input.closest('.day-cell');
    noteEditedDayFromCell(dayCell, { triggerTimeline: true });
}

function noteEditedDayFromCell(dayCell, options = {}) {
    if (!dayCell) return;
    const index = parseInt(dayCell.dataset.dayIndex || '-1', 10);
    if (Number.isNaN(index) || index < 0 || index > 6) return;
    lastEditedDayIndex = index;
    currentTimelineDayIndex = index;
    if (currentWeekDates[index]) {
        setTimelineSelectedDate(currentWeekDates[index], { skipInputSync: !!options.skipInputSync });
    }
    if (options.triggerTimeline) {
        updateTimeline(index);
    }
}

function extractShiftsFromCell(cell) {
    const segments = [];
    const primaryInput = cell.querySelector('.time-input[data-shift-type="primary"]');
    const secondaryInput = cell.querySelector('.time-input[data-shift-type="secondary"]');

    const primaryRange = parseShiftRange(primaryInput ? primaryInput.value : '');
    if (primaryRange) {
        segments.push({
            type: 'primary',
            startMinutes: primaryRange.startMinutes,
            endMinutes: primaryRange.endMinutes,
            durationMinutes: primaryRange.durationMinutes,
            label: `${formatTimeForTimeline(primaryRange.startTime)} – ${formatTimeForTimeline(primaryRange.endTime)}`
        });
    }

    const secondaryRange = parseShiftRange(secondaryInput ? secondaryInput.value : '');
    if (secondaryRange) {
        segments.push({
            type: 'secondary',
            startMinutes: secondaryRange.startMinutes,
            endMinutes: secondaryRange.endMinutes,
            durationMinutes: secondaryRange.durationMinutes,
            label: `${formatTimeForTimeline(secondaryRange.startTime)} – ${formatTimeForTimeline(secondaryRange.endTime)}`
        });
    }

    return segments.sort((a, b) => a.startMinutes - b.startMinutes);
}

function setTimelineSelectedDate(date, options = {}) {
    if (date && !Number.isNaN(date.getTime())) {
        timelineSelectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    } else {
        timelineSelectedDate = null;
    }

    if (!options.skipInputSync) {
        syncTimelineDateInput(timelineSelectedDate);
    }
}

function syncTimelineDateInput(date) {
    const input = document.getElementById('timeline-date');
    if (!input) return;
    const newValue = date ? formatDateISO(date) : '';
    if (input.value !== newValue) {
        input.value = newValue;
    }
}

function formatDateISO(date) {
    if (!date) return '';
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDisplayDate(date) {
    if (!date) return '';
    const day = date.getDate();
    const monthName = MONTH_NAMES[date.getMonth()] || '';
    return `${day} ${monthName}`;
}

function parseDateInputValue(value) {
    if (!value) return null;
    const parts = value.split('-');
    if (parts.length !== 3) return null;
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const day = Number(parts[2]);
    if ([year, month, day].some(Number.isNaN)) return null;
    return new Date(year, month, day);
}

function handleTimelineDateChange(event) {
    const value = event.target.value;
    if (!value) {
        if (currentWeekDates.length === 7) {
            const defaultIndex = getDefaultTimelineDayIndex();
            if (!Number.isNaN(defaultIndex) && currentWeekDates[defaultIndex]) {
                setTimelineSelectedDate(currentWeekDates[defaultIndex]);
                updateTimeline(defaultIndex);
                return;
            }
        }
        setTimelineSelectedDate(null);
        updateTimeline();
        return;
    }

    const selected = parseDateInputValue(value);
    if (!selected) return;

    setTimelineSelectedDate(selected);
    if (currentWeekDates.length === 7) {
        const index = currentWeekDates.findIndex(d => isSameDay(d, selected));
        if (index !== -1) {
            updateTimeline(index);
            return;
        }
    }

    updateTimeline(null, selected);
}

function toggleTimelineVisibility() {
    const container = document.querySelector('.timeline-container');
    const toggleBtn = document.getElementById('timeline-toggle');
    if (!container || !toggleBtn) return;
    const collapsed = container.classList.toggle('is-collapsed');
    toggleBtn.textContent = collapsed ? 'Показати' : 'Сховати';
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
}

function getDayNameFromDate(date) {
    const jsDay = date.getDay();
    const index = (jsDay + 6) % 7;
    return DAY_NAMES[index] || DAY_NAMES[0];
}

function parseShiftRange(value) {
    if (!value) return null;
    const parts = value.split('-');
    if (parts.length !== 2) return null;

    const startTime = parseTimeString(parts[0]);
    const endTime = parseTimeString(parts[1]);

    if (!startTime || !endTime) return null;

    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);

    if (endMinutes <= startMinutes) return null;

    return {
        startTime,
        endTime,
        startMinutes,
        endMinutes,
        durationMinutes: endMinutes - startMinutes
    };
}

function formatTimeForTimeline(time) {
    return `${time.hour.toString().padStart(2, '0')}:${time.minute.toString().padStart(2, '0')}`;
}

function getDefaultTimelineDayIndex() {
    if (!currentWeekDates || currentWeekDates.length !== 7) {
        return 0;
    }
    const today = new Date();
    for (let i = 0; i < currentWeekDates.length; i++) {
        if (isSameDay(currentWeekDates[i], today)) {
            return i;
        }
    }
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    for (let i = 0; i < currentWeekDates.length; i++) {
        if (isSameDay(currentWeekDates[i], tomorrow)) {
            return i;
        }
    }
    return 0;
}

function isSameDay(dateA, dateB) {
    return dateA.getFullYear() === dateB.getFullYear() &&
        dateA.getMonth() === dateB.getMonth() &&
        dateA.getDate() === dateB.getDate();
}

// Сповіщення
function showNotification(message) {
    const notification = document.getElementById('limit-alerts');
    if (!notification) return;
    notification.innerHTML = '';
    const lines = String(message || '').split('\n').filter(Boolean);
    lines.forEach(text => {
        const item = document.createElement('div');
        item.className = 'limit-alert';
        item.textContent = text;
        notification.appendChild(item);
    });
    notification.classList.add('active');
    notification.setAttribute('aria-hidden', 'false');
    setTimeout(hideNotification, 5000);
}

function hideNotification() {
    const notification = document.getElementById('limit-alerts');
    if (!notification) return;
    notification.classList.remove('active');
    notification.setAttribute('aria-hidden', 'true');
}

// Експорт
async function exportSchedule(format) {
    if (typeof html2canvas === 'undefined' || (format === 'pdf' && typeof html2pdf === 'undefined')) {
        showBannerMessage('Експорт ще завантажується. Спробуйте ще раз за кілька секунд.');
        return;
    }
    const clone = document.querySelector('.container').cloneNode(true);
    clone.classList.add('export-snapshot');
    clone.style.cssText = 'width:1400px;max-width:none;background:white;';
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;left:-20000px;top:0;width:1400px;';
    holder.appendChild(clone);
    clone.querySelectorAll('.controls, .add-employee, .table-hint, .mobile-day-picker').forEach(el => el.remove());
    document.body.appendChild(holder);
    try {
        if (format === 'pdf') {
            await html2pdf().set({ margin: 8, filename: 'work_schedule.pdf', image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, windowWidth: 1440 }, jsPDF: { unit: 'mm', format: 'a3', orientation: 'landscape' } }).from(clone).save();
        } else {
            downloadImage(await html2canvas(clone, { scale: 2, windowWidth: 1440, logging: false, useCORS: true }));
        }
    } catch {
        showBannerMessage('Не вдалося експортувати графік. Спробуйте ще раз.');
    } finally {
        holder.remove();
    }
}
function exportToPDF() { return exportSchedule('pdf'); }
function exportToJPG() { return exportSchedule('jpg'); }

function downloadImage(canvas) {
    const link = document.createElement('a');
    link.download = 'work_schedule.jpg';
    link.href = canvas.toDataURL('image/jpeg', 0.9);
    link.click();
}
function getTodayWeekdayIndex() {
    const today = new Date();
    return (today.getDay() + 6) % 7;
}

function ensureWeekValue() {
    const weekInput = document.getElementById('week');
    if (!weekInput) return '';
    let value = weekInput.value;
    if (!value || !value.includes('-W')) {
        value = getCurrentWeekValue();
        weekInput.value = value;
        localStorage.setItem('workScheduleWeek', value);
    }
    return value;
}

function getCurrentWeekValue() {
    const today = new Date();
    const [year, weekNum] = getWeekNumber(today);
    if (!Number.isInteger(year) || !Number.isInteger(weekNum)) return '';
    return `${year}-W${weekNum.toString().padStart(2, '0')}`;
}

const LZ = (function() {
    const f = String.fromCharCode;
    const keyStrUriSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
    const baseReverseDic = {};

    function getBaseValue(alphabet, character) {
        if (!baseReverseDic[alphabet]) {
            baseReverseDic[alphabet] = {};
            for (let i = 0; i < alphabet.length; i++) {
                baseReverseDic[alphabet][alphabet.charAt(i)] = i;
            }
        }
        return baseReverseDic[alphabet][character];
    }

    function compressToBase62(input) {
        if (input == null) return '';
        let i, value,
            context_dictionary = {},
            context_dictionaryToCreate = {},
            context_c = '',
            context_wc = '',
            context_w = '',
            context_enlargeIn = 2,
            context_dictSize = 3,
            context_numBits = 2,
            context_data = [],
            context_data_val = 0,
            context_data_position = 0,
            ii;

        const getCharFromInt = function(a) {
            return keyStrUriSafe.charAt(a);
        };

        for (ii = 0; ii < input.length; ii += 1) {
            context_c = input.charAt(ii);
            if (!Object.prototype.hasOwnProperty.call(context_dictionary, context_c)) {
                context_dictionary[context_c] = context_dictSize++;
                context_dictionaryToCreate[context_c] = true;
            }
            context_wc = context_w + context_c;
            if (Object.prototype.hasOwnProperty.call(context_dictionary, context_wc)) {
                context_w = context_wc;
            } else {
                if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                    if (context_w.charCodeAt(0) < 256) {
                        for (i = 0; i < context_numBits; i++) {
                            context_data_val <<= 1;
                            if (context_data_position === 5) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else {
                                context_data_position++;
                            }
                        }
                        value = context_w.charCodeAt(0);
                        for (i = 0; i < 8; i++) {
                            context_data_val = (context_data_val << 1) | (value & 1);
                            if (context_data_position === 5) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else {
                                context_data_position++;
                            }
                            value >>= 1;
                        }
                    } else {
                        value = 1;
                        for (i = 0; i < context_numBits; i++) {
                            context_data_val = (context_data_val << 1) | value;
                            if (context_data_position === 5) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else {
                                context_data_position++;
                            }
                            value = 0;
                        }
                        value = context_w.charCodeAt(0);
                        for (i = 0; i < 16; i++) {
                            context_data_val = (context_data_val << 1) | (value & 1);
                            if (context_data_position === 5) {
                                context_data_position = 0;
                                context_data.push(getCharFromInt(context_data_val));
                                context_data_val = 0;
                            } else {
                                context_data_position++;
                            }
                            value >>= 1;
                        }
                    }
                    context_enlargeIn--;
                    if (context_enlargeIn === 0) {
                        context_enlargeIn = Math.pow(2, context_numBits);
                        context_numBits++;
                    }
                    delete context_dictionaryToCreate[context_w];
                } else {
                    value = context_dictionary[context_w];
                    for (i = 0; i < context_numBits; i++) {
                        context_data_val = (context_data_val << 1) | (value & 1);
                        if (context_data_position === 5) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                        value >>= 1;
                    }
                }
                context_enlargeIn--;
                if (context_enlargeIn === 0) {
                    context_enlargeIn = Math.pow(2, context_numBits);
                    context_numBits++;
                }
                context_dictionary[context_wc] = context_dictSize++;
                context_w = String(context_c);
            }
        }

        if (context_w !== '') {
            if (Object.prototype.hasOwnProperty.call(context_dictionaryToCreate, context_w)) {
                if (context_w.charCodeAt(0) < 256) {
                    for (i = 0; i < context_numBits; i++) {
                        context_data_val <<= 1;
                        if (context_data_position === 5) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                    }
                    value = context_w.charCodeAt(0);
                    for (i = 0; i < 8; i++) {
                        context_data_val = (context_data_val << 1) | (value & 1);
                        if (context_data_position === 5) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                        value >>= 1;
                    }
                } else {
                    value = 1;
                    for (i = 0; i < context_numBits; i++) {
                        context_data_val = (context_data_val << 1) | value;
                        if (context_data_position === 5) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                        value = 0;
                    }
                    value = context_w.charCodeAt(0);
                    for (i = 0; i < 16; i++) {
                        context_data_val = (context_data_val << 1) | (value & 1);
                        if (context_data_position === 5) {
                            context_data_position = 0;
                            context_data.push(getCharFromInt(context_data_val));
                            context_data_val = 0;
                        } else {
                            context_data_position++;
                        }
                        value >>= 1;
                    }
                }
                context_enlargeIn--;
                if (context_enlargeIn === 0) {
                    context_enlargeIn = Math.pow(2, context_numBits);
                    context_numBits++;
                }
                delete context_dictionaryToCreate[context_w];
            } else {
                value = context_dictionary[context_w];
                for (i = 0; i < context_numBits; i++) {
                    context_data_val = (context_data_val << 1) | (value & 1);
                    if (context_data_position === 5) {
                        context_data_position = 0;
                        context_data.push(getCharFromInt(context_data_val));
                        context_data_val = 0;
                    } else {
                        context_data_position++;
                    }
                    value >>= 1;
                }
            }
            context_enlargeIn--;
            if (context_enlargeIn === 0) {
                context_enlargeIn = Math.pow(2, context_numBits);
                context_numBits++;
            }
        }

        value = 2;
        for (i = 0; i < context_numBits; i++) {
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === 5) {
                context_data_position = 0;
                context_data.push(getCharFromInt(context_data_val));
                context_data_val = 0;
            } else {
                context_data_position++;
            }
            value >>= 1;
        }

        while (true) {
            context_data_val <<= 1;
            if (context_data_position === 5) {
                context_data.push(getCharFromInt(context_data_val));
                break;
            } else {
                context_data_position++;
            }
        }

        return context_data.join('');
    }

    function decompressFromBase62(input) {
        if (input == null) return '';
        if (input === '') return null;
        let dictionary = [],
            next,
            enlargeIn = 4,
            dictSize = 4,
            numBits = 3,
            entry = '',
            result = [],
            i,
            w,
            bits, resb, maxpower, power,
            c,
            data = { val: getBaseValue(keyStrUriSafe, input.charAt(0)), position: 32, index: 1 };

        const getNextValue = function() {
            if (data.index > input.length) {
                return 0;
            }
            const value = getBaseValue(keyStrUriSafe, input.charAt(data.index));
            data.index++;
            return value;
        };

        for (i = 0; i < 3; i += 1) {
            dictionary[i] = i;
        }

        bits = 0;
        maxpower = Math.pow(2, 2);
        power = 1;
        while (power !== maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position === 0) {
                data.position = 32;
                data.val = getNextValue();
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
        }

        switch (next = bits) {
            case 0:
                bits = 0;
                maxpower = Math.pow(2, 8);
                power = 1;
                while (power !== maxpower) {
                    resb = data.val & data.position;
                    data.position >>= 1;
                    if (data.position === 0) {
                        data.position = 32;
                        data.val = getNextValue();
                    }
                    bits |= (resb > 0 ? 1 : 0) * power;
                    power <<= 1;
                }
                c = f(bits);
                break;
            case 1:
                bits = 0;
                maxpower = Math.pow(2, 16);
                power = 1;
                while (power !== maxpower) {
                    resb = data.val & data.position;
                    data.position >>= 1;
                    if (data.position === 0) {
                        data.position = 32;
                        data.val = getNextValue();
                    }
                    bits |= (resb > 0 ? 1 : 0) * power;
                    power <<= 1;
                }
                c = f(bits);
                break;
            case 2:
                return '';
        }

        dictionary[3] = c;
        w = c;
        result.push(c);
        while (true) {
            if (data.index > input.length) {
                return '';
            }

            bits = 0;
            maxpower = Math.pow(2, numBits);
            power = 1;
            while (power !== maxpower) {
                resb = data.val & data.position;
                data.position >>= 1;
                if (data.position === 0) {
                    data.position = 32;
                    data.val = getNextValue();
                }
                bits |= (resb > 0 ? 1 : 0) * power;
                power <<= 1;
            }

            switch (c = bits) {
                case 0:
                    bits = 0;
                    maxpower = Math.pow(2, 8);
                    power = 1;
                    while (power !== maxpower) {
                        resb = data.val & data.position;
                        data.position >>= 1;
                        if (data.position === 0) {
                            data.position = 32;
                            data.val = getNextValue();
                        }
                        bits |= (resb > 0 ? 1 : 0) * power;
                        power <<= 1;
                    }

                    dictionary[dictSize++] = f(bits);
                    c = dictSize - 1;
                    enlargeIn--;
                    break;
                case 1:
                    bits = 0;
                    maxpower = Math.pow(2, 16);
                    power = 1;
                    while (power !== maxpower) {
                        resb = data.val & data.position;
                        data.position >>= 1;
                        if (data.position === 0) {
                            data.position = 32;
                            data.val = getNextValue();
                        }
                        bits |= (resb > 0 ? 1 : 0) * power;
                        power <<= 1;
                    }
                    dictionary[dictSize++] = f(bits);
                    c = dictSize - 1;
                    enlargeIn--;
                    break;
                case 2:
                    return result.join('');
            }

            if (enlargeIn === 0) {
                enlargeIn = Math.pow(2, numBits);
                numBits++;
            }

            if (dictionary[c]) {
                entry = dictionary[c];
            } else {
                if (c === dictSize) {
                    entry = w + w.charAt(0);
                } else {
                    return null;
                }
            }
            result.push(entry);

            dictionary[dictSize++] = w + entry.charAt(0);
            enlargeIn--;

            w = entry;

            if (enlargeIn === 0) {
                enlargeIn = Math.pow(2, numBits);
                numBits++;
            }
        }
    }

    return {
        compressToEncodedURIComponent: compressToBase62,
        decompressFromEncodedURIComponent: decompressFromBase62
    };
})();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}
