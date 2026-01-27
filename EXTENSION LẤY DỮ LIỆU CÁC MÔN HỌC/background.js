// === BACKGROUND SERVICE WORKER ===
// Điều phối flow crawl data từ các môn học LMS

let crawlState = {
    isRunning: false,
    courses: [],        // Danh sách môn cần crawl [{name, url}, ...]
    collectedData: [],  // Data đã thu thập [{name, completed, total}, ...]
    currentIndex: 0,
    tabId: null,
    listPageUrl: null,   // URL trang danh sách để quay lại
    // === PHASE TIME: Lấy thời gian học ===
    phase: 'courses',    // 'courses' | 'time' | 'time_lesson' | 'time_get_data' | 'done'
    firstCourseUrl: null, // URL môn đầu tiên
    timeData: null,       // { thoiGianDaHoc, gioMax }
    // === LOG ===
    logs: []             // Log entries to send to popup
};

// === LOG FUNCTION ===
function bgLog(message, type = 'info') {
    const time = new Date().toLocaleTimeString('vi-VN');
    const entry = { time, message, type };
    crawlState.logs.push(entry);
    console.log(`[${type.toUpperCase()}] ${message}`);
}

// Lắng nghe message từ popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startCrawl') {
        startCrawl(message.tabId);
        sendResponse({ status: 'started' });
    } else if (message.action === 'getStatus') {
        sendResponse({
            isRunning: crawlState.isRunning,
            total: crawlState.courses.length,
            current: crawlState.currentIndex,
            collected: crawlState.collectedData.length,
            phase: crawlState.phase,
            logs: crawlState.logs  // Gửi logs cho popup
        });
    }
    return true;
});

// Lắng nghe khi tab được cập nhật (page load xong)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!crawlState.isRunning || tabId !== crawlState.tabId) return;
    if (changeInfo.status !== 'complete') return;

    // Trang đã load xong, tiến hành lấy data
    handlePageLoaded(tabId, tab.url);
});

// === MAIN FUNCTIONS ===

async function startCrawl(tabId) {
    crawlState.tabId = tabId;
    crawlState.isRunning = true;
    crawlState.courses = [];
    crawlState.collectedData = [];
    crawlState.currentIndex = 0;

    // Lấy URL hiện tại làm listPageUrl
    const tab = await chrome.tabs.get(tabId);
    crawlState.listPageUrl = tab.url;

    // Bước 1: Inject script để lấy danh sách môn học
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: extractCoursesList
        });

        if (results && results[0] && results[0].result) {
            const { directData, needsCrawl, firstCourseUrl } = results[0].result;

            // Lưu data đã có sẵn
            crawlState.collectedData = directData || [];
            crawlState.courses = needsCrawl || [];
            crawlState.firstCourseUrl = firstCourseUrl;  // Lưu URL môn đầu tiên

            bgLog(`Direct data: ${crawlState.collectedData.length}, Needs crawl: ${crawlState.courses.length}`, 'info');
            bgLog(`First course URL: ${crawlState.firstCourseUrl || 'null'}`, 'info');

            if (crawlState.courses.length > 0) {
                // Bắt đầu crawl từng môn
                navigateToNextCourse();
            } else {
                // Không có môn nào cần crawl, vào Phase TIME ngay
                bgLog('Không có môn cần crawl, vào Phase TIME ngay', 'info');
                finishCrawl();
            }
        } else {
            console.error('Không lấy được danh sách môn học');
            crawlState.isRunning = false;
        }
    } catch (error) {
        console.error('Error starting crawl:', error);
        crawlState.isRunning = false;
    }
}

function navigateToNextCourse() {
    if (crawlState.currentIndex >= crawlState.courses.length) {
        // Đã crawl hết, quay về trang danh sách
        finishCrawl();
        return;
    }

    const course = crawlState.courses[crawlState.currentIndex];
    console.log(`Navigating to course ${crawlState.currentIndex + 1}/${crawlState.courses.length}: ${course.name}`);

    // Navigate đến trang môn học
    chrome.tabs.update(crawlState.tabId, { url: course.fullUrl });
}

