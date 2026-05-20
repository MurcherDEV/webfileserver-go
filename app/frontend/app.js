const API_BASE = '/api';
let currentPath = '/';

// DOM Elements
const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const fileList = document.getElementById('file-list');
const breadcrumbs = document.getElementById('breadcrumbs');
const fileUpload = document.getElementById('file-upload');
const logoutBtn = document.getElementById('logout-btn');
const toastContainer = document.getElementById('toast-container');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadFilename = document.getElementById('upload-filename');
const uploadPercentage = document.getElementById('upload-percentage');
const progressBarFill = document.getElementById('progress-bar-fill');
const searchInput = document.getElementById('search-input');
const createBtn = document.getElementById('create-btn');
const createFolderBtn = document.getElementById('create-folder-btn');
const previewModal = document.getElementById('preview-modal');
const previewOverlay = document.getElementById('preview-overlay');
const previewCloseBtn = document.getElementById('preview-close-btn');
const previewDownloadBtn = document.getElementById('preview-download-btn');
const previewTitle = document.getElementById('preview-title');
const previewContent = document.getElementById('preview-content');
const dropZone = document.getElementById('drop-zone');
const storageFill = document.getElementById('storage-fill');
const storageText = document.getElementById('storage-text');

// Authentication
function getAuthHeaders() {
    const auth = sessionStorage.getItem('auth');
    return {
        'Authorization': `Basic ${auth}`
    };
}

function checkAuth() {
    const auth = sessionStorage.getItem('auth');
    if (auth) {
        loginContainer.classList.add('hidden');
        appContainer.classList.remove('hidden');
        switchTab('drive');
    } else {
        loginContainer.classList.remove('hidden');
        appContainer.classList.add('hidden');
    }
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const auth = btoa(`${user}:${pass}`);
    
    try {
        // Test auth by fetching root
        const res = await fetch(`${API_BASE}/files?path=/`, {
            headers: { 'Authorization': `Basic ${auth}` }
        });
        
        if (res.ok) {
            sessionStorage.setItem('auth', auth);
            loginError.classList.add('hidden');
            checkAuth();
        } else {
            loginError.classList.remove('hidden');
        }
    } catch (err) {
        showToast('Connection error', 'error');
    }
});

logoutBtn.addEventListener('click', () => {
    sessionStorage.removeItem('auth');
    checkAuth();
});

// Tabs Navigation
document.getElementById('tab-drive').addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('drive');
});
document.getElementById('tab-starred').addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('starred');
});
document.getElementById('tab-trash').addEventListener('click', (e) => {
    e.preventDefault();
    switchTab('trash');
});

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.side-nav a').forEach(a => a.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    
    if (tab === 'trash') {
        createBtn.style.opacity = '0.5';
        createBtn.style.pointerEvents = 'none';
        breadcrumbs.innerHTML = `<span class="crumb active">Корзина</span>`;
    } else if (tab === 'starred') {
        createBtn.style.opacity = '0.5';
        createBtn.style.pointerEvents = 'none';
        breadcrumbs.innerHTML = `<span class="crumb active">Помеченные</span>`;
    } else {
        createBtn.style.opacity = '1';
        createBtn.style.pointerEvents = 'auto';
        currentPath = '/';
        updateBreadcrumbs();
    }
    
    loadFiles(currentPath);
}

