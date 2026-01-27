// Default course lists
const DEFAULT_COURSES_GENERAL = [
    'Đạo đức người lái xe, văn hóa giao thông và kỹ năng PCCC và cứu nạn, cứu hộ',
    'Kỹ thuật lái xe ô tô',
    'Cấu tạo sửa chữa',
    'Phần 1. Những nội dung cơ bản của luật trật tự, an toàn giao thông đường bộ',
    'Phần 2. Hệ thống báo hiệu đường bộ',
    'Phần 3. Xử lý các tình huống giao thông',
    'Mô phỏng các tình huống giao thông'
];



// Course data storage
let coursesDataGeneral = [];
let coursesDataCustom = []; // New dynamic data
let currentTab = 'custom';

// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    // Initialize courses data
    initializeCourses();

    // Setup tab navigation
    setupTabs();

    // Render courses table
    renderCoursesTable('general');
    renderCoursesTable('custom');

    // Add event listeners
    setupEventListeners();

    // Calculate initial results
    calculateResults('general');
    calculateResults('custom');

    // Initialize parallax effect
    initializeParallax();

    console.log('🚀 LMS Tracker initialized successfully!');
}

function initializeCourses() {
    // Load General courses
    const savedDataGeneral = localStorage.getItem('coursesDataGeneral');
    if (savedDataGeneral) {
        try { coursesDataGeneral = JSON.parse(savedDataGeneral); }
        catch (e) { coursesDataGeneral = createDefaultCourses('general'); }
    } else {
        coursesDataGeneral = createDefaultCourses('general');
    }



    // Load Custom courses
    const savedDataCustom = localStorage.getItem('coursesDataCustom');
    if (savedDataCustom) {
        try { coursesDataCustom = JSON.parse(savedDataCustom); }
        catch (e) { coursesDataCustom = []; }
    } else {
        coursesDataCustom = [];
    }
}

function createDefaultCourses(tab) {
    if (tab === 'general') {
        return DEFAULT_COURSES_GENERAL.map(name => ({
            name: name,
            totalHours: 0,
            completedHours: 0
        }));
    }
    return [];
}

function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            switchTab(tab);
        });
    });
}

function switchTab(tab) {
    currentTab = tab;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === tab) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        if (content.id === `${tab}Content`) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });
}

function renderCoursesTable(tab) {
    let suffix = '';
    let coursesData = [];

    if (tab === 'general') {
        suffix = '';
        coursesData = coursesDataGeneral;
    } else {
        suffix = 'Custom';
        coursesData = coursesDataCustom;
    }

    const tbody = document.getElementById(`coursesTableBody${suffix}`);
    if (!tbody) return;

    tbody.innerHTML = '';

    coursesData.forEach((course, index) => {
        const tr = document.createElement('tr');

        // Calculate progress
        const progress = course.totalHours > 0
            ? Math.min(100, (course.completedHours / course.totalHours) * 100)
            : 0;

        tr.innerHTML = `
            <td>
                <div class="course-name">${course.name}</div>
            </td>
            <td>
                <input 
                    type="number" 
                    class="input-total-hours" 
                    data-index="${index}" 
                    data-tab="${tab}"
                    value="${course.totalHours > 0 ? course.totalHours : ''}" 
                    min="0" 
                    step="0.5"
                    placeholder="0"
                >
            </td>
            <td>
                <input 
                    type="number" 
                    class="input-completed-hours" 
                    data-index="${index}" 
                    data-tab="${tab}"
                    value="${course.completedHours > 0 ? course.completedHours : ''}" 
                    min="0" 
                    step="0.5"
                    placeholder="0"
                >
            </td>
            <td>
                <div class="progress-indicator">
                    <div class="progress-mini-bar">
                        <div class="progress-mini-fill" style="width: ${progress}%"></div>
                    </div>
                    <div class="progress-text">${progress.toFixed(1)}%</div>
                </div>
            </td>
        `;

        tbody.appendChild(tr);
    });

    // Add event listeners
    tbody.querySelectorAll('.input-total-hours').forEach(input => {
        input.addEventListener('input', handleTotalHoursChange);
        input.addEventListener('blur', () => saveData(tab));
    });

    tbody.querySelectorAll('.input-completed-hours').forEach(input => {
        input.addEventListener('input', handleCompletedHoursChange);
        input.addEventListener('blur', () => saveData(tab));
    });
}