async function handlePageLoaded(tabId, url) {
    // === PHASE TIME_LESSON: Đã vào trang bài học, xử lý modal confirm ===
    if (crawlState.phase === 'time_lesson') {
        bgLog('📚 Đã vào trang bài học', 'success');

        // === RETRY LOOP VỚI LOG CHO MỖI LẦN ===
        const MAX_RETRIES = 10;
        const RETRY_DELAY = 1000; // 1s
        let modalHandled = false;
        let hasModal = false;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            bgLog(`🔍 Tìm modal xác nhận... (${attempt}/${MAX_RETRIES})`, 'info');
            
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    function: checkAndHandleModal
                });

                if (results && results[0] && results[0].result) {
                    const result = results[0].result;
                    
                    if (result.found) {
                        hasModal = true;
                        if (result.handled) {
                            bgLog(`✓ Đã xử lý modal thành công!`, 'success');
                            modalHandled = true;
                            break;
                        } else {
                            bgLog(`⚠️ Tìm thấy modal nhưng chưa xử lý được: ${result.message}`, 'warn');
                        }
                    }
                    // Không tìm thấy modal, tiếp tục retry
                }
            } catch (e) {
                bgLog(`⚠️ Lỗi lần ${attempt}: ${e.message}`, 'warn');
            }

            // Đợi trước khi retry (trừ lần cuối)
            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, RETRY_DELAY));
            }
        }

        if (!hasModal) {
            bgLog(`ℹ️ Không có modal xác nhận`, 'info');
        }

        // Tiếp tục lấy timeData (dù có modal hay không)
        bgLog('⏱️ Đang lấy thời gian học...', 'info');

        try {
            const timeResults = await chrome.scripting.executeScript({
                target: { tabId: crawlState.tabId },
                function: extractTimeData
            });

            if (timeResults && timeResults[0] && timeResults[0].result) {
                const { success: timeSuccess, thoiGianDaHoc, gioMax, message: timeMsg } = timeResults[0].result;

                if (timeSuccess) {
                    crawlState.timeData = { thoiGianDaHoc, gioMax };
                    bgLog(`✓ Đã học hôm nay: ${thoiGianDaHoc}/${gioMax} giờ`, 'success');
                } else {
                    bgLog(`⚠️ Không lấy được timeData: ${timeMsg}`, 'warn');
                }
            }
        } catch (error) {
            bgLog(`⚠️ Lỗi lấy timeData: ${error.message}`, 'warn');
        }

        // === HOÀN THÀNH VÀ QUAY VỀ ===
        bgLog('✅ Hoàn thành! Đang copy dữ liệu...', 'success');
        await copyDataToClipboard();
        crawlState.phase = 'done';
        crawlState.isRunning = false;
        
        // Navigate về trang danh sách
        const listUrl = new URL(url).origin + '/student/ep';
        bgLog('🔙 Quay về trang danh sách...', 'info');
        chrome.tabs.update(crawlState.tabId, { url: listUrl });
        return;
    }

    // === PHASE TIME: Đã vào môn đầu tiên, quét loại bài và vào link đầu tiên ===
    if (crawlState.phase === 'time') {
        bgLog('Phase TIME: Đang ở trang chi tiết môn', 'info');
        bgLog(`URL: ${url}`, 'info');

        // Inject script để quét loại bài và lấy link đầu tiên
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                function: extractFirstLessonLink
            });

            if (results && results[0] && results[0].result) {
                const { lessonUrl, lessonName, totalLessons } = results[0].result;
                bgLog(`Tìm thấy ${totalLessons} loại bài`, 'info');

                if (lessonUrl) {
                    bgLog(`Vào bài đầu tiên: ${lessonName}`, 'info');
                    crawlState.phase = 'time_lesson';
                    await chrome.tabs.update(crawlState.tabId, { url: lessonUrl });
                    return;
                } else {
                    bgLog('Không tìm thấy link loại bài!', 'error');
                }
            } else {
                bgLog('Không thể quét loại bài!', 'error');
            }
        } catch (error) {
            bgLog(`Lỗi quét loại bài: ${error.message}`, 'error');
        }

        // Fallback: dừng lại
        crawlState.isRunning = false;
        crawlState.phase = 'done';
        return;
    }

    // === PHASE COURSES: Kiểm tra trang danh sách (CHỈ khi đang phase courses) ===
    if (crawlState.phase === 'courses') {
        // Kiểm tra xem đang ở trang môn học hay trang danh sách
        if (url === crawlState.listPageUrl || (url.includes('/student/ep') && !url.includes('/student/ep/'))) {
            // Đã quay về trang danh sách, hoàn thành
            if (crawlState.currentIndex >= crawlState.courses.length) {
                copyDataToClipboard();
            }
            return;
        }
    }

    // Đang ở trang môn học, inject script để lấy data
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: extractCourseData
        });

        if (results && results[0] && results[0].result) {
            const data = results[0].result;
            const course = crawlState.courses[crawlState.currentIndex];

            crawlState.collectedData.push({
                name: course.name,
                completed: data.completed,
                total: data.total
            });

            // === LƯU URL MÔN ĐẦU TIÊN ===
            if (crawlState.currentIndex === 0) {
                crawlState.firstCourseUrl = url;
                bgLog(`Lưu URL môn đầu: ${course.name}`, 'info');
            }

            bgLog(`Crawl: ${course.name} - ${data.completed}/${data.total}`, 'info');
        }

        // Chuyển sang môn tiếp theo
        crawlState.currentIndex++;
        navigateToNextCourse();

    } catch (error) {
        console.error('Error extracting course data:', error);
        crawlState.currentIndex++;
        navigateToNextCourse();
    }
}

