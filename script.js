document.addEventListener('DOMContentLoaded', function() {
    // Ініціалізація додатку
    initApp();
});

let cachedDayTotals = new Array(7).fill(0);
let cachedDayLimits = new Array(7).fill(0);
let currentWeekDates = [];
let currentTimelineDayIndex = null;
let lastEditedDayIndex = null;
let timelineSelectedDate = null;
let isShareView = false;
let shareBannerTimer = null;
let lastGeneratedShareUrl = '';
let shareLinkExpanded = false;
let lastShareEmployeeCount = 0;

const DAY_NAMES = ['Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота', 'Неділя'];
const MONTH_NAMES = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
function initApp() {
    setCurrentWeek();
    setupEventListeners();
    syncShareWeekInput();
    const shareApplied = loadScheduleFromShareHash();

    if (!shareApplied) {
        loadSavedData();
        applyCurrentWeekSelection();
    }

    updateWeekDates();
    calculateAllHours();
    syncShareWeekInput();

    if (shareApplied) {
        applyShareViewMode();
    }
}

// Збереження даних
function saveData() {
    if (isShareView) {
        return;
    }
    const data = {
        employees: getEmployeesData(),
        week: document.getElementById('week').value,
        limits: getLimitsData()
    };
    localStorage.setItem('workScheduleData', JSON.stringify(data));
    if (data.week) {
        localStorage.setItem('workScheduleWeek', data.week);
    }
}

function loadSavedData() {
    const savedData = localStorage.getItem('workScheduleData');
    if (savedData) {
        let data = null;
        try {
            data = JSON.parse(savedData);
        } catch (error) {
            console.warn('Не вдалося прочитати збережений розклад', error);
            localStorage.removeItem('workScheduleData');
            localStorage.removeItem('workScheduleWeek');
            addExampleEmployees();
            return;
        }
        if (!data || typeof data !== 'object') {
            addExampleEmployees();
            return;
        }

        const weekInput = document.getElementById('week');
        if (weekInput && data.week) {
            weekInput.value = data.week;
        }
        
        if (data.limits) {
            setLimitsData(data.limits);
        }
        
        if (data.employees && data.employees.length > 0) {
            renderEmployeesFromSnapshot(data.employees, { skipSave: true });
            return;
        }
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
    employees.forEach(emp => {
        addEmployee(
            emp.name || 'Працівник',
            emp.schedule || [],
            false,
            emp.position || '',
            Object.assign({}, options, { container: fragment, deferMetrics: true })
        );
    });
    container.appendChild(fragment);
    calculateAllHours();
    if (!options.skipSave) {
        saveData();
    }
}

function getEmployeesData() {
    const employees = [];
    document.querySelectorAll('.employee-row').forEach(row => {
        const name = row.querySelector('.employee-name').textContent;
        const position = row.querySelector('.employee-position') ? row.querySelector('.employee-position').textContent : '';
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
        employees.push({ name, position, schedule });
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
            saveData();
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

    initStatsTabs();
}

function addExampleEmployees() {
    
    saveData();
}

function syncShareWeekInput() {
    const shareWeekInput = document.getElementById('share-week');
    const weekInput = document.getElementById('week');
    if (shareWeekInput && weekInput) {
        shareWeekInput.value = weekInput.value || '';
    }
}

function handleShareSubmit(event) {
    event.preventDefault();
    if (isShareView) {
        showBannerMessage('У режимі перегляду неможливо створити нове посилання.');
        return;
    }

    saveData();

    const shareWeekInput = document.getElementById('share-week');
    const weekInput = document.getElementById('week');
    const targetWeek = (shareWeekInput && shareWeekInput.value) ? shareWeekInput.value : (weekInput ? weekInput.value : '');
    const resultEl = document.getElementById('share-result');

    if (!targetWeek) {
        if (resultEl) {
            resultEl.textContent = 'Оберіть тиждень для генерації посилання.';
            resultEl.classList.remove('hidden');
        }
        showBannerMessage('Оберіть тиждень перед генерацією посилання.');
        return;
    }

    const snapshot = buildScheduleSnapshot();
    lastShareEmployeeCount = Array.isArray(snapshot.employees) ? snapshot.employees.length : 0;

    const payload = {
        week: targetWeek,
        generatedAt: new Date().toISOString(),
        data: snapshot
    };

    let encoded;
    try {
        encoded = encodeShareData(payload);
    } catch (error) {
        console.warn('Не вдалося сформувати дані для посилання', error);
        showBannerMessage('Не вдалося сформувати посилання.');
        return;
    }

    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    const shareUrl = `${baseUrl}#share=${encoded}`;

    lastGeneratedShareUrl = shareUrl;
    shareLinkExpanded = false;
    renderShareResult();

    showBannerMessage('Посилання для перегляду готове.');
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
    const stored = readStoredScheduleData();
    const current = {
        limits: getLimitsData(),
        employees: getEmployeesData()
    };

    const storedCount = stored && Array.isArray(stored.employees) ? stored.employees.length : 0;
    const currentCount = Array.isArray(current.employees) ? current.employees.length : 0;
    const source = stored && storedCount >= currentCount ? stored : current;

    if (!source || !Array.isArray(source.employees)) {
        return sanitizeSnapshot(current);
    }

    if (source === stored && currentCount > storedCount) {
        // Перевага надається актуальному DOM, якщо в ньому більше працівників.
        source.employees = current.employees;
    }

    return sanitizeSnapshot(source);
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

    return { name, position, schedule: normalizedSchedule };
}

function readStoredScheduleData() {
    try {
        const raw = localStorage.getItem('workScheduleData');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }
        return {
            limits: Array.isArray(parsed.limits) ? parsed.limits : [],
            employees: Array.isArray(parsed.employees) ? parsed.employees : [],
            week: typeof parsed.week === 'string' ? parsed.week : null
        };
    } catch (error) {
        console.warn('Не вдалося прочитати збережений розклад', error);
        return null;
    }
}

function renderShareResult() {
    const resultEl = document.getElementById('share-result');
    if (!resultEl || !lastGeneratedShareUrl) {
        return;
    }

    const shortLink = getShortShareLink(lastGeneratedShareUrl);
    const displayLink = shareLinkExpanded ? lastGeneratedShareUrl : shortLink;
    const employeeCountText = lastShareEmployeeCount > 0
        ? `Працівників у розкладі: ${lastShareEmployeeCount}`
        : 'Працівників у розкладі: дані відсутні';

    const linkHtml = `<a href="${lastGeneratedShareUrl}" target="_blank" rel="noopener">${displayLink}</a>`;

    resultEl.innerHTML = [
        '<div class="share-result-content">',
        `<div class="share-result-line"><span class="share-result-label">Посилання:</span><span class="share-result-link${shareLinkExpanded ? ' is-expanded' : ''}">${linkHtml}</span></div>`,
        `<div class="share-result-meta">${employeeCountText}</div>`,
        '<div class="share-result-actions">',
        `<button type="button" class="ghost-btn share-toggle-link" data-action="toggle-link">${shareLinkExpanded ? 'Сховати посилання' : 'Показати повністю'}</button>`,
        '<button type="button" class="primary-btn share-copy-link" data-action="copy-link">Скопіювати посилання</button>',
        '<button type="button" class="ghost-btn share-download-qr" data-action="download-qr">Завантажити QR</button>',
        '</div>',
        '</div>'
    ].join('');
    resultEl.classList.remove('hidden');

    const toggleBtn = resultEl.querySelector('[data-action="toggle-link"]');
    const copyBtn = resultEl.querySelector('[data-action="copy-link"]');
    const downloadBtn = resultEl.querySelector('[data-action="download-qr"]');

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            shareLinkExpanded = !shareLinkExpanded;
            renderShareResult();
        });
    }

    if (copyBtn) {
        copyBtn.addEventListener('click', copyShareLink);
    }

    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadShareQr);
    }

}

