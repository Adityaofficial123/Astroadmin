'use strict';

// --- 1. FIREBASE INIT ---
const firebaseReady = typeof firebase !== 'undefined'
    && typeof CONFIG !== 'undefined'
    && !!CONFIG?.firebase;

let auth = null;
let db = null;
let storage = null;

if (firebaseReady) {
    if (!firebase.apps.length) firebase.initializeApp(CONFIG.firebase);
    auth = firebase.auth();
    db = firebase.database();
    if (typeof firebase.storage === 'function') {
        storage = firebase.storage();
    } else {
        console.warn('[Admin] Firebase Storage SDK is not loaded. Using Cloudinary or inline database fallback for uploads.');
    }
} else {
    console.error('[Admin] Firebase SDK or CONFIG.firebase is missing.');
}

// --- 2. STATE & VARIABLES ---
let membersData = {};
let eventsData = {};
let galleryData = {};
let settingsData = {};
let dashboardInitialized = false;
let inlineUploadNoticeShown = false;

// --- 3. AUTHENTICATION ---
if (auth) {
auth.onAuthStateChanged(user => {
    const overlay = document.getElementById('loginOverlay');
    const msg = document.getElementById('authMsg');

    if (user) {
        overlay?.classList.add('hidden');
        if (msg) msg.textContent = '';
        if (!dashboardInitialized) {
            dashboardInitialized = true;
            initDashboard(); // Start loading data once
        }
    } else {
        overlay?.classList.remove('hidden');
    }
});
}

function getAuthErrorMessage(err) {
    const code = String(err?.code || '');
    if (code === 'auth/invalid-credential') return 'Invalid email or password.';
    if (code === 'auth/wrong-password') return 'Incorrect password.';
    if (code === 'auth/user-not-found') return 'No user found with this email.';
    if (code === 'auth/invalid-email') return 'Email format is invalid.';
    if (code === 'auth/too-many-requests') return 'Too many attempts. Try again in a few minutes.';
    if (code === 'auth/network-request-failed') return 'Network error. Check internet connection.';
    if (code === 'auth/operation-not-allowed') return 'Email/password sign-in is disabled in Firebase console.';
    if (code === 'auth/web-storage-unsupported') return 'Browser storage is blocked. Try normal mode (not strict private mode).';
    if (code === 'auth/unauthorized-domain') return 'This domain is not authorized in Firebase Authentication settings. Add localhost and 127.0.0.1 in Firebase Authorized Domains.';
    if (code === 'auth/requests-from-referer-<empty>-are-blocked') return 'Open admin via a local server (for example http://127.0.0.1:3002/admin.html), not directly as file://';
    return err?.message || 'Authentication failed.';
}

async function setBestPersistence() {
    if (!firebase?.auth?.Auth?.Persistence) return;
    const prefs = [
        firebase.auth.Auth.Persistence.LOCAL,
        firebase.auth.Auth.Persistence.SESSION,
        firebase.auth.Auth.Persistence.NONE,
    ];
    for (const p of prefs) {
        try {
            await auth.setPersistence(p);
            return;
        } catch (_) {
            // Try next persistence mode
        }
    }
}

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const emailEl = document.getElementById('loginEmail');
    const passEl = document.getElementById('loginPassword');
    const msg = document.getElementById('authMsg');
    const btn = e.target.querySelector('button');

    const email = String(emailEl?.value || '').trim().toLowerCase();
    const pass = String(passEl?.value || '');

    if (!auth) {
        if (msg) msg.textContent = 'Firebase is not initialized. Check js/config.js and script loading.';
        return;
    }

    if (!email || !pass) {
        if (msg) msg.textContent = 'Please enter both email and password.';
        return;
    }

    if (location.protocol === 'file:' && msg) {
        msg.textContent = 'Open this page from http://localhost or http://127.0.0.1:3002, not file://, for reliable Firebase auth.';
    } else if (msg) {
        msg.textContent = '';
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>';
    }

    try {
        await setBestPersistence();
        await auth.signInWithEmailAndPassword(email, pass);
        if (msg) msg.textContent = 'Authenticated. Loading dashboard...';
    } catch (err) {
        console.error('[Auth] login failed', err);
        if (msg) msg.textContent = `Access Denied: ${getAuthErrorMessage(err)}`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = 'Authenticate';
        }
    }
});