// File Management
async function loadFiles(path, background = false) {
    if (currentTab === 'drive') {
        currentPath = path;
        updateBreadcrumbs();
    }
    
    if (!background) {
        fileList.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Загрузка файлов...</p>
            </div>
        `;
    }

    try {
        let url = `${API_BASE}/files?path=${encodeURIComponent(path)}`;
        if (currentTab === 'starred') {
            url = `${API_BASE}/files?path=${encodeURIComponent(path)}&starred=true`;
        } else if (currentTab === 'trash') {
            url = `${API_BASE}/trash`;
        }

        const res = await fetch(url, {
            headers: getAuthHeaders()
        });
        
        if (res.status === 401) {
            sessionStorage.removeItem('auth');
            checkAuth();
            return;
        }
        
        const files = await res.json();
        renderFiles(files);
        if (currentTab === 'drive') {
            updateSpaceInfo();
        }
    } catch (err) {
        if (!background) {
            showToast('Не удалось загрузить файлы', 'error');
            fileList.innerHTML = '<div class="loading-state"><p>Ошибка загрузки файлов.</p></div>';
        }
    }
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec) {
    if (bytesPerSec === 0 || !isFinite(bytesPerSec)) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function renderFiles(files) {
    if (!files || files.length === 0) {
        fileList.innerHTML = `
            <div class="loading-state" style="opacity: 0.5">
                <i class='bx bx-folder-open' style="font-size: 3rem; margin-bottom: 1rem"></i>
                <p>This folder is empty</p>
            </div>
        `;
        return;
    }

    // Sort: Folders first, then alphabetical
    files.sort((a, b) => {
        if (a.is_dir === b.is_dir) return a.name.localeCompare(b.name);
        return a.is_dir ? -1 : 1;
    });

    fileList.innerHTML = files.map(file => `
        <div class="file-item ${file.is_dir ? 'dir' : 'file'}" data-path="${file.path}" data-isdir="${file.is_dir}" data-size="${file.size}">
            <div class="col-name" title="${file.name}">
                <i class='bx ${file.is_dir ? 'bxs-folder' : 'bx-file'}'></i>
                <span>${file.name}</span>
            </div>
            <div class="col-size">${file.is_dir ? '--' : formatSize(file.size)}</div>
            <div class="col-actions">
                ${currentTab !== 'trash' ? `
                    ${!file.is_dir ? `<button class="action-btn download" title="Скачать" onclick="downloadFile('${file.path}', event)"><i class='bx bx-download'></i></button>` : ''}
                    <button class="action-btn rename" title="Переименовать" onclick="renameFile('${file.path}', '${file.name}', event)"><i class='bx bx-rename'></i></button>
                    <button class="action-btn star" title="Пометить" onclick="toggleStar('${file.path}', event)"><i class='bx ${file.is_starred ? 'bxs-star' : 'bx-star'}' ${file.is_starred ? 'style="color: #fbbc04;"' : ''}></i></button>
                    <button class="action-btn delete" title="Удалить" onclick="deleteFile('${file.path}', event)"><i class='bx bx-trash'></i></button>
                ` : `
                    <button class="action-btn" title="Восстановить" onclick="restoreFile('${file.path}', event)"><i class='bx bx-revision'></i></button>
                    <button class="action-btn delete" title="Удалить навсегда" onclick="deleteFile('${file.path}', event)"><i class='bx bx-trash'></i></button>
                `}
            </div>
        </div>
    `).join('');

    // Add click listeners for navigation
    document.querySelectorAll('.file-item').forEach(item => {
        item.addEventListener('click', (e) => {
            // Prevent if clicked on action buttons
            if (e.target.closest('.col-actions')) return;
            
            if (item.dataset.isdir === 'true') {
                loadFiles(item.dataset.path);
            } else {
                previewFile(item.dataset.path, parseInt(item.dataset.size));
            }
        });
    });
}

function updateBreadcrumbs() {
    const parts = currentPath.split('/').filter(p => p);
    let html = `<span class="crumb ${parts.length === 0 ? 'active' : ''}" data-path="/">Home</span>`;
    
    let pathAcc = '';
    parts.forEach((part, index) => {
        pathAcc += '/' + part;
        const isLast = index === parts.length - 1;
        html += `<span class="crumb-separator">/</span>`;
        html += `<span class="crumb ${isLast ? 'active' : ''}" data-path="${pathAcc}">${part}</span>`;
    });
    
    breadcrumbs.innerHTML = html;
    
    // Add listeners
    document.querySelectorAll('.crumb').forEach(crumb => {
        crumb.addEventListener('click', () => {
            if (!crumb.classList.contains('active')) {
                loadFiles(crumb.dataset.path);
            }
        });
    });
}

// Actions
async function downloadFile(path, event) {
    if (event) event.stopPropagation();
    
    const headers = getAuthHeaders();
    try {
        const response = await fetch(`${API_BASE}/download?path=${encodeURIComponent(path)}`, { headers });
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = path.split('/').pop();
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } else {
            showToast('Failed to download file', 'error');
        }
    } catch (err) {
        showToast('Download error', 'error');
    }
}

// Preview functionality
const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
const textExtensions = ['txt', 'md', 'csv', 'log', 'json', 'go', 'js', 'html', 'css', 'yaml', 'yml', 'xml', 'sh', 'py'];
let currentPreviewPath = '';

function getExtension(filename) {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

async function previewFile(path, size) {
    const filename = path.split('/').pop();
    const ext = getExtension(filename);
    const url = `${API_BASE}/download?path=${encodeURIComponent(path)}`;

    currentPreviewPath = path;
    previewTitle.textContent = filename;
    previewContent.innerHTML = '<div class="spinner"></div>';
    previewModal.classList.remove('hidden');

    if (imageExtensions.includes(ext)) {
        const img = document.createElement('img');
        // Fetch with auth headers to support basic auth natively via JS blob (otherwise img src bypasses JS fetch)
        try {
            const res = await fetch(url, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error();
            const blob = await res.blob();
            img.src = window.URL.createObjectURL(blob);
            previewContent.innerHTML = '';
            previewContent.appendChild(img);
        } catch {
            previewContent.innerHTML = '<p>Не удалось загрузить изображение.</p>';
        }
    } else if (textExtensions.includes(ext)) {
        if (size > 2 * 1024 * 1024) { // 2MB limit
            previewContent.innerHTML = '<p>Файл слишком большой для предпросмотра (лимит 2 МБ).<br>Пожалуйста, скачайте файл.</p>';
            return;
        }
        try {
            const res = await fetch(url, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Ошибка сети');
            const text = await res.text();
            const pre = document.createElement('pre');
            pre.textContent = text;
            previewContent.innerHTML = '';
            previewContent.appendChild(pre);
        } catch (err) {
            previewContent.innerHTML = '<p>Не удалось загрузить текстовый файл.</p>';
        }
    } else {
        previewModal.classList.add('hidden');
        showToast('Предпросмотр недоступен, начинается скачивание...', 'info');
        downloadFile(path, null);
    }
}

previewCloseBtn.addEventListener('click', () => {
    previewModal.classList.add('hidden');
    previewContent.innerHTML = '';
});

previewOverlay.addEventListener('click', () => {
    previewModal.classList.add('hidden');
    previewContent.innerHTML = '';
});

previewDownloadBtn.addEventListener('click', () => {
    if (currentPreviewPath) {
        downloadFile(currentPreviewPath, null);
    }
});

async function toggleStar(path, e) {
    e.stopPropagation();
    try {
        const res = await fetch(`${API_BASE}/star?path=${encodeURIComponent(path)}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            loadFiles(currentPath, true); // background reload
        }
    } catch (err) {}
}