async function finishCrawl() {
    bgLog(`Quét xong ${crawlState.collectedData.length} môn`, 'success');

    // === PHASE TIME: Sau khi quét xong, vào môn đầu tiên để lấy thời gian học ===
    if (crawlState.firstCourseUrl) {
        bgLog('Bắt đầu Phase TIME: Vào môn đầu tiên...', 'info');
        crawlState.phase = 'time';
        await chrome.tabs.update(crawlState.tabId, { url: crawlState.firstCourseUrl });
        return; // handlePageLoaded sẽ xử lý tiếp
    }

    // Không có môn nào, hoàn thành luôn
    await chrome.tabs.update(crawlState.tabId, { url: crawlState.listPageUrl });
    setTimeout(() => copyDataToClipboard(), 1000);
}

async function copyDataToClipboard() {
    const courses = crawlState.collectedData;

    // Cấu trúc dữ liệu mới với timeData
    const exportData = {
        courses: courses,
        maxHoursPerDay: crawlState.timeData ? parseFloat(crawlState.timeData.gioMax) : null,
        learnedHoursToday: crawlState.timeData ? parseFloat(crawlState.timeData.thoiGianDaHoc) : null
    };

    const jsonString = JSON.stringify(exportData);

    // Lưu data vào storage để popup có thể truy cập sau
    await chrome.storage.local.set({
        lmsData: courses,
        lmsExportData: exportData,
        lmsDataTime: Date.now()
    });

    // Inject script để copy vào clipboard và hiện thông báo
    await chrome.scripting.executeScript({
        target: { tabId: crawlState.tabId },
        function: (text) => {
            navigator.clipboard.writeText(text).then(() => {
                const data = JSON.parse(text);
                const courseCount = data.courses ? data.courses.length : 0;
                const timeInfo = data.learnedHoursToday !== null
                    ? `<br>⏱️ ${data.learnedHoursToday}/${data.maxHoursPerDay} giờ hôm nay`
                    : '';

                // Hiển thị thông báo
                const notification = document.createElement('div');
                notification.innerHTML = `
                    <div style="position: fixed; top: 20px; right: 20px; 
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white; padding: 20px; border-radius: 12px; 
                        z-index: 999999; font-family: sans-serif; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                        <div style="font-weight: bold; font-size: 16px; margin-bottom: 5px;">
                            ✅ Hoàn thành!
                        </div>
                        <div>Đã copy ${courseCount} môn học${timeInfo}</div>
                    </div>
                `;
                document.body.appendChild(notification);
                setTimeout(() => notification.remove(), 5000);
            });
        },
        args: [jsonString]
    });

    crawlState.isRunning = false;
}

