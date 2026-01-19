document.getElementById('scanBtn').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: extractData
    }, (results) => {
        if (results && results[0] && results[0].result) {
            const data = results[0].result;
            navigator.clipboard.writeText(JSON.stringify(data)).then(() => {
                document.getElementById('status').innerText = `Đã copy ${data.length} môn học!`;
                document.getElementById('status').style.color = 'green';
            });
        } else {
            document.getElementById('status').innerText = "Không tìm thấy dữ liệu!";
            document.getElementById('status').style.color = 'red';
        }
    });
});

function extractData() {
    const rows = document.querySelectorAll('tr.ant-table-row');
    const data = [];

    rows.forEach(row => {
        const nameEl = row.querySelector('.course-info__name span'); // Lấy span bên trong
        const pointsEl = row.querySelector('.total-point');

        if (nameEl && pointsEl) {
            const name = nameEl.innerText.trim();
            // Lấy text kiểu "12.49/14"
            const poinText = pointsEl.innerText.trim();
            const parts = poinText.split('/');

            if (parts.length === 2) {
                data.push({
                    name: name,
                    completed: parseFloat(parts[0]),
                    total: parseFloat(parts[1])
                });
            }
        }
    });

    return data;
}
