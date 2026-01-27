// === POPUP.JS ===
// Giao tiếp với background và quản lý UI

// === LOG SYSTEM ===
let logEntries = [];

function addLog(message, type = 'info') {
    const now = new Date();
    const time = now.toLocaleTimeString('vi-VN');

    const entry = { time, message, type };
    logEntries.push(entry);

    const logContainer = document.getElementById('logContainer');
    if (logContainer) {
        const entryEl = document.createElement('div');
        entryEl.className = 'log-entry';
        entryEl.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-${type}">${message}</span>`;
        logContainer.appendChild(entryEl);
        logContainer.scrollTop = logContainer.scrollHeight;
    }
}

function getLogText() {
    return logEntries.map(e => `[${e.time}] [${e.type.toUpperCase()}] ${e.message}`).join('\n');
}

// Khi popup mở, load data đã lưu
document.addEventListener('DOMContentLoaded', () => {
    loadSavedData();
    addLog('Popup đã mở', 'info');
});

// Nút quét dữ liệu
document.getElementById('scanBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('status');
    const btn = document.getElementById('scanBtn');

    // Disable button để tránh click nhiều lần
    btn.disabled = true;
    btn.style.opacity = '0.7';
    statusEl.innerHTML = '⏳ Đang quét dữ liệu...<br><small>Vui lòng không đóng trình duyệt</small>';
    statusEl.style.color = '#666';
    addLog('Bắt đầu quét dữ liệu...', 'info');

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    addLog(`Tab hiện tại: ${tab.url}`, 'info');

    // Gửi message đến background để bắt đầu crawl
    chrome.runtime.sendMessage(
        { action: 'startCrawl', tabId: tab.id },
        (response) => {
            if (response && response.status === 'started') {
                addLog('Background đã nhận lệnh, bắt đầu crawl', 'success');
                statusEl.innerHTML = '🔄 Đang thu thập dữ liệu từ các môn học...<br><small>Extension sẽ tự động navigate qua từng môn</small>';
                statusEl.style.color = '#667eea';

                // Bắt đầu kiểm tra trạng thái
                startStatusCheck();
            } else {
                addLog('Lỗi: Không thể bắt đầu quét', 'error');
                statusEl.innerText = '❌ Không thể bắt đầu quét';
                statusEl.style.color = 'red';
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }
    );
});

// Nút copy log
document.getElementById('copyLogBtn').addEventListener('click', async () => {
    const logText = getLogText();
    await navigator.clipboard.writeText(logText);

    const btn = document.getElementById('copyLogBtn');
    btn.innerText = '✅ Đã copy!';
    setTimeout(() => { btn.innerText = 'Copy Log'; }, 1500);
    addLog('Đã copy log vào clipboard', 'info');
});

// Nút copy kết quả
document.getElementById('copyBtn').addEventListener('click', async () => {
    // Lấy lmsExportData (có đầy đủ courses + maxHoursPerDay + learnedHoursToday)
    const result = await chrome.storage.local.get(['lmsExportData', 'lmsData']);
    
    // Ưu tiên lmsExportData, fallback sang lmsData nếu không có
    let dataToExport = null;
    if (result.lmsExportData && result.lmsExportData.courses && result.lmsExportData.courses.length > 0) {
        dataToExport = result.lmsExportData;
    } else if (result.lmsData && result.lmsData.length > 0) {
        // Fallback: wrap lmsData vào format mới
        dataToExport = { courses: result.lmsData, maxHoursPerDay: null, learnedHoursToday: null };
    }

    if (dataToExport) {
        await navigator.clipboard.writeText(JSON.stringify(dataToExport));

        const copyBtn = document.getElementById('copyBtn');
        const originalText = copyBtn.innerText;
        copyBtn.innerText = '✅ Đã copy!';
        copyBtn.style.background = '#28a745';

        setTimeout(() => {
            copyBtn.innerText = originalText;
            copyBtn.style.background = '';
        }, 2000);
        
        addLog(`Đã copy ${dataToExport.courses.length} môn học (format đầy đủ)`, 'success');
    }
});