window.handleLogout = () => auth?.signOut();

// --- 4A. MOBILE SIDEBAR TOGGLE ---
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('adminSidebarToggle');
    const sidebar = document.getElementById('adminSidebar');
    const envHint = document.getElementById('authEnvHint');

    if (envHint) {
        const origin = location.origin || 'unknown-origin';
        const modeHint = location.protocol === 'file:'
            ? 'Current mode: file:// (use http://localhost or http://127.0.0.1:3002 for login)'
            : `Current origin: ${origin}`;
        envHint.textContent = firebaseReady ? modeHint : `${modeHint} | Firebase config not loaded`;
    }
    if (!firebaseReady) {
        const msg = document.getElementById('authMsg');
        if (msg) msg.textContent = 'Admin cannot start: Firebase config is missing.';
    }

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('hidden');
        });
        window.addEventListener('resize', () => {
            if (window.innerWidth >= 768) sidebar.classList.remove('hidden');
            else sidebar.classList.add('hidden');
        });
    }
});

// --- 4. UI HELPERS ---
window.switchView = (viewId, el) => {
    document.querySelectorAll('.sidebar-link').forEach(x => x.classList.remove('active'));
    if (el?.classList) el.classList.add('active');
    else if (window.event?.currentTarget) window.event.currentTarget.classList.add('active');
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');

    // Close sidebar on mobile after selecting a view
    const sidebar = document.getElementById('adminSidebar');
    if (sidebar && window.innerWidth < 768) sidebar.classList.add('hidden');
};

window.toggleForm = (id) => {
    const el = document.getElementById(id);
    el.classList.toggle('hidden');
    if (!el.classList.contains('hidden')) el.scrollIntoView({ behavior: 'smooth' });
};

// --- 5. FILE UPLOAD SERVICE (Cloudinary -> optional Firebase Storage -> inline fallback) ---
function getCloudinaryConfig() {
    const cloudName = String(CONFIG?.cloudinary?.cloudName || '').trim();
    const uploadPreset = String(CONFIG?.cloudinary?.uploadPreset || '').trim();
    const hasCloudinary = !!cloudName
        && !!uploadPreset
        && uploadPreset.toLowerCase() !== 'your_upload_preset';
    return { cloudName, uploadPreset, hasCloudinary };
}

async function uploadImageToFirebaseStorage(file) {
    if (!storage) throw new Error('Firebase Storage SDK is not available.');
    const original = String(file?.name || 'upload').trim();
    const cleanName = original.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${cleanName}`;
    const ref = storage.ref().child(`uploads/${unique}`);
    const metadata = {
        contentType: file?.type || 'application/octet-stream',
        cacheControl: 'public,max-age=31536000',
    };
    await ref.put(file, metadata);
    return await ref.getDownloadURL();
}

function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read file.'));
        reader.readAsDataURL(file);
    });
}

function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to decode image.'));
        img.src = dataUrl;
    });
}

async function uploadImageInline(file) {
    const original = await readAsDataURL(file);
    const isImage = String(file?.type || '').startsWith('image/');
    if (!isImage) return original;

    try {
        const img = await loadImageFromDataUrl(original);
        const srcW = img.naturalWidth || img.width || 0;
        const srcH = img.naturalHeight || img.height || 0;
        if (!srcW || !srcH) return original;

        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
        const needsResize = scale < 1;
        const needsCompression = (file?.size || 0) > 900 * 1024;
        if (!needsResize && !needsCompression) return original;

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(srcW * scale));
        canvas.height = Math.max(1, Math.round(srcH * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return original;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        return canvas.toDataURL('image/jpeg', 0.82);
    } catch (_) {
        return original;
    }
}

async function uploadImageToCloudinary(file) {
    if (!file) return null;
    const { cloudName, uploadPreset, hasCloudinary } = getCloudinaryConfig();
    const shouldUseFirebaseStorage = !!CONFIG?.firebase?.useStorageUploads;
    if (hasCloudinary) {
        const url = `https://api.cloudinary.com/v1_1/${cloudName}/upload`;
        const fd = new FormData();
        fd.append('file', file);
        fd.append('upload_preset', uploadPreset);

        try {
            const res = await fetch(url, { method: 'POST', body: fd });
            const data = await res.json();
            if (!res.ok || !data?.secure_url) {
                const reason = data?.error?.message || `Cloudinary request failed (${res.status})`;
                throw new Error(reason);
            }
            return data.secure_url;
        } catch (err) {
            console.error('[Upload] Cloudinary failed:', err);
            if (shouldUseFirebaseStorage && storage) {
                try {
                    return await uploadImageToFirebaseStorage(file);
                } catch (fbErr) {
                    console.error('[Upload] Firebase Storage fallback failed:', fbErr);
                }
            }
            return await uploadImageInline(file);
        }
    }

    if (shouldUseFirebaseStorage && storage) {
        try {
            return await uploadImageToFirebaseStorage(file);
        } catch (err) {
            console.error('[Upload] Firebase Storage failed:', err);
        }
    }

    if (!inlineUploadNoticeShown) {
        inlineUploadNoticeShown = true;
        console.warn('[Upload] Using inline database fallback. Configure Cloudinary preset for production file hosting.');
    }
    return await uploadImageInline(file);
}