function getShortShareLink(url) {
    if (!url || url.length <= 60) {
        return url;
    }
    const start = url.slice(0, 32);
    const end = url.slice(-16);
    return `${start}...${end}`;
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
        showBannerMessage('Некоректне посилання спільного доступу.');
        return false;
    }

    let payload;
    try {
        payload = decodeShareData(encoded);
    } catch (error) {
        console.warn('Не вдалося декодувати розклад зі спільного посилання', error);
        showBannerMessage('Некоректне посилання спільного доступу.');
        return false;
    }

    if (!payload || typeof payload !== 'object' || !payload.data || !Array.isArray(payload.data.employees)) {
        showBannerMessage('Посилання не містить графіку.');
        return false;
    }

    const weekInput = document.getElementById('week');
    if (weekInput && payload.week) {
        weekInput.value = payload.week;
        updateWeekDates();
        syncShareWeekInput();
    }

    const snapshot = sanitizeSnapshot(payload.data);

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
    
    target.appendChild(employeeRow);
    
    if (!options.deferMetrics) {
        calculateAllHours();
    }
    
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
        this.closest('.employee-row').remove();
        calculateAllHours();
        saveData();
    });

    labelCell.appendChild(infoWrapper);
    actionsWrapper.appendChild(editBtn);
    actionsWrapper.appendChild(deleteBtn);
    labelCell.appendChild(actionsWrapper);

    return labelCell;
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
    if (time.minute === 0) {
        return `${time.hour}`;
    }
    return `${time.hour}:${time.minute.toString().padStart(2, '0')}`;
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
        employeeInfo.innerHTML = `<div class="name">${name}</div>` + (position ? `<div class="position">${position}</div>` : '');

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
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.style.display = 'block';
    setTimeout(hideNotification, 5000);
}

function hideNotification() {
    const notification = document.getElementById('notification');
    notification.style.display = 'none';
}

// Експорт
function exportToPDF() {
    const element = document.querySelector('.container');
    const opt = {
        margin: 10,
        filename: 'work_schedule.pdf',
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    toggleControlsVisibility(true);
    html2pdf().from(element).set(opt).save().then(() => {
        toggleControlsVisibility(false);
    });
}

function exportToJPG() {
    const element = document.querySelector('.container');
    
    toggleControlsVisibility(true);
    html2canvas(element, {
        scale: 2,
        logging: false,
        useCORS: true
    }).then(canvas => {
        toggleControlsVisibility(false);
        downloadImage(canvas);
    });
}

function toggleControlsVisibility(hide) {
    const controls = document.querySelector('.controls');
    controls.style.display = hide ? 'none' : 'flex';
}

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
