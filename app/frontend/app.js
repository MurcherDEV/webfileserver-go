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
const themeToggle = document.getElementById('theme-toggle');
const logoutBtn = document.getElementById('logout-btn');
const toastContainer = document.getElementById('toast-container');

// Authentication
function getAuthHeaders() {
    const auth = sessionStorage.getItem('auth');
    return {
        'Authorization': `Basic ${auth}`
    };
}

function checkAuth() {
    if (sessionStorage.getItem('auth')) {
        loginContainer.classList.add('hidden');
        appContainer.classList.remove('hidden');
        loadFiles(currentPath);
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

// File Management
async function loadFiles(path) {
    currentPath = path;
    updateBreadcrumbs();
    
    fileList.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading files...</p>
        </div>
    `;

    try {
        const res = await fetch(`${API_BASE}/files?path=${encodeURIComponent(path)}`, {
            headers: getAuthHeaders()
        });
        
        if (res.status === 401) {
            sessionStorage.removeItem('auth');
            checkAuth();
            return;
        }
        
        const files = await res.json();
        renderFiles(files);
    } catch (err) {
        showToast('Failed to load files', 'error');
        fileList.innerHTML = '<div class="loading-state"><p>Error loading files.</p></div>';
    }
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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
        <div class="file-item ${file.is_dir ? 'dir' : 'file'}" data-path="${file.path}" data-isdir="${file.is_dir}">
            <div class="col-icon">
                <i class='bx ${file.is_dir ? 'bxs-folder' : 'bx-file'}'></i>
            </div>
            <div class="col-name" title="${file.name}">${file.name}</div>
            <div class="col-size">${file.is_dir ? '--' : formatSize(file.size)}</div>
            <div class="col-actions">
                ${!file.is_dir ? `<button class="action-btn download" title="Download" onclick="downloadFile('${file.path}', event)"><i class='bx bx-download'></i></button>` : ''}
                <button class="action-btn delete" title="Delete" onclick="deleteFile('${file.path}', event)"><i class='bx bx-trash'></i></button>
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
                downloadFile(item.dataset.path, e);
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

async function deleteFile(path, event) {
    if (event) event.stopPropagation();
    
    if (!confirm(`Are you sure you want to delete ${path.split('/').pop()}?`)) return;
    
    try {
        const res = await fetch(`${API_BASE}/delete?path=${encodeURIComponent(path)}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        
        if (res.ok) {
            showToast('Deleted successfully', 'success');
            loadFiles(currentPath);
        } else {
            showToast('Failed to delete', 'error');
        }
    } catch (err) {
        showToast('Delete error', 'error');
    }
}

fileUpload.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (files.length === 0) return;

    for (let file of files) {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch(`${API_BASE}/upload?path=${encodeURIComponent(currentPath)}`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: formData
            });

            if (res.ok) {
                showToast(`${file.name} uploaded`, 'success');
            } else {
                showToast(`Failed to upload ${file.name}`, 'error');
            }
        } catch (err) {
            showToast(`Error uploading ${file.name}`, 'error');
        }
    }
    
    fileUpload.value = ''; // Reset
    loadFiles(currentPath);
});

// Theme
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
    const icon = themeToggle.querySelector('i');
    if (document.body.classList.contains('dark-mode')) {
        icon.classList.replace('bx-moon', 'bx-sun');
    } else {
        icon.classList.replace('bx-sun', 'bx-moon');
    }
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

// Init
checkAuth();
