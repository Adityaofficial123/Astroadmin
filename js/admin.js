'use strict';

// --- 1. FIREBASE INIT ---
if (!firebase.apps.length) firebase.initializeApp(CONFIG.firebase);
const auth = firebase.auth();
const db = firebase.database();

// --- 2. STATE & VARIABLES ---
let membersData = {};
let eventsData = {};

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

// --- 4. UI HELPERS ---
window.switchView = (viewId) => {
    document.querySelectorAll('.sidebar-link').forEach(el => el.classList.remove('active'));
    event.currentTarget.classList.add('active');
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
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

function initDashboard() {
    fetchMembers();
    fetchEvents();
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
    document.getElementById('mRole').value = m.role;
    document.getElementById('mBranch').value = m.branch;
    document.getElementById('mYear').value = m.year;
    document.getElementById('mExistingImage').value = m.image;
    
    document.getElementById('saveMemberBtn').innerText = "Update Member";
    
    const container = document.getElementById('memberFormContainer');
    container.classList.remove('hidden');
    container.scrollIntoView({ behavior: 'smooth' });
};

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

    const payload = {
        name: document.getElementById('mName').value,
        role: document.getElementById('mRole').value,
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
    let imageUrl = document.getElementById('eExistingImage').value;

    if (file) {
        const uploadedUrl = await uploadImageToCloudinary(file);
        if (uploadedUrl) imageUrl = uploadedUrl;
    }

    const payload = {
        title: document.getElementById('eTitle').value,
        category: document.getElementById('eCategory').value,
        date: document.getElementById('eDate').value,
        time: document.getElementById('eTime').value,
        location: document.getElementById('eLocation').value,
        shortDesc: document.getElementById('eShort').value,
        image: imageUrl
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