async function uploadManyToCloudinary(files) {
    const safeFiles = Array.from(files || []).filter(Boolean);
    if (!safeFiles.length) return [];
    const urls = [];
    for (const f of safeFiles) {
        const u = await uploadImageToCloudinary(f);
        if (u) urls.push(u);
    }
    return urls;
}

function initDashboard() {
    fetchMembers();
    fetchEvents();
    fetchGallery();
    fetchSettings();
}

// ==========================================
// MODULE: WEBSITE SETTINGS
// ==========================================

const SETTINGS_DEFAULTS = {
    siteName: 'ASTRONOMY & ASTROPHYSICS SOCIETY',
    heroBadge: 'Government College of Engineering — GCOEA',
    heroTitleLine1: 'Exploring The',
    heroTitleLine2: 'Infinite Cosmos',
    heroSubtitle: 'Observe. Discover. Understand the universe.',
    heroPrimaryText: 'Join Mission',
    heroPrimaryUrl: 'members.html',
    heroSecondaryText: 'Explore Programs',
    heroSecondaryUrl: 'programs.html',
    footerAbout: 'Exploring the infinite cosmos, one star at a time. Join our mission to decode the universe through observation and research.',
    whatsappUrl: 'https://chat.whatsapp.com/IQbOWh8nZhN401xweqOG4z?mode=gi_t',
    instagramUrl: 'https://www.instagram.com/aasg_gcoea?igsh=OGE5ODhtYzkzb2hi',
    supportEmail: 'astrophy@gcoea.in',
    contactEmailDisplay: 'adityataywadeofficial@gmail.com',
};

function fetchSettings() {
    if (!db) return;
    db.ref('siteSettings').on('value', snap => {
        const incoming = snap.val() || {};
        settingsData = { ...SETTINGS_DEFAULTS, ...incoming };
        hydrateSettingsForm(settingsData);
    });
}

function hydrateSettingsForm(data) {
    const safe = { ...SETTINGS_DEFAULTS, ...(data || {}) };
    const bind = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    };

    bind('sSiteName', safe.siteName);
    bind('sHeroBadge', safe.heroBadge);
    bind('sHeroTitleLine1', safe.heroTitleLine1);
    bind('sHeroTitleLine2', safe.heroTitleLine2);
    bind('sHeroSubtitle', safe.heroSubtitle);
    bind('sHeroPrimaryText', safe.heroPrimaryText);
    bind('sHeroPrimaryUrl', safe.heroPrimaryUrl);
    bind('sHeroSecondaryText', safe.heroSecondaryText);
    bind('sHeroSecondaryUrl', safe.heroSecondaryUrl);
    bind('sFooterAbout', safe.footerAbout);
    bind('sWhatsappUrl', safe.whatsappUrl);
    bind('sInstagramUrl', safe.instagramUrl);
    bind('sSupportEmail', safe.supportEmail);
    bind('sContactEmailDisplay', safe.contactEmailDisplay);
}

window.resetSettingsForm = () => {
    hydrateSettingsForm(settingsData);
};