async function restoreFile(path, e) {
    e.stopPropagation();
    try {
        const res = await fetch(`${API_BASE}/restore?path=${encodeURIComponent(path)}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            showToast('Файл восстановлен', 'success');
            loadFiles(currentPath, true);
        } else {
            showToast('Ошибка при восстановлении', 'error');
        }
    } catch (err) {
        showToast('Ошибка соединения', 'error');
    }
}

async function deleteFile(path, e) {
    e.stopPropagation();
    if (!confirm(currentTab === 'trash' ? 'Вы уверены, что хотите удалить файл навсегда?' : 'Переместить в корзину?')) return;

    try {
        const res = await fetch(`${API_BASE}/delete?path=${encodeURIComponent(path)}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (res.ok) {
            showToast(currentTab === 'trash' ? 'Удалено навсегда' : 'Перемещено в корзину', 'success');
            loadFiles(currentPath, true); // soft reload
        } else {
            showToast('Не удалось удалить файл', 'error');
        }
    } catch (err) {
        showToast('Ошибка соединения', 'error');
    }
}

fileUpload.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (files.length === 0) return;

    for (let file of files) {
        await uploadFileWithProgress(file);
    }
    
    fileUpload.value = ''; // Reset
    loadFiles(currentPath, true); // reload softly
});

