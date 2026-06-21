const API_BASE = '/app/api';
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
const navCreateToggle = document.getElementById('nav-create-toggle');
const navCreateMenu = document.getElementById('nav-create-menu');
const previewModal = document.getElementById('preview-modal');
const previewOverlay = document.getElementById('preview-overlay');
const previewCloseBtn = document.getElementById('preview-close-btn');
const previewDownloadBtn = document.getElementById('preview-download-btn');
const previewTitle = document.getElementById('preview-title');
const previewContent = document.getElementById('preview-content');
const previewEditBtn = document.getElementById('preview-edit-btn');
const previewSaveBtn = document.getElementById('preview-save-btn');
const previewCancelBtn = document.getElementById('preview-cancel-btn');
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
        createBtn.style.display = 'none';
        breadcrumbs.innerHTML = `<span class="crumb active">Корзина</span>`;
    } else if (tab === 'starred') {
        createBtn.style.display = 'none';
        breadcrumbs.innerHTML = `<span class="crumb active">Помеченные</span>`;
    } else {
        createBtn.style.display = '';
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
    
    try {
        // Get a one-time download token (authenticated)
        const tokenRes = await fetch(`${API_BASE}/download-token?path=${encodeURIComponent(path)}`, {
            headers: getAuthHeaders()
        });
        
        if (!tokenRes.ok) {
            showToast('Не удалось подготовить загрузку', 'error');
            return;
        }
        
        const { token } = await tokenRes.json();
        
        // Browser-native download — no fetch buffering, instant start
        const a = document.createElement('a');
        a.href = `${API_BASE}/dl?token=${encodeURIComponent(token)}`;
        a.download = path.split('/').pop();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch (err) {
        showToast('Ошибка загрузки', 'error');
    }
}

// Preview functionality
const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
const textExtensions = ['txt', 'md', 'csv', 'log', 'json', 'go', 'js', 'html', 'css', 'yaml', 'yml', 'xml', 'sh', 'py'];
const docxExtensions = ['docx'];
const pptxExtensions = ['pptx'];
const pdfExtensions = ['pdf'];
const docLegacyExtensions = ['doc'];
const editableExtensions = ['txt', 'md', 'csv', 'log', 'json', 'go', 'js', 'html', 'css', 'yaml', 'yml', 'xml', 'sh', 'py'];
let currentPreviewPath = '';
let isEditMode = false;
let originalTextContent = '';

function getExtension(filename) {
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function setEditorMode(editing) {
    isEditMode = editing;
    previewEditBtn.classList.toggle('hidden', editing);
    previewSaveBtn.classList.toggle('hidden', !editing);
    previewCancelBtn.classList.toggle('hidden', !editing);
}

function hideEditorButtons() {
    previewEditBtn.classList.add('hidden');
    previewSaveBtn.classList.add('hidden');
    previewCancelBtn.classList.add('hidden');
}

async function previewFile(path, size) {
    const filename = path.split('/').pop();
    const ext = getExtension(filename);
    const url = `${API_BASE}/download?path=${encodeURIComponent(path)}`;

    currentPreviewPath = path;
    previewTitle.textContent = filename;
    previewContent.innerHTML = '<div class="spinner"></div>';
    previewModal.classList.remove('hidden');
    hideEditorButtons();
    isEditMode = false;

    if (imageExtensions.includes(ext)) {
        // === Image preview ===
        try {
            const res = await fetch(url, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error();
            const blob = await res.blob();
            const img = document.createElement('img');
            img.src = window.URL.createObjectURL(blob);
            previewContent.innerHTML = '';
            previewContent.appendChild(img);
        } catch {
            previewContent.innerHTML = '<p>Не удалось загрузить изображение.</p>';
        }
    } else if (textExtensions.includes(ext)) {
        // === Text preview + editor ===
        if (size > 2 * 1024 * 1024) {
            previewContent.innerHTML = '<p>Файл слишком большой для предпросмотра (лимит 2 МБ).<br>Пожалуйста, скачайте файл.</p>';
            return;
        }
        try {
            const res = await fetch(url, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error('Ошибка сети');
            const text = await res.text();
            originalTextContent = text;
            const pre = document.createElement('pre');
            pre.textContent = text;
            previewContent.innerHTML = '';
            previewContent.appendChild(pre);
            // Show edit button for editable files
            if (editableExtensions.includes(ext)) {
                previewEditBtn.classList.remove('hidden');
            }
        } catch (err) {
            previewContent.innerHTML = '<p>Не удалось загрузить текстовый файл.</p>';
        }
    } else if (docxExtensions.includes(ext)) {
        // === DOCX preview via mammoth.js ===
        if (size > 50 * 1024 * 1024) {
            previewContent.innerHTML = '<p>Файл слишком большой для предпросмотра (лимит 50 МБ).<br>Пожалуйста, скачайте файл.</p>';
            return;
        }
        try {
            const res = await fetch(url, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error();
            const arrayBuffer = await res.arrayBuffer();
            const result = await mammoth.convertToHtml({ arrayBuffer: arrayBuffer });
            const wrapper = document.createElement('div');
            wrapper.className = 'docx-preview';
            wrapper.innerHTML = result.value;
            previewContent.innerHTML = '';
            previewContent.appendChild(wrapper);
        } catch (err) {
            previewContent.innerHTML = '<p>Не удалось загрузить документ DOCX.</p>';
        }
    } else if (docLegacyExtensions.includes(ext)) {
        // === DOC — unsupported format ===
        previewContent.innerHTML = `
            <div class="unsupported-preview">
                <i class='bx bxs-file-doc' style="font-size: 4rem; color: #185abd; margin-bottom: 16px;"></i>
                <h3>Предпросмотр .doc недоступен</h3>
                <p>Формат .doc (Microsoft Word 97-2003) не поддерживает предпросмотр в браузере.</p>
                <p>Пожалуйста, скачайте файл или сконвертируйте в .docx</p>
                <button class="btn primary-btn" style="margin-top: 16px; width: auto; padding: 10px 32px;" onclick="downloadFile('${path}', null)">
                    <i class='bx bx-download'></i> Скачать файл
                </button>
            </div>
        `;
    } else if (pptxExtensions.includes(ext)) {
        // === PPTX preview via JSZip ===
        if (size > 100 * 1024 * 1024) {
            previewContent.innerHTML = '<p>Файл слишком большой для предпросмотра (лимит 100 МБ).<br>Пожалуйста, скачайте файл.</p>';
            return;
        }
        try {
            const res = await fetch(url, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error();
            const arrayBuffer = await res.arrayBuffer();
            await renderPptxPreview(arrayBuffer);
        } catch (err) {
            previewContent.innerHTML = '<p>Не удалось загрузить презентацию PPTX.</p>';
        }
    } else if (pdfExtensions.includes(ext)) {
        // === PDF preview via native browser renderer ===
        try {
            const res = await fetch(url, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error();
            const blob = await res.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const iframe = document.createElement('iframe');
            iframe.className = 'pdf-preview';
            iframe.src = blobUrl;
            previewContent.innerHTML = '';
            previewContent.appendChild(iframe);
            // Cleanup blob URL when preview is closed
            iframe.dataset.blobUrl = blobUrl;
        } catch (err) {
            previewContent.innerHTML = '<p>Не удалось загрузить PDF.</p>';
        }
    } else {
        previewModal.classList.add('hidden');
        showToast('Предпросмотр недоступен, начинается скачивание...', 'info');
        downloadFile(path, null);
    }
}

// === PPTX Renderer ===
async function renderPptxPreview(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    
    // Find all slide files
    const slideFiles = Object.keys(zip.files)
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
        .sort((a, b) => {
            const numA = parseInt(a.match(/slide(\d+)/)[1]);
            const numB = parseInt(b.match(/slide(\d+)/)[1]);
            return numA - numB;
        });

    if (slideFiles.length === 0) {
        previewContent.innerHTML = '<p>Слайды не найдены в файле.</p>';
        return;
    }

    // Parse each slide
    const slides = [];
    for (const slideFile of slideFiles) {
        const xmlStr = await zip.file(slideFile).async('string');
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlStr, 'application/xml');
        
        // Extract text blocks
        const textElements = xmlDoc.getElementsByTagName('a:t');
        const paragraphs = xmlDoc.getElementsByTagName('a:p');
        const slideTexts = [];
        
        for (let p = 0; p < paragraphs.length; p++) {
            const para = paragraphs[p];
            const runs = para.getElementsByTagName('a:t');
            let paraText = '';
            for (let r = 0; r < runs.length; r++) {
                paraText += runs[r].textContent;
            }
            if (paraText.trim()) {
                // Check if this paragraph has large font (title)
                const fontSizeEl = para.getElementsByTagName('a:sz');
                let fontSize = 1800; // default
                if (fontSizeEl.length === 0) {
                    const rPr = para.getElementsByTagName('a:rPr');
                    for (let i = 0; i < rPr.length; i++) {
                        if (rPr[i].getAttribute('sz')) {
                            fontSize = parseInt(rPr[i].getAttribute('sz'));
                            break;
                        }
                    }
                }
                const defRPr = para.getElementsByTagName('a:defRPr');
                for (let i = 0; i < defRPr.length; i++) {
                    if (defRPr[i].getAttribute('sz')) {
                        fontSize = parseInt(defRPr[i].getAttribute('sz'));
                        break;
                    }
                }
                // Also check endParaRPr
                const endRPr = para.getElementsByTagName('a:endParaRPr');
                // Check run properties
                const runProps = para.getElementsByTagName('a:rPr');
                for (let i = 0; i < runProps.length; i++) {
                    if (runProps[i].getAttribute('sz')) {
                        fontSize = parseInt(runProps[i].getAttribute('sz'));
                        break;
                    }
                }
                
                slideTexts.push({
                    text: paraText.trim(),
                    isTitle: fontSize >= 2400,
                    fontSize: fontSize
                });
            }
        }
        
        slides.push(slideTexts);
    }

    // Render slides viewer
    let currentSlide = 0;
    
    function renderSlide(index) {
        const slide = slides[index];
        const viewer = document.createElement('div');
        viewer.className = 'pptx-viewer';
        
        const slideEl = document.createElement('div');
        slideEl.className = 'pptx-slide';
        
        if (slide.length === 0) {
            slideEl.innerHTML = '<p class="pptx-empty">Пустой слайд</p>';
        } else {
            slide.forEach(item => {
                const el = document.createElement(item.isTitle ? 'h2' : 'p');
                el.textContent = item.text;
                if (item.isTitle) el.className = 'pptx-title';
                else el.className = 'pptx-text';
                slideEl.appendChild(el);
            });
        }
        
        const nav = document.createElement('div');
        nav.className = 'pptx-nav';
        nav.innerHTML = `
            <button class="pptx-nav-btn" id="pptx-prev" ${index === 0 ? 'disabled' : ''}>
                <i class='bx bx-chevron-left'></i>
            </button>
            <span class="pptx-page">Слайд ${index + 1} из ${slides.length}</span>
            <button class="pptx-nav-btn" id="pptx-next" ${index === slides.length - 1 ? 'disabled' : ''}>
                <i class='bx bx-chevron-right'></i>
            </button>
        `;
        
        viewer.appendChild(slideEl);
        viewer.appendChild(nav);
        
        previewContent.innerHTML = '';
        previewContent.appendChild(viewer);
        
        // Nav event listeners
        document.getElementById('pptx-prev').addEventListener('click', () => {
            if (currentSlide > 0) {
                currentSlide--;
                renderSlide(currentSlide);
            }
        });
        document.getElementById('pptx-next').addEventListener('click', () => {
            if (currentSlide < slides.length - 1) {
                currentSlide++;
                renderSlide(currentSlide);
            }
        });
    }
    
    renderSlide(0);
}

// === TXT Editor ===
previewEditBtn.addEventListener('click', () => {
    const pre = previewContent.querySelector('pre');
    if (!pre) return;
    
    originalTextContent = pre.textContent;
    const textarea = document.createElement('textarea');
    textarea.className = 'text-editor';
    textarea.value = originalTextContent;
    textarea.spellcheck = false;
    previewContent.innerHTML = '';
    previewContent.appendChild(textarea);
    textarea.focus();
    setEditorMode(true);
});

previewSaveBtn.addEventListener('click', async () => {
    const textarea = previewContent.querySelector('textarea');
    if (!textarea || !currentPreviewPath) return;
    
    const content = textarea.value;
    previewSaveBtn.disabled = true;
    previewSaveBtn.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Сохранение...';
    
    try {
        const res = await fetch(`${API_BASE}/save?path=${encodeURIComponent(currentPreviewPath)}`, {
            method: 'POST',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'text/plain'
            },
            body: content
        });
        
        if (res.ok) {
            showToast('Файл сохранён', 'success');
            originalTextContent = content;
            // Switch back to preview mode
            const pre = document.createElement('pre');
            pre.textContent = content;
            previewContent.innerHTML = '';
            previewContent.appendChild(pre);
            setEditorMode(false);
            previewEditBtn.classList.remove('hidden');
        } else {
            showToast('Ошибка при сохранении файла', 'error');
        }
    } catch (err) {
        showToast('Ошибка соединения', 'error');
    } finally {
        previewSaveBtn.disabled = false;
        previewSaveBtn.innerHTML = '<i class="bx bx-save"></i> Сохранить';
    }
});

previewCancelBtn.addEventListener('click', () => {
    const pre = document.createElement('pre');
    pre.textContent = originalTextContent;
    previewContent.innerHTML = '';
    previewContent.appendChild(pre);
    setEditorMode(false);
    previewEditBtn.classList.remove('hidden');
});

function closePreview() {
    // Cleanup blob URLs (e.g. PDF preview)
    const iframe = previewContent.querySelector('iframe[data-blob-url]');
    if (iframe) window.URL.revokeObjectURL(iframe.dataset.blobUrl);
    previewModal.classList.add('hidden');
    previewContent.innerHTML = '';
    hideEditorButtons();
    isEditMode = false;
}

previewCloseBtn.addEventListener('click', () => {
    if (isEditMode) {
        if (!confirm('Вы уверены? Несохранённые изменения будут потеряны.')) return;
    }
    closePreview();
});

previewOverlay.addEventListener('click', () => {
    if (isEditMode) {
        if (!confirm('Вы уверены? Несохранённые изменения будут потеряны.')) return;
    }
    closePreview();
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

// Create menu toggle (click-based accordion)
navCreateToggle.addEventListener('click', (e) => {
    e.preventDefault();
    createBtn.classList.toggle('open');
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

// Mobile Sidebar Toggle
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const hamburgerBtn = document.getElementById('hamburger-btn');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');

function openSidebar() {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('visible');
    document.body.style.overflow = '';
}

hamburgerBtn.addEventListener('click', openSidebar);
sidebarCloseBtn.addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

// Close sidebar on navigation (mobile)
document.querySelectorAll('.side-nav a').forEach(a => {
    a.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            closeSidebar();
        }
    });
});

// Init
checkAuth();