function handleTotalHoursChange(e) {
    const index = parseInt(e.target.dataset.index);
    const tab = e.target.dataset.tab;
    const value = parseFloat(e.target.value) || 0;

    if (tab === 'general') coursesDataGeneral[index].totalHours = value;
    else coursesDataCustom[index].totalHours = value;

    updateRowProgress(index, tab);
    calculateResults(tab);
}

function handleCompletedHoursChange(e) {
    const index = parseInt(e.target.dataset.index);
    const tab = e.target.dataset.tab;
    const value = parseFloat(e.target.value) || 0;

    if (tab === 'general') coursesDataGeneral[index].completedHours = value;
    else coursesDataCustom[index].completedHours = value;

    updateRowProgress(index, tab);
    calculateResults(tab);
}

function updateRowProgress(index, tab) {
    let suffix = '';
    let coursesData = [];
    if (tab === 'general') { suffix = ''; coursesData = coursesDataGeneral; }
    else { suffix = 'Custom'; coursesData = coursesDataCustom; }

    const course = coursesData[index];
    const progress = course.totalHours > 0
        ? Math.min(100, (course.completedHours / course.totalHours) * 100)
        : 0;

    const tbody = document.getElementById(`coursesTableBody${suffix}`);
    if (!tbody) return;
    const row = tbody.querySelectorAll('tr')[index];

    if (row) {
        const progressFill = row.querySelector('.progress-mini-fill');
        const progressText = row.querySelector('.progress-text');

        if (progressFill) progressFill.style.width = `${progress}%`;
        if (progressText) progressText.textContent = `${progress.toFixed(1)}%`;
    }
}

function calculateResults(tab) {
    let suffix = '';
    let coursesData = [];
    let defaultPercent = 0.7;

    if (tab === 'general') { suffix = ''; coursesData = coursesDataGeneral; defaultPercent = 0.7; }
    else { suffix = 'Custom'; coursesData = coursesDataCustom; defaultPercent = 0.7; }

    const percentInput = document.getElementById(`percentInput${suffix}`);
    const hoursPerDayInput = document.getElementById(`hoursPerDayInput${suffix}`);
    const hoursTodayInput = document.getElementById(`hoursTodayInput${suffix}`);

    if (!percentInput || !hoursPerDayInput || !hoursTodayInput) return;

    const percent = parseFloat(percentInput.value) || defaultPercent;
    const hoursPerDay = parseFloat(hoursPerDayInput.value) || 8;
    const hoursToday = parseFloat(hoursTodayInput.value) || 0;

    let totalRequired = 0;
    let totalCompleted = 0;
    let remainingHours = 0;

    coursesData.forEach(course => {
        totalCompleted += course.completedHours;
        const requiredForCourse = course.totalHours * percent;
        totalRequired += requiredForCourse;
        const remainingForCourse = requiredForCourse - course.completedHours;
        if (remainingForCourse > 0) remainingHours += remainingForCourse;
    });

    remainingHours = Math.max(0, remainingHours);

    // Tính số giờ còn lại đã điều chỉnh (trừ số giờ đã học hôm nay)
    // Vì hoursToday có thể chưa được cập nhật vào completedHours của các môn
    const adjustedRemainingHours = Math.max(0, remainingHours - hoursToday);

    const completionInfo = calculateCompletionDate(adjustedRemainingHours, hoursPerDay, hoursToday);
    const overallProgress = totalRequired > 0 ? Math.min(100, (totalCompleted / totalRequired) * 100) : 0;

    updateResults(completionInfo.daysRemaining, adjustedRemainingHours, overallProgress, completionInfo, tab);
}