document.getElementById('siteSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!db) {
        alert('Database is not connected. Check Firebase configuration.');
        return;
    }

    const btn = document.getElementById('saveSettingsBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Saving...';
    }

    const val = (id) => String(document.getElementById(id)?.value || '').trim();
    const payload = {
        siteName: val('sSiteName'),
        heroBadge: val('sHeroBadge'),
        heroTitleLine1: val('sHeroTitleLine1'),
        heroTitleLine2: val('sHeroTitleLine2'),
        heroSubtitle: val('sHeroSubtitle'),
        heroPrimaryText: val('sHeroPrimaryText'),
        heroPrimaryUrl: val('sHeroPrimaryUrl'),
        heroSecondaryText: val('sHeroSecondaryText'),
        heroSecondaryUrl: val('sHeroSecondaryUrl'),
        footerAbout: val('sFooterAbout'),
        whatsappUrl: val('sWhatsappUrl'),
        instagramUrl: val('sInstagramUrl'),
        supportEmail: val('sSupportEmail'),
        contactEmailDisplay: val('sContactEmailDisplay'),
        updatedAt: Date.now(),
    };

    try {
        await db.ref('siteSettings').update(payload);
        alert('Website settings updated successfully.');
    } catch (err) {
        alert('Failed to save website settings: ' + err.message);
    }

    if (btn) {
        btn.disabled = false;
        btn.innerText = 'Save Website Settings';
    }
});

// ==========================================
// MODULE: MEMBERS
// ==========================================

function fetchMembers() {
    if (!db) return;
    db.ref('members').on('value', snap => {
        membersData = snap.val() || {};
        document.getElementById('dashMemberCount').textContent = Object.keys(membersData).length;
        renderMembers();
    });
}

function renderMembers() {
    const tbody = document.getElementById('membersTableBody');
    tbody.innerHTML = '';
    Object.keys(membersData).forEach(key => {
        const m = membersData[key];
        tbody.innerHTML += `
        <tr class="table-row">
            <td class="p-4"><img src="${m.image || 'https://via.placeholder.com/40'}" class="w-10 h-10 rounded-full object-cover"></td>
            <td class="p-4">
                <div class="font-bold text-white">${m.name}</div>
                <div class="text-xs text-cyan-400">${m.role}</div>
            </td>
            <td class="p-4 text-right">
                <button onclick="editMember('${key}')" class="text-blue-400 hover:text-blue-300 mr-3"><i class="fas fa-pen"></i></button>
                <button onclick="deleteMember('${key}')" class="text-red-400 hover:text-red-300"><i class="fas fa-trash"></i></button>
            </td>
        </tr>`;
    });
}

window.resetMemberForm = () => {
    document.getElementById('memberForm').reset();
    document.getElementById('mId').value = '';
    document.getElementById('mExistingImage').value = '';
    const imageUrlEl = document.getElementById('mImageUrl');
    if (imageUrlEl) imageUrlEl.value = '';
    document.getElementById('saveMemberBtn').innerText = "Save to Database";
};

window.editMember = (id) => {
    const m = membersData[id];
    if(!m) return;
    
    document.getElementById('mId').value = id;
    document.getElementById('mName').value = m.name;
    const roleSelect = document.getElementById('mRole');
    const roleOtherWrap = document.getElementById('mRoleOtherWrap');
    const roleOtherInput = document.getElementById('mRoleOther');

    const knownRoles = new Set([
        'Member',
        'Technical Member',
        'Technical Head',
        'Founding Member',
        'Faculty Advisor',
        'Other'
    ]);

    const roleValue = String(m.role || '').trim();
    if (roleSelect) {
        if (knownRoles.has(roleValue)) {
            roleSelect.value = roleValue;
            if (roleOtherWrap) roleOtherWrap.classList.add('hidden');
            if (roleOtherInput) roleOtherInput.value = '';
        } else {
            roleSelect.value = 'Other';
            if (roleOtherWrap) roleOtherWrap.classList.remove('hidden');
            if (roleOtherInput) roleOtherInput.value = roleValue;
        }
    }
    document.getElementById('mBranch').value = m.branch;
    document.getElementById('mYear').value = m.year;
    const designationEl = document.getElementById('mDesignation');
    if (designationEl) designationEl.value = m.designation || '';
    document.getElementById('mExistingImage').value = m.image;
    const imageUrlEl = document.getElementById('mImageUrl');
    if (imageUrlEl) imageUrlEl.value = m.image || '';
    
    document.getElementById('saveMemberBtn').innerText = "Update Member";
    
    const container = document.getElementById('memberFormContainer');
    container.classList.remove('hidden');
    container.scrollIntoView({ behavior: 'smooth' });
};