// === INJECTED FUNCTIONS ===

// Hàm lấy danh sách môn học từ trang chính
function extractCoursesList() {
    const rows = document.querySelectorAll('tr.ant-table-row');
    const directData = [];
    const needsCrawl = [];

    rows.forEach(row => {
        // === BỎ QUA ROW CHA (sub-program-row) ===
        // Row cha chứa các môn con (VD: "Pháp luật giao thông đường bộ")
        // Nếu tính vào sẽ bị trùng lặp số giờ với các môn con
        if (row.classList.contains('sub-program-row')) {
            return; // Bỏ qua row này
        }

        // Lấy tên môn học
        const nameEl = row.querySelector('.course-info__name span');
        const strongEl = row.querySelector('strong');

        // Lấy URL
        const linkEl = row.querySelector('.course-info__name');
        const url = linkEl ? linkEl.getAttribute('href') : null;

        // Lấy số giờ nếu có
        const pointsEl = row.querySelector('.total-point');

        let name = null;
        if (nameEl) {
            name = nameEl.innerText.trim();
        } else if (strongEl) {
            name = strongEl.innerText.trim();
        }

        if (!name) return;

        // Nếu có .total-point → lấy data trực tiếp
        if (pointsEl) {
            const valueEl = pointsEl.querySelector('.total-point__value');
            const totalSpan = pointsEl.querySelectorAll('span')[1];

            if (valueEl && totalSpan) {
                const completed = parseFloat(valueEl.innerText.trim()) || 0;
                const totalText = totalSpan.innerText.trim();
                const total = parseFloat(totalText.replace('/', '')) || 0;

                directData.push({
                    name,
                    completed,
                    total,
                    url: url ? window.location.origin + url : null  // Thêm URL
                });
            }
        }
        // Nếu KHÔNG có .total-point và có URL → cần crawl
        else if (url) {
            needsCrawl.push({
                name,
                url,
                fullUrl: window.location.origin + url
            });
        }
    });

    // Tìm URL môn đầu tiên (ưu tiên từ needsCrawl, fallback sang directData)
    let firstCourseUrl = null;
    if (needsCrawl.length > 0) {
        firstCourseUrl = needsCrawl[0].fullUrl;
    } else if (directData.length > 0 && directData[0].url) {
        firstCourseUrl = directData[0].url;
    }

    return { directData, needsCrawl, firstCourseUrl };
}