function calculateCompletionDate(remainingHours, hoursPerDay, hoursToday) {
    const now = new Date();
    if (remainingHours <= 0) return { daysRemaining: 0, dateString: formatDate(now), dayOfWeek: getDayOfWeek(now) };

    const hoursRemainingToday = Math.max(0, hoursPerDay - hoursToday);
    if (hoursRemainingToday >= remainingHours) return { daysRemaining: remainingHours / hoursPerDay, dateString: formatDate(now), dayOfWeek: getDayOfWeek(now) };

    let hoursNeededFromTomorrow = remainingHours - hoursRemainingToday;
    const additionalDays = Math.ceil(hoursNeededFromTomorrow / hoursPerDay);
    const completionDate = new Date(now);
    completionDate.setDate(completionDate.getDate() + additionalDays);

    return {
        daysRemaining: (hoursRemainingToday / hoursPerDay) + additionalDays,
        dateString: formatDate(completionDate),
        dayOfWeek: getDayOfWeek(completionDate)
    };
}

function formatDate(date) {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
}

function getDayOfWeek(date) {
    const days = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    return days[date.getDay()];
}

function updateResults(days, hours, progress, completionInfo, tab) {
    let suffix = '';
    if (tab === 'custom') suffix = 'Custom';

    const hoursElement = document.getElementById(`hoursRemaining${suffix}`);
    const progressElement = document.getElementById(`overallProgress${suffix}`);
    const dateElement = document.getElementById(`completionDate${suffix}`);
    const dayElement = document.getElementById(`completionDay${suffix}`);
    const fill = document.getElementById(`progressFill${suffix}`);
    const text = document.getElementById(`progressPercent${suffix}`);

    if (hoursElement) animateValue(hoursElement, parseFloat(hoursElement.textContent) || 0, hours, 600);
    if (progressElement) animateValue(progressElement, parseFloat(progressElement.textContent) || 0, progress, 600);
    if (dateElement) dateElement.textContent = completionInfo.dateString;
    if (dayElement) dayElement.textContent = completionInfo.dayOfWeek;
    if (fill) fill.style.width = `${progress}%`;
    if (text) text.textContent = `${progress.toFixed(1)}%`;
}

function animateValue(element, start, end, duration) {
    const startTime = performance.now();
    const diff = end - start;
    function update(t) {
        const p = Math.min((t - startTime) / duration, 1);
        element.textContent = (start + diff * (1 - Math.pow(1 - p, 3))).toFixed(1);
        if (p < 1) requestAnimationFrame(update);
        else element.textContent = end.toFixed(1);
    }
    requestAnimationFrame(update);
}

function setupEventListeners() {
    setupTabEventListeners('general', '');
    setupTabEventListeners('custom', 'Custom');
    loadSettings();
}