// Nút xóa data
document.getElementById('clearBtn').addEventListener('click', async () => {
    if (confirm('Bạn có chắc muốn xóa dữ liệu đã lưu?')) {
        await chrome.storage.local.remove(['lmsData', 'lmsExportData', 'lmsDataTime']);
        document.getElementById('savedDataSection').style.display = 'none';
        document.getElementById('status').innerText = '🗑️ Đã xóa dữ liệu';
        addLog('Đã xóa dữ liệu', 'info');
    }
});

// Load data đã lưu khi mở popup
async function loadSavedData() {
    const result = await chrome.storage.local.get(['lmsData', 'lmsExportData', 'lmsDataTime']);

    const courses = result.lmsExportData?.courses || result.lmsData;
    
    if (courses && courses.length > 0) {
        const savedSection = document.getElementById('savedDataSection');
        const savedInfo = document.getElementById('savedInfo');

        // Hiển thị thông tin
        const timeStr = result.lmsDataTime
            ? new Date(result.lmsDataTime).toLocaleString('vi-VN')
            : 'Không rõ';

        // Hiển thị thêm thông tin giờ học nếu có
        let timeInfo = '';
        if (result.lmsExportData && result.lmsExportData.learnedHoursToday !== null) {
            timeInfo = `<br><small>⏱️ Đã học hôm nay: ${result.lmsExportData.learnedHoursToday}/${result.lmsExportData.maxHoursPerDay} giờ</small>`;
        }

        savedInfo.innerHTML = `📊 Có ${courses.length} môn học đã lưu${timeInfo}<br><small>Lần quét: ${timeStr}</small>`;
        savedSection.style.display = 'block';
    }
}

// Kiểm tra trạng thái crawl
function startStatusCheck() {
    const statusEl = document.getElementById('status');
    const btn = document.getElementById('scanBtn');
    let lastProgress = 0;
    let lastLogCount = 0;  // Track logs từ background

    const checkInterval = setInterval(async () => {
        chrome.runtime.sendMessage({ action: 'getStatus' }, async (response) => {
            if (!response) return;

            // === SYNC LOGS TỪ BACKGROUND ===
            if (response.logs && response.logs.length > lastLogCount) {
                const newLogs = response.logs.slice(lastLogCount);
                newLogs.forEach(log => addLog(`[BG] ${log.message}`, log.type));
                lastLogCount = response.logs.length;
            }

            if (response.isRunning) {
                const progress = response.current + 1;
                const total = response.total;
                const phaseText = response.phase === 'time' ? ' (Phase TIME)' : '';
                statusEl.innerHTML = `🔄 Đang xử lý môn ${progress}/${total}...${phaseText}<br><small>Đã thu thập: ${response.collected} môn</small>`;

                // Log mỗi khi có progress mới
                if (progress !== lastProgress) {
                    addLog(`Đang crawl: ${progress}/${total}, thu thập: ${response.collected}`, 'info');
                    lastProgress = progress;
                }
            } else {
                clearInterval(checkInterval);

                // Reload saved data
                await loadSavedData();

                if (response.collected > 0) {
                    const phaseInfo = response.phase === 'done' ? ' (Phase TIME done)' : '';
                    addLog(`Hoàn thành! ${response.collected} môn${phaseInfo}`, 'success');
                    statusEl.innerHTML = `✅ Hoàn thành!<br><small>Đã lưu ${response.collected} môn học</small>`;
                    statusEl.style.color = 'green';
                } else {
                    addLog('Không tìm thấy dữ liệu', 'warn');
                    statusEl.innerText = '⚠️ Không tìm thấy dữ liệu';
                    statusEl.style.color = 'orange';
                }
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        });
    }, 500);

    // Timeout sau 5 phút
    setTimeout(() => {
        clearInterval(checkInterval);
    }, 300000);
}