// Hàm lấy data từ trang chi tiết môn học (sử dụng waitForElement với retry)
function extractCourseData() {
    return new Promise((resolve) => {
        // === CONFIG ===
        const SELECTORS = ['.total-point', '.course-progress', '.ant-table-row'];
        const TIMEOUT = 30000;  // 30s
        const MAX_RETRIES = 3;
        const FALLBACK_URL = window.location.origin + '/student/ep';

        // Hàm đợi một trong các selectors xuất hiện
        function waitForAnyElement(selectors, timeout) {
            return new Promise((res, rej) => {
                // Kiểm tra ngay nếu đã có sẵn
                for (const sel of selectors) {
                    const existing = document.querySelector(sel);
                    if (existing) return res({ element: existing, selector: sel });
                }

                const observer = new MutationObserver((mutations, obs) => {
                    for (const sel of selectors) {
                        const el = document.querySelector(sel);
                        if (el) {
                            obs.disconnect();
                            res({ element: el, selector: sel });
                            return;
                        }
                    }
                });

                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });

                // Timeout
                setTimeout(() => {
                    observer.disconnect();
                    rej(new Error('Timeout waiting for selectors: ' + selectors.join(', ')));
                }, timeout);
            });
        }

        // Hàm retry
        async function tryWithRetry() {
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    console.log(`[extractCourseData] Attempt ${attempt}/${MAX_RETRIES}...`);
                    const result = await waitForAnyElement(SELECTORS, TIMEOUT);
                    console.log(`[extractCourseData] Found: ${result.selector}`);
                    return result;
                } catch (e) {
                    console.log(`[extractCourseData] Attempt ${attempt} failed: ${e.message}`);
                    if (attempt < MAX_RETRIES) {
                        console.log('[extractCourseData] Waiting 2s before retry...');
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
            }
            return null; // Hết retry
        }

        // Main logic
        tryWithRetry()
            .then(result => {
                if (!result) {
                    // Hết retry, quay về trang danh sách
                    console.log('[extractCourseData] All retries failed! Navigating to fallback URL...');
                    window.location.href = FALLBACK_URL;
                    resolve({ completed: 0, total: 0, failed: true });
                    return;
                }

                // Xử lý theo selector tìm thấy
                if (result.selector === '.total-point') {
                    const pointsEl = result.element;
                    const valueEl = pointsEl.querySelector('.total-point__value');
                    const totalSpan = pointsEl.querySelectorAll('span')[1];

                    if (valueEl && totalSpan) {
                        const completed = parseFloat(valueEl.innerText.trim()) || 0;
                        const totalText = totalSpan.innerText.trim();
                        const total = parseFloat(totalText.replace('/', '')) || 0;
                        resolve({ completed, total });
                    } else {
                        resolve({ completed: 0, total: 0 });
                    }
                } else {
                    // Fallback cho selector khác - chưa có logic lấy data
                    console.log('[extractCourseData] Found alternative selector, returning 0');
                    resolve({ completed: 0, total: 0 });
                }
            })
            .catch(error => {
                console.error('[extractCourseData] Error:', error);
                resolve({ completed: 0, total: 0 });
            });
    });
}

// === INJECTED FUNCTION: Quét loại bài và lấy link đầu tiên (với retry) ===
function extractFirstLessonLink() {
    return new Promise((resolve) => {
        const SELECTOR = '.ant-table-row a.text-primary';
        const TIMEOUT = 30000;    // 30s mỗi lần
        const MAX_RETRIES = 3;
        const FALLBACK_URL = window.location.origin + '/student/ep';

        // Hàm đợi element xuất hiện
        function waitForElement(selector, timeout) {
            return new Promise((res, rej) => {
                const existing = document.querySelector(selector);
                if (existing) return res(existing);

                const observer = new MutationObserver((mutations, obs) => {
                    const el = document.querySelector(selector);
                    if (el) {
                        obs.disconnect();
                        res(el);
                    }
                });

                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });

                setTimeout(() => {
                    observer.disconnect();
                    rej(new Error('Timeout'));
                }, timeout);
            });
        }

        // Hàm retry
        async function tryWithRetry() {
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    console.log(`[extractFirstLessonLink] Attempt ${attempt}/${MAX_RETRIES}...`);
                    await waitForElement(SELECTOR, TIMEOUT);

                    // Đợi thêm 500ms để đảm bảo render xong hết
                    await new Promise(r => setTimeout(r, 500));

                    const lessonLinks = document.querySelectorAll(SELECTOR);
                    const lessons = [];
                    lessonLinks.forEach(function (el) {
                        const name = el.innerText.trim();
                        const href = el.getAttribute('href');
                        if (name && href) {
                            lessons.push({ name, href });
                            console.log('[extractFirstLessonLink] Found:', name, href);
                        }
                    });

                    if (lessons.length > 0) {
                        const firstLesson = lessons[0];
                        const fullUrl = window.location.origin + firstLesson.href;
                        return {
                            lessonUrl: fullUrl,
                            lessonName: firstLesson.name,
                            totalLessons: lessons.length
                        };
                    }
                } catch (e) {
                    console.log(`[extractFirstLessonLink] Attempt ${attempt} failed: ${e.message}`);
                    if (attempt < MAX_RETRIES) {
                        console.log('[extractFirstLessonLink] Waiting 2s before retry...');
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
            }

            // Hết retry, quay về trang danh sách
            console.log('[extractFirstLessonLink] All retries failed! Navigating to fallback URL...');
            window.location.href = FALLBACK_URL;
            return { lessonUrl: null, lessonName: null, totalLessons: 0, failed: true };
        }

        // Main
        tryWithRetry().then(resolve);
    });
}

