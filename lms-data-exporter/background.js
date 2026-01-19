// === BACKGROUND SERVICE WORKER ===
// Điều phối flow crawl data từ các môn học LMS

let crawlState = {
    isRunning: false,
    courses: [],        // Danh sách môn cần crawl [{name, url}, ...]
    collectedData: [],  // Data đã thu thập [{name, completed, total}, ...]
    currentIndex: 0,
    tabId: null,
    listPageUrl: null   // URL trang danh sách để quay lại
};

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
            collected: crawlState.collectedData.length
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
            const { directData, needsCrawl } = results[0].result;

            // Lưu data đã có sẵn
            crawlState.collectedData = directData || [];
            crawlState.courses = needsCrawl || [];

            console.log('Direct data:', crawlState.collectedData.length);
            console.log('Needs crawl:', crawlState.courses.length);

            if (crawlState.courses.length > 0) {
                // Bắt đầu crawl từng môn
                navigateToNextCourse();
            } else {
                // Không có môn nào cần crawl, hoàn thành
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
    // Kiểm tra xem đang ở trang môn học hay trang danh sách
    if (url === crawlState.listPageUrl || url.includes('/student/ep')) {
        // Đã quay về trang danh sách, hoàn thành
        if (crawlState.currentIndex >= crawlState.courses.length) {
            copyDataToClipboard();
        }
        return;
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

            console.log(`Got data for ${course.name}: ${data.completed}/${data.total}`);
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
    console.log('Crawl finished! Total courses:', crawlState.collectedData.length);

    // Navigate về trang danh sách
    await chrome.tabs.update(crawlState.tabId, { url: crawlState.listPageUrl });

    // Copy data sau khi quay về
    setTimeout(() => {
        copyDataToClipboard();
    }, 1000);
}

async function copyDataToClipboard() {
    const data = crawlState.collectedData;
    const jsonString = JSON.stringify(data);

    // Lưu data vào storage để popup có thể truy cập sau
    await chrome.storage.local.set({
        lmsData: data,
        lmsDataTime: Date.now()
    });

    // Inject script để copy vào clipboard và hiện thông báo
    await chrome.scripting.executeScript({
        target: { tabId: crawlState.tabId },
        function: (text) => {
            navigator.clipboard.writeText(text).then(() => {
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
                        <div>Đã lưu và copy ${JSON.parse(text).length} môn học</div>
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

                directData.push({ name, completed, total });
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

    return { directData, needsCrawl };
}

// Hàm lấy data từ trang chi tiết môn học (sử dụng waitForElement)
function extractCourseData() {
    return new Promise((resolve) => {
        // Hàm đợi element xuất hiện
        function waitForElement(selector, timeout = 15000) {
            return new Promise((res, rej) => {
                // Kiểm tra ngay nếu đã có sẵn
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

                // Timeout
                setTimeout(() => {
                    observer.disconnect();
                    rej(new Error('Timeout waiting for ' + selector));
                }, timeout);
            });
        }

        // Đợi .total-point xuất hiện
        waitForElement('.total-point')
            .then(pointsEl => {
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
            })
            .catch(error => {
                console.error('Error waiting for element:', error);
                resolve({ completed: 0, total: 0 });
            });
    });
}
