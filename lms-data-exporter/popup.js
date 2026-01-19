// === POPUP.JS ===
// Giao tiếp với background và quản lý UI

// Khi popup mở, load data đã lưu
document.addEventListener('DOMContentLoaded', loadSavedData);

// Nút quét dữ liệu
document.getElementById('scanBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('status');
    const btn = document.getElementById('scanBtn');

    // Disable button để tránh click nhiều lần
    btn.disabled = true;
    btn.style.opacity = '0.7';
    statusEl.innerHTML = '⏳ Đang quét dữ liệu...<br><small>Vui lòng không đóng trình duyệt</small>';
    statusEl.style.color = '#666';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Gửi message đến background để bắt đầu crawl
    chrome.runtime.sendMessage(
        { action: 'startCrawl', tabId: tab.id },
        (response) => {
            if (response && response.status === 'started') {
                statusEl.innerHTML = '🔄 Đang thu thập dữ liệu từ các môn học...<br><small>Extension sẽ tự động navigate qua từng môn</small>';
                statusEl.style.color = '#667eea';

                // Bắt đầu kiểm tra trạng thái
                startStatusCheck();
            } else {
                statusEl.innerText = '❌ Không thể bắt đầu quét';
                statusEl.style.color = 'red';
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }
    );
});

// Nút copy kết quả
document.getElementById('copyBtn').addEventListener('click', async () => {
    const result = await chrome.storage.local.get(['lmsData']);
    if (result.lmsData && result.lmsData.length > 0) {
        await navigator.clipboard.writeText(JSON.stringify(result.lmsData));

        const copyBtn = document.getElementById('copyBtn');
        const originalText = copyBtn.innerText;
        copyBtn.innerText = '✅ Đã copy!';
        copyBtn.style.background = '#28a745';

        setTimeout(() => {
            copyBtn.innerText = originalText;
            copyBtn.style.background = '';
        }, 2000);
    }
});

// Nút xóa data
document.getElementById('clearBtn').addEventListener('click', async () => {
    if (confirm('Bạn có chắc muốn xóa dữ liệu đã lưu?')) {
        await chrome.storage.local.remove(['lmsData', 'lmsDataTime']);
        document.getElementById('savedDataSection').style.display = 'none';
        document.getElementById('status').innerText = '🗑️ Đã xóa dữ liệu';
    }
});

// Load data đã lưu khi mở popup
async function loadSavedData() {
    const result = await chrome.storage.local.get(['lmsData', 'lmsDataTime']);

    if (result.lmsData && result.lmsData.length > 0) {
        const savedSection = document.getElementById('savedDataSection');
        const savedInfo = document.getElementById('savedInfo');

        // Hiển thị thông tin
        const timeStr = result.lmsDataTime
            ? new Date(result.lmsDataTime).toLocaleString('vi-VN')
            : 'Không rõ';

        savedInfo.innerHTML = `📊 Có ${result.lmsData.length} môn học đã lưu<br><small>Lần quét: ${timeStr}</small>`;
        savedSection.style.display = 'block';
    }
}

// Kiểm tra trạng thái crawl
function startStatusCheck() {
    const statusEl = document.getElementById('status');
    const btn = document.getElementById('scanBtn');

    const checkInterval = setInterval(async () => {
        chrome.runtime.sendMessage({ action: 'getStatus' }, async (response) => {
            if (!response) return;

            if (response.isRunning) {
                const progress = response.current + 1;
                const total = response.total;
                statusEl.innerHTML = `🔄 Đang xử lý môn ${progress}/${total}...<br><small>Đã thu thập: ${response.collected} môn</small>`;
            } else {
                clearInterval(checkInterval);

                // Reload saved data
                await loadSavedData();

                if (response.collected > 0) {
                    statusEl.innerHTML = `✅ Hoàn thành!<br><small>Đã lưu ${response.collected} môn học</small>`;
                    statusEl.style.color = 'green';
                } else {
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