// Toggle custom role input when selecting "Other"
document.addEventListener('DOMContentLoaded', () => {
    const roleSelect = document.getElementById('mRole');
    const roleOtherWrap = document.getElementById('mRoleOtherWrap');
    const roleOtherInput = document.getElementById('mRoleOther');
    const yearWrap = document.getElementById('mYearWrap');
    const yearInput = document.getElementById('mYear');
    const designationWrap = document.getElementById('mDesignationWrap');
    const designationInput = document.getElementById('mDesignation');

    const sync = () => {
        if (!roleSelect || !roleOtherWrap || !yearWrap || !designationWrap) return;
        const isOther = roleSelect.value === 'Other';
        const isFaculty = roleSelect.value === 'Faculty Advisor';
        roleOtherWrap.classList.toggle('hidden', !isOther);
        yearWrap.classList.toggle('hidden', isFaculty);
        yearInput.required = !isFaculty;
        designationWrap.classList.toggle('hidden', !isFaculty);
        designationInput.required = isFaculty;
        if (!isOther && roleOtherInput) roleOtherInput.value = '';
        if (!isFaculty && designationInput) designationInput.value = '';
    };

    roleSelect?.addEventListener('change', sync);
    sync();
});

document.getElementById('memberForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!db) {
        alert('Database is not connected. Check Firebase configuration.');
        return;
    }
    const btn = document.getElementById('saveMemberBtn');
    btn.disabled = true; btn.innerText = "Processing...";

    const id = document.getElementById('mId').value;
    const file = document.getElementById('mImageFile').files[0];
    const imageUrlInput = document.getElementById('mImageUrl')?.value || '';
    let imageUrl = document.getElementById('mExistingImage').value;

    if (file) {
        const uploadedUrl = await uploadImageToCloudinary(file);
        if (uploadedUrl) imageUrl = uploadedUrl;
    }
    if (!file && imageUrlInput && /^https?:\/\//i.test(imageUrlInput)) {
        imageUrl = String(imageUrlInput).trim();
    }

    const roleSelect = document.getElementById('mRole');
    const roleOtherInput = document.getElementById('mRoleOther');
    const roleSelected = String(roleSelect?.value || '').trim();
    const roleFinal = roleSelected === 'Other'
        ? String(roleOtherInput?.value || '').trim()
        : roleSelected;
    const isFaculty = roleFinal === 'Faculty Advisor';

    const payload = {
        name: document.getElementById('mName').value,
        role: roleFinal,
        branch: document.getElementById('mBranch').value,
        year: isFaculty ? '' : document.getElementById('mYear').value,
        designation: isFaculty ? String(document.getElementById('mDesignation')?.value || '').trim() : '',
        image: imageUrl
    };

    try {
        if (id) {
            await db.ref('members/' + id).update(payload);
        } else {
            await db.ref('members').push(payload);
        }
        resetMemberForm();
        toggleForm('memberFormContainer');
    } catch (err) {
        alert("Error saving data: " + err.message);
    }
    btn.disabled = false;
});

window.deleteMember = (id) => {
    if (!db) return;
    if(confirm("Are you sure you want to remove this member?")) {
        db.ref('members/' + id).remove();
    }
};

// ==========================================
// MODULE: EVENTS
// ==========================================

function fetchEvents() {
    if (!db) return;
    db.ref('events').on('value', snap => {
        eventsData = snap.val() || {};
        document.getElementById('dashEventCount').textContent = Object.keys(eventsData).length;
        renderEvents();
    });
}