// === INJECTED FUNCTION: Kiểm tra và xử lý modal (1 lần, không retry) ===
function checkAndHandleModal() {
    const MODAL_SELECTOR = '.ant-modal-wrap .ant-modal-confirm';
    const CHECKBOX_SELECTOR = '.ant-checkbox-input';
    const CONFIRM_BTN_SELECTOR = '.ant-modal-confirm-btns .ant-btn.ant-btn-primary:not([disabled])';

    // Kiểm tra modal có tồn tại không
    const modal = document.querySelector(MODAL_SELECTOR);
    if (!modal) {
        return { found: false, handled: false, message: 'Chưa thấy modal' };
    }

    // Tìm thấy modal, thử xử lý
    console.log('[checkAndHandleModal] Tìm thấy modal!');

    // Click checkbox
    const checkbox = document.querySelector(CHECKBOX_SELECTOR);
    if (checkbox) {
        checkbox.click();
    }

    // Đợi một chút rồi kiểm tra nút confirm
    return new Promise((resolve) => {
        setTimeout(() => {
            const confirmBtn = document.querySelector(CONFIRM_BTN_SELECTOR);
            if (confirmBtn) {
                console.log('[checkAndHandleModal] Click nút Đồng ý');
                confirmBtn.click();
                
                // Đợi modal đóng
                setTimeout(() => {
                    const stillExists = document.querySelector(MODAL_SELECTOR);
                    if (!stillExists) {
                        resolve({ found: true, handled: true, message: 'Đã xử lý xong' });
                    } else {
                        resolve({ found: true, handled: false, message: 'Modal chưa đóng' });
                    }
                }, 500);
            } else {
                // Checkbox chưa được check, nút chưa enable
                resolve({ found: true, handled: false, message: 'Nút Đồng ý chưa enable' });
            }
        }, 300);
    });
}

// === INJECTED FUNCTION: Lấy thời gian đã học và giờ max ===
function extractTimeData() {
    return new Promise((resolve) => {
        const SELECTOR = 'div.d-flex.text-muted.w-50 > span.m-l-5';
        const TIMEOUT = 30000;    // 30s
        const MAX_RETRIES = 2;

        // Hàm đợi element xuất hiện
        function waitForElement(selector, timeout) {
            return new Promise((res, rej) => {
                const existing = document.querySelector(selector);
                if (existing) return res(existing);

                const observer = new MutationObserver((mutations, obs) => {
                    const el = document.querySelector(selector);
                    if (el) {
                        obs.disconnect();
                        res(el);
                    }
                });

                observer.observe(document.body, {
                    childList: true,
                    subtree: true
                });

                setTimeout(() => {
                    observer.disconnect();
                    rej(new Error('Timeout'));
                }, timeout);
            });
        }

        // Hàm retry
        async function tryWithRetry() {
            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    console.log(`[extractTimeData] Attempt ${attempt}/${MAX_RETRIES}...`);
                    const element = await waitForElement(SELECTOR, TIMEOUT);

                    // Lấy text và parse
                    const text = element.innerText.trim();
                    console.log('[extractTimeData] Found text:', text);

                    // Parse: "13.5/20 giờ"
                    const thoiGianDaHoc = text.split('/')[0].trim();
                    const gioMax = text.split('/')[1].replace('giờ', '').trim();

                    console.log('[extractTimeData] Parsed:', thoiGianDaHoc, gioMax);
                    return { success: true, thoiGianDaHoc, gioMax, message: 'OK' };

                } catch (e) {
                    console.log(`[extractTimeData] Attempt ${attempt} failed: ${e.message}`);
                    if (attempt < MAX_RETRIES) {
                        console.log('[extractTimeData] Waiting 2s before retry...');
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
            }

            return { success: false, thoiGianDaHoc: null, gioMax: null, message: 'Không tìm thấy element sau retry' };
        }

        tryWithRetry().then(resolve);
    });
}

