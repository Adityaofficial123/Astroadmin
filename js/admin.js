'use strict';

// --- 1. FIREBASE INIT ---
if (!firebase.apps.length) firebase.initializeApp(CONFIG.firebase);
const auth = firebase.auth();
const db = firebase.database();

// --- 2. STATE & VARIABLES ---
let membersData = {};
let eventsData = {};
let galleryData = {};

// --- 3. AUTHENTICATION ---
auth.onAuthStateChanged(user => {
    if (user) {
        document.getElementById('loginOverlay').classList.add('hidden');
        initDashboard(); // Start loading data
    } else {
        document.getElementById('loginOverlay').classList.remove('hidden');
    }
});

document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const pass = document.getElementById('loginPassword').value;
    const msg = document.getElementById('authMsg');
    const btn = e.target.querySelector('button');

    btn.innerHTML = '<span class="spinner"></span>';
    
    auth.signInWithEmailAndPassword(email, pass)
        .catch(err => {
            console.error(err);
            msg.textContent = "Access Denied: " + err.message;
            btn.innerText = "Authenticate";
        });
});

window.handleLogout = () => auth.signOut();

// --- 4A. MOBILE SIDEBAR TOGGLE ---
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('adminSidebarToggle');
    const sidebar = document.getElementById('adminSidebar');
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
window.switchView = (viewId) => {
    document.querySelectorAll('.sidebar-link').forEach(el => el.classList.remove('active'));
    if (window.event?.currentTarget) window.event.currentTarget.classList.add('active');
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

// --- 5. CLOUDINARY UPLOAD SERVICE ---
async function uploadImageToCloudinary(file) {
    if (!file) return null;
    const url = `https://api.cloudinary.com/v1_1/${CONFIG.cloudinary.cloudName}/upload`;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', CONFIG.cloudinary.uploadPreset);

    try {
        const res = await fetch(url, { method: 'POST', body: fd });
        const data = await res.json();
        return data.secure_url;
    } catch (err) {
        console.error("Upload Error:", err);
        alert("Image upload failed. Check console.");
        return null;
    }
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
}

// ==========================================
// MODULE: MEMBERS
// ==========================================

function fetchMembers() {
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
    document.getElementById('mExistingImage').value = m.image;
    
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

    const sync = () => {
        if (!roleSelect || !roleOtherWrap) return;
        const isOther = roleSelect.value === 'Other';
        roleOtherWrap.classList.toggle('hidden', !isOther);
        if (!isOther && roleOtherInput) roleOtherInput.value = '';
    };

    roleSelect?.addEventListener('change', sync);
    sync();
});

document.getElementById('memberForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveMemberBtn');
    btn.disabled = true; btn.innerText = "Processing...";

    const id = document.getElementById('mId').value;
    const file = document.getElementById('mImageFile').files[0];
    let imageUrl = document.getElementById('mExistingImage').value;

    if (file) {
        const uploadedUrl = await uploadImageToCloudinary(file);
        if (uploadedUrl) imageUrl = uploadedUrl;
    }

    const roleSelect = document.getElementById('mRole');
    const roleOtherInput = document.getElementById('mRoleOther');
    const roleSelected = String(roleSelect?.value || '').trim();
    const roleFinal = roleSelected === 'Other'
        ? String(roleOtherInput?.value || '').trim()
        : roleSelected;

    const payload = {
        name: document.getElementById('mName').value,
        role: roleFinal,
        branch: document.getElementById('mBranch').value,
        year: document.getElementById('mYear').value,
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
    if(confirm("Are you sure you want to remove this member?")) {
        db.ref('members/' + id).remove();
    }
};

// ==========================================
// MODULE: EVENTS
// ==========================================

function fetchEvents() {
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

    document.getElementById('saveEventBtn').innerText = "Update Mission";
    const container = document.getElementById('eventFormContainer');
    container.classList.remove('hidden');
    container.scrollIntoView({ behavior: 'smooth' });
};