function renderEvents() {
    const grid = document.getElementById('eventsCardGrid');
    grid.innerHTML = '';
    // Sort by date descending
    const sortedKeys = Object.keys(eventsData).sort((a,b) => new Date(eventsData[b].date) - new Date(eventsData[a].date));

    sortedKeys.forEach(key => {
        const e = eventsData[key];
        grid.innerHTML += `
        <div class="holo-card flex flex-col md:flex-row overflow-hidden group">
            <div class="w-full md:w-32 h-32 relative">
                <img src="${e.image || 'https://via.placeholder.com/150'}" class="w-full h-full object-cover">
            </div>
            <div class="p-4 flex-1">
                <h3 class="text-lg font-bold text-white">${e.title}</h3>
                <p class="text-xs text-cyan-400 mb-1">${e.date} @ ${e.time}</p>
                <div class="flex gap-3 mt-2">
                    <button onclick="editEvent('${key}')" class="text-xs text-blue-400 uppercase hover:underline">Edit</button>
                    <button onclick="deleteEvent('${key}')" class="text-xs text-red-400 uppercase hover:underline">Delete</button>
                </div>
            </div>
        </div>`;
    });
}

window.resetEventForm = () => {
    document.getElementById('eventForm').reset();
    document.getElementById('eId').value = '';
    document.getElementById('eExistingImage').value = '';
    const imageUrlEl = document.getElementById('eImageUrl');
    if (imageUrlEl) imageUrlEl.value = '';
    document.getElementById('saveEventBtn').innerText = "Launch Mission";
};

window.editEvent = (id) => {
    const e = eventsData[id];
    if(!e) return;

    document.getElementById('eId').value = id;
    document.getElementById('eTitle').value = e.title;
    document.getElementById('eCategory').value = e.category;
    document.getElementById('eDate').value = e.date;
    document.getElementById('eTime').value = e.time;
    document.getElementById('eLocation').value = e.location;
    document.getElementById('eShort').value = e.shortDesc;
    if (document.getElementById('eLong')) document.getElementById('eLong').value = e.longDesc || '';
    if (document.getElementById('eContrib')) {
        const contrib = Array.isArray(e.contributors) ? e.contributors.join(', ') : (e.contributors || '');
        document.getElementById('eContrib').value = contrib;
    }
    document.getElementById('eExistingImage').value = e.image;
    const imageUrlEl = document.getElementById('eImageUrl');
    if (imageUrlEl) imageUrlEl.value = e.image || '';

    document.getElementById('saveEventBtn').innerText = "Update Mission";
    const container = document.getElementById('eventFormContainer');
    container.classList.remove('hidden');
    container.scrollIntoView({ behavior: 'smooth' });
};

document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!db) {
        alert('Database is not connected. Check Firebase configuration.');
        return;
    }
    const btn = document.getElementById('saveEventBtn');
    btn.disabled = true; btn.innerText = "Uploading...";

    const id = document.getElementById('eId').value;
    const file = document.getElementById('eImageFile').files[0];
    const imageUrlInput = document.getElementById('eImageUrl')?.value || '';
    const galleryFiles = document.getElementById('eGalleryFiles')?.files;
    let imageUrl = document.getElementById('eExistingImage').value;

    const existingGallery = eventsData?.[id]?.galleryImages;
    let galleryUrls = Array.isArray(existingGallery) ? existingGallery : [];

    if (file) {
        const uploadedUrl = await uploadImageToCloudinary(file);
        if (uploadedUrl) imageUrl = uploadedUrl;
    }
    if (!file && imageUrlInput && /^https?:\/\//i.test(imageUrlInput)) {
        imageUrl = String(imageUrlInput).trim();
    }

    if (galleryFiles && galleryFiles.length) {
        const uploadedGallery = await uploadManyToCloudinary(galleryFiles);
        if (uploadedGallery.length) galleryUrls = uploadedGallery;
    }

    const payload = {
        title: document.getElementById('eTitle').value,
        category: document.getElementById('eCategory').value,
        date: document.getElementById('eDate').value,
        time: document.getElementById('eTime').value,
        location: document.getElementById('eLocation').value,
        shortDesc: document.getElementById('eShort').value,
        longDesc: document.getElementById('eLong')?.value || '',
        contributors: (document.getElementById('eContrib')?.value || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean),
        image: imageUrl,
        galleryImages: galleryUrls
    };

    try {
        if (id) {
            await db.ref('events/' + id).update(payload);
        } else {
            await db.ref('events').push(payload);
        }
        resetEventForm();
        toggleForm('eventFormContainer');
    } catch (err) {
        alert("Error: " + err.message);
    }
    btn.disabled = false;
});