function uploadFileWithProgress(file) {
    return new Promise((resolve) => {
        const formData = new FormData();
        formData.append('file', file);

        uploadProgressContainer.classList.remove('hidden');
        uploadFilename.textContent = `Uploading: ${file.name}`;
        uploadPercentage.textContent = '0%';
        progressBarFill.style.width = '0%';

        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/upload?path=${encodeURIComponent(currentPath)}`, true);
        
        // Add Authorization header
        const auth = sessionStorage.getItem('auth');
        xhr.setRequestHeader('Authorization', `Basic ${auth}`);

        let uploadStartTime = Date.now();
        let lastTime = uploadStartTime;
        let lastLoaded = 0;

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const currentTime = Date.now();
                const timeDiff = (currentTime - lastTime) / 1000; // in seconds
                
                if (timeDiff > 0.5) { // update speed every 500ms
                    const bytesDiff = e.loaded - lastLoaded;
                    const speedBps = bytesDiff / timeDiff;
                    document.getElementById('upload-speed').textContent = formatSpeed(speedBps);
                    
                    lastTime = currentTime;
                    lastLoaded = e.loaded;
                }

                const percentComplete = Math.round((e.loaded / e.total) * 100);
                uploadPercentage.textContent = `${percentComplete}%`;
                progressBarFill.style.width = `${percentComplete}%`;
            }
        };

        xhr.onload = () => {
            if (xhr.status === 200) {
                showToast(`${file.name} uploaded`, 'success');
            } else {
                showToast(`Failed to upload ${file.name}`, 'error');
            }
            uploadProgressContainer.classList.add('hidden');
            resolve(); // Resolve anyway to continue with the next file
        };

        xhr.onerror = () => {
            showToast(`Error uploading ${file.name}`, 'error');
            uploadProgressContainer.classList.add('hidden');
            resolve();
        };

        xhr.send(formData);
    });
}



// Create Folder

createFolderBtn.addEventListener('click', async () => {
    const folderName = prompt('Введите имя новой папки:');
    if (!folderName) return;
    
    try {
        const fullPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
        const res = await fetch(`${API_BASE}/mkdir?path=${encodeURIComponent(fullPath)}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        
        if (res.ok) {
            showToast(`Папка ${folderName} создана`, 'success');
            loadFiles(currentPath, true); // reload softly
        } else {
            showToast(`Не удалось создать папку`, 'error');
        }
    } catch (err) {
        showToast('Ошибка соединения', 'error');
    }
});

// Global Search
let searchTimeout;
searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    
    if (query === '') {
        loadFiles(currentPath, true);
        return;
    }
    
    searchTimeout = setTimeout(async () => {
        fileList.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Поиск...</p></div>`;
        try {
            const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`, {
                headers: getAuthHeaders()
            });
            
            if (res.ok) {
                const files = await res.json();
                renderFiles(files);
                breadcrumbs.innerHTML = `<span class="crumb active">Результаты поиска для "${query}"</span>`;
            } else {
                showToast(`Ошибка поиска`, 'error');
            }
        } catch (err) {
            console.error(err);
        }
    }, 400);
});

// UI Helpers
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'bx-check-circle' : 'bx-x-circle';
    
    toast.innerHTML = `
        <i class='bx ${icon}' style="font-size: 1.5rem"></i>
        <span>${message}</span>
    `;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'slideInRight 0.3s ease-in reverse forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Disk Space Info
async function updateSpaceInfo() {
    try {
        const res = await fetch(`${API_BASE}/space`, { headers: getAuthHeaders() });
        if (res.ok) {
            const data = await res.json();
            const percent = (data.used / data.total) * 100;
            storageFill.style.width = `${percent}%`;
            storageText.textContent = `Использовано ${formatSize(data.used)} из ${formatSize(data.total)}`;
        }
    } catch (err) {
        console.error("Не удалось обновить информацию о месте:", err);
    }
}

// Rename
async function renameFile(path, oldName, e) {
    if (e) e.stopPropagation();
    const newName = prompt(`Введите новое имя для ${oldName}:`, oldName);
    if (!newName || newName === oldName) return;

    try {
        const res = await fetch(`${API_BASE}/rename?path=${encodeURIComponent(path)}&new_name=${encodeURIComponent(newName)}`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        if (res.ok) {
            showToast('Переименовано успешно');
            loadFiles(currentPath, true);
        } else {
            showToast('Ошибка при переименовании', 'error');
        }
    } catch (err) {
        showToast('Ошибка при переименовании', 'error');
    }
}

// Drag and Drop
document.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!e.dataTransfer.types.includes('Files')) return;
    dropZone.classList.remove('hidden');
});

document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (e.clientX === 0 && e.clientY === 0) {
        dropZone.classList.add('hidden');
    }
});

document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.add('hidden');
    
    if (currentTab !== 'drive') {
        showToast('Пожалуйста, перейдите в "Мой диск" для загрузки', 'error');
        return;
    }

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
        await uploadFileWithProgress(files[i]);
    }
    loadFiles(currentPath, true);
});

// Init
checkAuth();