document.getElementById('eventForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('saveEventBtn');
    btn.disabled = true; btn.innerText = "Uploading...";

    const id = document.getElementById('eId').value;
    const file = document.getElementById('eImageFile').files[0];
    const galleryFiles = document.getElementById('eGalleryFiles')?.files;
    let imageUrl = document.getElementById('eExistingImage').value;

    const existingGallery = eventsData?.[id]?.galleryImages;
    let galleryUrls = Array.isArray(existingGallery) ? existingGallery : [];

    if (file) {
        const uploadedUrl = await uploadImageToCloudinary(file);
        if (uploadedUrl) imageUrl = uploadedUrl;
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
    if(confirm("Abort mission? This cannot be undone.")) {
        db.ref('events/' + id).remove();
    }
};

// ==========================================
// MODULE: GALLERY
// ==========================================

function fetchGallery() {
    db.ref('gallery').on('value', snap => {
        galleryData = snap.val() || {};
        renderGallery();
    });
}

function renderGallery() {
    const grid = document.getElementById('adminGalleryGrid');
    if (!grid) return;

    const entries = Object.entries(galleryData);
    // newest first if createdAt exists
    entries.sort((a, b) => (b[1]?.createdAt || 0) - (a[1]?.createdAt || 0));

    if (!entries.length) {
        grid.innerHTML = '<div class="holo-card p-6 text-gray-400">No media uploaded yet.</div>';
        return;
    }

    grid.innerHTML = entries.map(([id, g]) => {
        const type = (g.type || 'image');
        const caption = g.caption || '';
        const url = g.url || '';

        const thumb = type === 'video'
            ? `<video src="${url}" class="w-full h-48 object-cover" muted playsinline></video>`
            : `<img src="${url}" class="w-full h-48 object-cover" alt="${caption.replace(/\"/g, '&quot;')}">`;

        return `
            <div class="holo-card overflow-hidden">
                <div class="relative">
                    ${thumb}
                    <div class="absolute top-3 left-3 text-[10px] uppercase tracking-widest px-2 py-1 rounded border border-white/10 bg-black/50 text-gray-200">${type}</div>
                </div>
                <div class="p-4">
                    <div class="text-white font-semibold">${caption || '—'}</div>
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
    const idEl = document.getElementById('gId');
    const urlEl = document.getElementById('gExistingUrl');
    if (idEl) idEl.value = '';
    if (urlEl) urlEl.value = '';
    const btn = document.getElementById('saveGalleryBtn');
    if (btn) btn.innerText = 'Save Media';
};

window.editGallery = (id) => {
    const g = galleryData?.[id];
    if (!g) return;

    const idEl = document.getElementById('gId');
    const urlEl = document.getElementById('gExistingUrl');
    const captionEl = document.getElementById('gCaption');
    const typeEl = document.getElementById('gType');
    const btn = document.getElementById('saveGalleryBtn');

    if (idEl) idEl.value = id;
    if (urlEl) urlEl.value = g.url || '';
    if (captionEl) captionEl.value = g.caption || '';
    if (typeEl) typeEl.value = g.type || 'image';
    if (btn) btn.innerText = 'Update Media';

    const container = document.getElementById('galleryFormContainer');
    container?.classList.remove('hidden');
    container?.scrollIntoView({ behavior: 'smooth' });
};

document.getElementById('galleryForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btn = document.getElementById('saveGalleryBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerText = 'Uploading...';
    }

    const id = document.getElementById('gId')?.value || '';
    const caption = document.getElementById('gCaption')?.value || '';
    const type = document.getElementById('gType')?.value || 'image';
    const file = document.getElementById('gFile')?.files?.[0];
    let url = document.getElementById('gExistingUrl')?.value || '';

    if (file) {
        const uploadedUrl = await uploadImageToCloudinary(file);
        if (uploadedUrl) url = uploadedUrl;
    }

    const payload = {
        caption: String(caption).trim(),
        type: type === 'video' ? 'video' : 'image',
        url,
        createdAt: (galleryData?.[id]?.createdAt) || Date.now()
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
    if (confirm('Delete this gallery item?')) {
        db.ref('gallery/' + id).remove();
    }
};