function setupTabEventListeners(tab, suffix) {
    const percentInput = document.getElementById(`percentInput${suffix}`);
    const hoursPerDayInput = document.getElementById(`hoursPerDayInput${suffix}`);
    const hoursTodayInput = document.getElementById(`hoursTodayInput${suffix}`);
    const resetBtn = document.getElementById(`resetBtn${suffix}`);
    const importBtn = document.getElementById(`importBtn${suffix}`);

    if (percentInput) percentInput.addEventListener('input', () => { calculateResults(tab); saveSettings(); });
    if (hoursPerDayInput) hoursPerDayInput.addEventListener('input', () => { calculateResults(tab); saveSettings(); });
    if (hoursTodayInput) hoursTodayInput.addEventListener('input', () => { calculateResults(tab); saveSettings(); });
    if (resetBtn) resetBtn.addEventListener('click', () => handleReset(tab));

    if (importBtn) {
        importBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (!text) return showNotification('Không có dữ liệu trong bộ nhớ tạm!', 'error');
                const data = JSON.parse(text);

                // Xử lý cấu trúc dữ liệu mới từ Extension V2
                if (data.courses && Array.isArray(data.courses)) {
                    // Cấu trúc mới: { courses: [...], maxHoursPerDay, learnedHoursToday }
                    
                    // ĐẶT GIÁ TRỊ INPUT TRƯỚC KHI GỌI handleImportData
                    // để calculateResults sử dụng giá trị đúng
                    if (data.maxHoursPerDay !== null && data.maxHoursPerDay !== undefined) {
                        const hoursPerDayInput = document.getElementById(`hoursPerDayInput${suffix}`);
                        if (hoursPerDayInput) {
                            hoursPerDayInput.value = data.maxHoursPerDay;
                        }
                    }
                    if (data.learnedHoursToday !== null && data.learnedHoursToday !== undefined) {
                        const hoursTodayInput = document.getElementById(`hoursTodayInput${suffix}`);
                        if (hoursTodayInput) {
                            hoursTodayInput.value = data.learnedHoursToday;
                        }
                    }

                    // Gọi handleImportData SAU khi đã set giá trị input
                    handleImportData(data.courses, tab);

                    // Lưu settings (handleImportData đã gọi calculateResults)
                    saveSettings();
                } else if (Array.isArray(data)) {
                    // Cấu trúc cũ: mảng trực tiếp
                    handleImportData(data, tab);
                } else {
                    showNotification('Dữ liệu không đúng định dạng!', 'error');
                }
            } catch (err) {
                const input = prompt('Dán dữ liệu JSON vào đây:');
                if (input) {
                    try {
                        const data = JSON.parse(input);
                        if (data.courses && Array.isArray(data.courses)) {
                            // ĐẶT GIÁ TRỊ INPUT TRƯỚC
                            if (data.maxHoursPerDay !== null && data.maxHoursPerDay !== undefined) {
                                const hoursPerDayInput = document.getElementById(`hoursPerDayInput${suffix}`);
                                if (hoursPerDayInput) hoursPerDayInput.value = data.maxHoursPerDay;
                            }
                            if (data.learnedHoursToday !== null && data.learnedHoursToday !== undefined) {
                                const hoursTodayInput = document.getElementById(`hoursTodayInput${suffix}`);
                                if (hoursTodayInput) hoursTodayInput.value = data.learnedHoursToday;
                            }
                            // Gọi handleImportData SAU
                            handleImportData(data.courses, tab);
                            saveSettings();
                        } else if (Array.isArray(data)) {
                            handleImportData(data, tab);
                        }
                    } catch (e) { showNotification('Lỗi JSON!', 'error'); }
                }
            }
        });
    }
}

function handleImportData(importedData, tab) {
    // If Custom Tab: REBUILD the table entirely
    if (tab === 'custom') {
        coursesDataCustom = importedData.map(item => ({
            name: item.name || 'Không tên',
            totalHours: parseFloat(item.total) || 0,
            completedHours: parseFloat(item.completed) || 0
        }));

        renderCoursesTable(tab);
        calculateResults(tab);
        saveData(tab);
        showNotification(`Đã tạo mới ${coursesDataCustom.length} môn học từ dữ liệu nhập!`, 'success');
        return;
    }

    // Existing Logic for General (Match by Name)
    let matchCount = 0;
    const coursesData = coursesDataGeneral;
    const importMap = new Map();
    importedData.forEach(item => { if (item.name) importMap.set(item.name.toLowerCase().trim(), item); });

    coursesData.forEach(course => {
        const normName = course.name.toLowerCase().trim();
        let item = importMap.get(normName);
        if (!item) {
            for (const [key, val] of importMap.entries()) {
                if (normName.includes(key) || key.includes(normName)) { item = val; break; }
                if (normName.startsWith('phần') && key.startsWith('phần')) {
                    const p1 = normName.match(/phần (\d+)/);
                    const p2 = key.match(/phần (\d+)/);
                    if (p1 && p2 && p1[1] === p2[1]) { item = val; break; }
                }
            }
        }
        if (item) {
            if (item.completed !== undefined) course.completedHours = parseFloat(item.completed) || 0;
            if (tab === 'general' && item.total !== undefined && course.totalHours === 0)
                course.totalHours = parseFloat(item.total) || 0;
            matchCount++;
        }
    });

    if (matchCount > 0) {
        renderCoursesTable(tab);
        calculateResults(tab);
        saveData(tab);
        showNotification(`Đã cập nhật ${matchCount} môn học!`, 'success');
    } else {
        showNotification('Không tìm thấy môn học trùng khớp!', 'error');
    }
}