// === INJECTED FUNCTION: Click nút quay về (hỗ trợ 2 loại button) ===
function clickBackButton() {
    console.log('[clickBackButton] Tìm nút quay về...');

    // TYPE 1: .course-header__back với title "quay về" hoặc "tổng quan"
    const backButtons = document.querySelectorAll('.course-header__back');
    for (let button of backButtons) {
        const title = button.getAttribute('title') || '';
        if (title.includes('quay về') || title.includes('tổng quan') || title) {
            console.log(`[clickBackButton] Tìm thấy nút back (title: "${title}")`);
            button.click();
            return { clicked: true, type: 'back', title };
        }
    }

    // TYPE 2: .course-header__close với span.ve-close
    const closeButtons = document.querySelectorAll('.course-header__close');
    for (let button of closeButtons) {
        const title = button.getAttribute('title') || '';
        const hasCloseIcon = button.querySelector('span.ve-close') !== null;
        if (title.includes('đóng') || hasCloseIcon) {
            console.log(`[clickBackButton] Tìm thấy nút close (title: "${title}")`);
            button.click();
            return { clicked: true, type: 'close', title };
        }
    }

    console.log('[clickBackButton] Không tìm thấy nút quay về');
    return { clicked: false, type: null, title: null };
}

// === INJECTED FUNCTION: Xử lý hộp thoại xác nhận khi quay về ===
function handleBackConfirmDialog() {
    return new Promise((resolve) => {
        let checkCount = 0;
        const maxChecks = 20; // Check tối đa 20 lần (10 giây)

        const checkInterval = setInterval(() => {
            checkCount++;

            // Tìm dialog xác nhận
            const modalBodies = document.querySelectorAll('.ant-modal-body');
            let confirmDialog = null;

            for (let modal of modalBodies) {
                const content = modal.querySelector('.ant-modal-confirm-content');
                if (content) {
                    const text = (content.textContent || '').trim();
                    if (text.includes('kết thúc luyện tập') || text.includes('Bạn có chắc chắn')) {
                        confirmDialog = modal;
                        break;
                    }
                }
            }

            if (confirmDialog) {
                console.log('[handleBackConfirmDialog] Tìm thấy hộp thoại xác nhận!');
                clearInterval(checkInterval);

                // Click OK button sau 300ms
                setTimeout(() => {
                    const okButtons = document.querySelectorAll('button.ant-btn.ant-btn-primary');
                    for (let button of okButtons) {
                        const text = (button.textContent || '').trim();
                        if (text === 'OK' || text.includes('OK')) {
                            console.log('[handleBackConfirmDialog] Click nút OK');
                            button.click();

                            // Dispatch MouseEvent
                            const clickEvent = new MouseEvent('click', {
                                view: window,
                                bubbles: true,
                                cancelable: true
                            });
                            button.dispatchEvent(clickEvent);

                            resolve({ clicked: true, message: 'Đã click OK' });
                            return;
                        }
                    }
                    resolve({ clicked: false, message: 'Không tìm thấy nút OK' });
                }, 300);

            } else if (checkCount >= maxChecks) {
                console.log('[handleBackConfirmDialog] Không tìm thấy hộp thoại sau 10 giây');
                clearInterval(checkInterval);
                resolve({ clicked: false, message: 'Không có hộp thoại xác nhận' });
            }
        }, 500); // Check mỗi 0.5 giây
    });
}