window.deleteEvent = (id) => {
    if (!db) return;
    if(confirm("Abort mission? This cannot be undone.")) {
        db.ref('events/' + id).remove();
    }
};

// ==========================================
// MODULE: GALLERY
// ==========================================

function fetchGallery() {
    if (!db) return;
    db.ref('gallery').on('value', snap => {
        galleryData = snap.val() || {};
        const countEl = document.getElementById('dashGalleryCount');
        if (countEl) countEl.textContent = Object.keys(galleryData).length;
        renderGallery();
    });
}

function esc(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function toTs(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
        const asNum = Number(value);
        if (Number.isFinite(asNum)) return asNum;
    }
    return 0;
}

function fmtDate(value) {
    const ts = toTs(value);
    if (!ts) return 'N/A';
    return new Date(ts).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

function toInputDate(value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return value.trim();
    const ts = toTs(value);
    if (!ts) return '';
    return new Date(ts).toISOString().slice(0, 10);
}

function renderGallery() {
    const grid = document.getElementById('adminGalleryGrid');
    if (!grid) return;

    const entries = Object.entries(galleryData);
    // newest capture first, fallback to upload time
    entries.sort((a, b) => {
        const aTs = toTs(a[1]?.captureDate) || toTs(a[1]?.createdAt);
        const bTs = toTs(b[1]?.captureDate) || toTs(b[1]?.createdAt);
        return bTs - aTs;
    });

    if (!entries.length) {
        grid.innerHTML = '<div class="holo-card p-6 text-gray-400">No media uploaded yet.</div>';
        return;
    }

    grid.innerHTML = entries.map(([id, g]) => {
        const type = 'image';
        const caption = g.caption || '';
        const objectName = g.objectName || '';
        const captureDate = g.captureDate || g.createdAt || '';
        const photographer = g.photographer || '';
        const location = g.location || '';
        const url = g.url || 'https://via.placeholder.com/600x400';

        const thumb = `<img src="${url}" class="w-full h-48 object-cover" alt="${esc(caption)}">`;

        return `
            <div class="holo-card overflow-hidden">
                <div class="relative">
                    ${thumb}
                    <div class="absolute top-3 left-3 text-[10px] uppercase tracking-widest px-2 py-1 rounded border border-white/10 bg-black/50 text-gray-200">${type}</div>
                </div>
                <div class="p-4">
                    <div class="text-white font-semibold">${esc(caption) || '-'}</div>
                    <div class="mt-2 text-xs text-gray-400 space-y-1">
                        <div><span class="text-cyan-300/80">Object:</span> ${esc(objectName || 'N/A')}</div>
                        <div><span class="text-cyan-300/80">Capture Date:</span> ${esc(fmtDate(captureDate))}</div>
                        <div><span class="text-cyan-300/80">By:</span> ${esc(photographer || 'N/A')}</div>
                        <div><span class="text-cyan-300/80">Location:</span> ${esc(location || 'N/A')}</div>
                    </div>
                    <div class="mt-3 flex gap-3">
                        <button type="button" onclick="editGallery('${id}')" class="text-xs text-blue-400 uppercase hover:underline">Edit</button>
                        <button type="button" onclick="deleteGallery('${id}')" class="text-xs text-red-400 uppercase hover:underline">Delete</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

window.resetGalleryForm = () => {
    const form = document.getElementById('galleryForm');
    if (form) form.reset();

    const ids = [
        'gId', 'gExistingUrl', 'gCaption', 'gObjectName', 'gCaptureDate', 'gPhotographer',
        'gLocation', 'gTelescope', 'gCamera', 'gExposure', 'gDescription', 'gImageUrl'
    ];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    const typeEl = document.getElementById('gType');
    if (typeEl) typeEl.value = 'image';

    const btn = document.getElementById('saveGalleryBtn');
    if (btn) btn.innerText = 'Save Media';
};

window.editGallery = (id) => {
    const g = galleryData?.[id];
    if (!g) return;

    const idEl = document.getElementById('gId');
    const urlEl = document.getElementById('gExistingUrl');
    const captionEl = document.getElementById('gCaption');
    const objectEl = document.getElementById('gObjectName');
    const captureDateEl = document.getElementById('gCaptureDate');
    const photographerEl = document.getElementById('gPhotographer');
    const locationEl = document.getElementById('gLocation');
    const telescopeEl = document.getElementById('gTelescope');
    const cameraEl = document.getElementById('gCamera');
    const exposureEl = document.getElementById('gExposure');
    const descEl = document.getElementById('gDescription');
    const imageUrlEl = document.getElementById('gImageUrl');
    const btn = document.getElementById('saveGalleryBtn');

    if (idEl) idEl.value = id;
    if (urlEl) urlEl.value = g.url || '';
    if (captionEl) captionEl.value = g.caption || '';
    if (objectEl) objectEl.value = g.objectName || '';
    if (captureDateEl) captureDateEl.value = toInputDate(g.captureDate || g.createdAt);
    if (photographerEl) photographerEl.value = g.photographer || '';
    if (locationEl) locationEl.value = g.location || '';
    if (telescopeEl) telescopeEl.value = g.telescope || '';
    if (cameraEl) cameraEl.value = g.camera || '';
    if (exposureEl) exposureEl.value = g.exposure || '';
    if (descEl) descEl.value = g.description || '';
    if (imageUrlEl) imageUrlEl.value = g.url || '';
    if (btn) btn.innerText = 'Update Media';

    const container = document.getElementById('galleryFormContainer');
    container?.classList.remove('hidden');
    container?.scrollIntoView({ behavior: 'smooth' });
};

document.getElementById('galleryForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!db) {
        alert('Database is not connected. Check Firebase configuration.');
        return;
    }

    const btn = document.getElementById('saveGalleryBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Uploading...';
    }

    const id = document.getElementById('gId')?.value || '';
    const caption = document.getElementById('gCaption')?.value || '';
    const objectName = document.getElementById('gObjectName')?.value || '';
    const captureDate = document.getElementById('gCaptureDate')?.value || '';
    const photographer = document.getElementById('gPhotographer')?.value || '';
    const location = document.getElementById('gLocation')?.value || '';
    const telescope = document.getElementById('gTelescope')?.value || '';
    const camera = document.getElementById('gCamera')?.value || '';
    const exposure = document.getElementById('gExposure')?.value || '';
    const description = document.getElementById('gDescription')?.value || '';
    const imageUrlInput = document.getElementById('gImageUrl')?.value || '';
    const file = document.getElementById('gFile')?.files?.[0];
    let url = document.getElementById('gExistingUrl')?.value || '';

    if (file) {
        const uploadedUrl = await uploadImageToCloudinary(file);
        if (uploadedUrl) url = uploadedUrl;
    }
    if (!file && imageUrlInput && /^https?:\/\//i.test(imageUrlInput)) {
        url = String(imageUrlInput).trim();
    }

    if (!url) {
        alert('Please upload an image file before saving.');
        if (btn) {
            btn.disabled = false;
            btn.innerText = 'Save Media';
        }
        return;
    }

    const old = galleryData?.[id] || {};
    const payload = {
        caption: String(caption).trim(),
        objectName: String(objectName).trim(),
        description: String(description).trim(),
        captureDate: String(captureDate).trim(),
        photographer: String(photographer).trim(),
        location: String(location).trim(),
        telescope: String(telescope).trim(),
        camera: String(camera).trim(),
        exposure: String(exposure).trim(),
        type: 'image',
        url,
        createdAt: old.createdAt || Date.now(),
        updatedAt: Date.now()
    };

    try {
        if (id) {
            await db.ref('gallery/' + id).update(payload);
        } else {
            await db.ref('gallery').push(payload);
        }
        resetGalleryForm();
        toggleForm('galleryFormContainer');
    } catch (err) {
        alert('Error saving gallery item: ' + err.message);
    }

    if (btn) {
        btn.disabled = false;
        btn.innerText = 'Save Media';
    }
});

window.deleteGallery = (id) => {
    if (!db) return;
    if (confirm('Delete this gallery item?')) {
        db.ref('gallery/' + id).remove();
    }
};