function handleReset(tab) {
    if (!confirm(`Đặt lại dữ liệu tab ${tab}?`)) return;

    let suffix = '';
    if (tab === 'general') { coursesDataGeneral = createDefaultCourses('general'); suffix = ''; }
    else { coursesDataCustom = []; suffix = 'Custom'; }

    // Reset inputs
    const pInput = document.getElementById(`percentInput${suffix}`);
    if (pInput) pInput.value = 0.7;
    const hInput = document.getElementById(`hoursPerDayInput${suffix}`);
    if (hInput) hInput.value = 8;
    const htInput = document.getElementById(`hoursTodayInput${suffix}`);
    if (htInput) htInput.value = 0;

    saveData(tab);
    saveSettings();
    renderCoursesTable(tab);
    calculateResults(tab);
    showNotification('Đã đặt lại dữ liệu!', 'success');
}

function saveData(tab) {
    if (tab === 'general') localStorage.setItem('coursesDataGeneral', JSON.stringify(coursesDataGeneral));
    else localStorage.setItem('coursesDataCustom', JSON.stringify(coursesDataCustom));
}

function saveSettings() {
    const getVal = (id) => document.getElementById(id)?.value;
    const s = {
        general: { percent: getVal('percentInput'), hoursPerDay: getVal('hoursPerDayInput'), hoursToday: getVal('hoursTodayInput') },
        custom: { percent: getVal('percentInputCustom'), hoursPerDay: getVal('hoursPerDayInputCustom'), hoursToday: getVal('hoursTodayInputCustom') }
    };
    localStorage.setItem('settings', JSON.stringify(s));
}

function loadSettings() {
    const s = JSON.parse(localStorage.getItem('settings') || '{}');
    const setVal = (id, val, def) => { const el = document.getElementById(id); if (el) el.value = val || def; };

    if (s.general) { setVal('percentInput', s.general.percent, 0.7); setVal('hoursPerDayInput', s.general.hoursPerDay, 8); setVal('hoursTodayInput', s.general.hoursToday, 0); }
    if (s.custom) { setVal('percentInputCustom', s.custom.percent, 0.7); setVal('hoursPerDayInputCustom', s.custom.hoursPerDay, 8); setVal('hoursTodayInputCustom', s.custom.hoursToday, 0); }
}

function initializeParallax() {
    let mouseX = 0, mouseY = 0, currentX = 0, currentY = 0;
    document.addEventListener('mousemove', e => { mouseX = (e.clientX / window.innerWidth - 0.5) * 2; mouseY = (e.clientY / window.innerHeight - 0.5) * 2; });
    function animate() {
        currentX += (mouseX - currentX) * 0.1; currentY += (mouseY - currentY) * 0.1;
        document.querySelectorAll('.shape').forEach((s, i) => s.style.transform = `translate(${currentX * (i + 1) * 10}px, ${currentY * (i + 1) * 10}px)`);
        requestAnimationFrame(animate);
    }
    animate();
}

function showNotification(msg, type = 'info') {
    const n = document.createElement('div');
    n.className = `notification notification-${type}`; n.textContent = msg;
    Object.assign(n.style, { position: 'fixed', top: '20px', right: '20px', padding: '1rem', background: type === 'success' ? '#43e97b' : '#ef4444', color: 'white', borderRadius: '8px', zIndex: 9999 });
    document.body.appendChild(n);
    setTimeout(() => { n.remove(); }, 3000);
}

window.addEventListener('beforeunload', () => { saveData('general'); saveData('custom'); saveSettings(); });
